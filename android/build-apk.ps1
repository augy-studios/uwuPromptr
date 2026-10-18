# Builds the signed uwuPromptr APKs, the phone's and the Wear OS watch's, and
# puts them in release\<version>\.
#
#   powershell -ExecutionPolicy Bypass -File android\build-apk.ps1
#
# In order:
#   1. Finds a JDK 21 or newer and the Android SDK.
#   2. First run only: makes the signing key (android.keystore and
#      keystore.properties) and writes its fingerprint into
#      main-site\.well-known\assetlinks.json. Every later run reuses it, and
#      stops rather than make a second one if it has gone missing.
#   3. npm ci if node_modules is missing, then npx cap sync android.
#   4. gradlew assembleRelease: the phone's app (native\app\) and the watch's
#      (native\wear\), one key and one version for both.
#   5. Checks both are signed with the key assetlinks.json names. The watch's
#      must be, or the two can't talk.
#   6. Copies them to release\<versionName>\ as uwupromptr-<versionName>.apk
#      and uwupromptr-<versionName>-watch.apk.
#
# Written for Windows PowerShell 5.1: native tools are run so that their
# stderr is not mistaken for a failure (only the exit code counts), files other
# tools read are written without a BOM, and Gradle streams its output live.

$ErrorActionPreference = 'Stop'

$package = 'org.uwuapps.cue'
$keyAlias = 'uwupromptr'
$dname = 'CN=uwuPromptr, OU=UwU Apps, O=UwU Apps, L=Singapore, C=SG'
$apkName = 'uwupromptr'
# The UwU Apps template's fingerprint. assetlinks.json carries it until this
# app's own key exists.
$templateFingerprint = 'E4:EB:13:B6:CA:2A:9E:89:E4:8B:3C:AB:68:2B:BF:6A:99:97:09:A5:2A:9A:36:20:8C:8C:A9:94:9B:08:CB:51'

$here = $PSScriptRoot
$repo = Split-Path $here -Parent
$native = Join-Path $here 'native'
$keystore = Join-Path $here 'android.keystore'
$propsFile = Join-Path $here 'keystore.properties'
$assetlinks = Join-Path $repo 'main-site\.well-known\assetlinks.json'
$gradleFile = Join-Path $native 'app\build.gradle'
$utf8 = New-Object System.Text.UTF8Encoding $false

function Step([string]$message) { Write-Host "`n== $message" -ForegroundColor Cyan }
function Note([string]$message) { Write-Host $message -ForegroundColor Yellow }
function Fail([string]$message) {
    Write-Host "`nSTOPPED: $message" -ForegroundColor Red
    exit 1
}

# A native tool, its output shown as it comes, judged by its exit code alone.
function Invoke-Tool([string]$exe, [string[]]$arguments) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $exe @arguments 2>&1 | ForEach-Object { Write-Host "$_" }
    $code = $LASTEXITCODE
    $ErrorActionPreference = $previous
    return $code
}

# The same, but the output kept for reading rather than shown.
function Get-ToolOutput([string]$exe, [string[]]$arguments) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = & $exe @arguments 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
    $ErrorActionPreference = $previous
    return @{ Code = $code; Text = ($output -join "`n") }
}

function Get-AssetlinksFingerprint {
    $raw = [System.IO.File]::ReadAllText($assetlinks)
    $match = [regex]::Match($raw, '"sha256_cert_fingerprints"\s*:\s*\[\s*"([0-9A-Fa-f:]+)"')
    if (-not $match.Success) { Fail "Could not read the fingerprint in $assetlinks." }
    return $match.Groups[1].Value.ToUpper()
}

function Get-KeystoreFingerprint([string]$keytool, [hashtable]$props) {
    $result = Get-ToolOutput $keytool @('-list', '-v', '-keystore', $keystore, '-alias', $props['keyAlias'], '-storepass', $props['storePassword'])
    if ($result.Code -ne 0) { Fail "keytool could not read android.keystore with keystore.properties:`n$($result.Text)" }
    $match = [regex]::Match($result.Text, 'SHA256:\s*([0-9A-Fa-f:]{95})')
    if (-not $match.Success) { Fail "keytool did not print a SHA-256 fingerprint." }
    return $match.Groups[1].Value.ToUpper()
}

function Read-Props {
    $props = @{}
    foreach ($line in [System.IO.File]::ReadAllLines($propsFile)) {
        if ($line -match '^\s*([A-Za-z]+)\s*=\s*(.*)$') { $props[$Matches[1]] = $Matches[2].Trim() }
    }
    foreach ($key in 'storeFile', 'storePassword', 'keyAlias', 'keyPassword') {
        if (-not $props[$key]) { Fail "keystore.properties has no $key." }
    }
    return $props
}

# ---------------------------------------------------------------------------
Step 'Finding Java and the Android SDK'

function Get-JdkMajor([string]$home_) {
    $release = Join-Path $home_ 'release'
    if (-not (Test-Path $release)) { return 0 }
    $match = [regex]::Match([System.IO.File]::ReadAllText($release), 'JAVA_VERSION="(\d+)')
    if ($match.Success) { return [int]$match.Groups[1].Value }
    return 0
}

$jdk = $null
$candidates = @()
if ($env:JAVA_HOME) { $candidates += $env:JAVA_HOME }
foreach ($root in 'C:\Program Files\Eclipse Adoptium', 'C:\Program Files\Java', 'C:\Program Files\Microsoft') {
    if (Test-Path $root) {
        $candidates += Get-ChildItem $root -Directory | Where-Object { $_.Name -match 'jdk' } | ForEach-Object { $_.FullName }
    }
}
$best = 0
foreach ($candidate in $candidates) {
    if (-not (Test-Path (Join-Path $candidate 'bin\java.exe'))) { continue }
    $major = Get-JdkMajor $candidate
    # JAVA_HOME wins when it is new enough; otherwise the newest found.
    if ($candidate -eq $env:JAVA_HOME -and $major -ge 21) { $jdk = $candidate; break }
    if ($major -ge 21 -and $major -gt $best) { $jdk = $candidate; $best = $major }
}
if (-not $jdk) { Fail 'No JDK 21 or newer found. Install Temurin 21 (adoptium.net) or set JAVA_HOME.' }
$env:JAVA_HOME = $jdk
$keytool = Join-Path $jdk 'bin\keytool.exe'
Write-Host "Java:        $jdk"

$sdk = $null
foreach ($candidate in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)) {
    if ($candidate -and (Test-Path (Join-Path $candidate 'platforms'))) { $sdk = $candidate; break }
}
if (-not $sdk) {
    $bubblewrap = Join-Path $HOME '.bubblewrap\config.json'
    if (Test-Path $bubblewrap) {
        $match = [regex]::Match([System.IO.File]::ReadAllText($bubblewrap), '"androidSdkPath"\s*:\s*"([^"]+)"')
        if ($match.Success) {
            $path = $match.Groups[1].Value -replace '\\\\', '\'
            if (Test-Path (Join-Path $path 'platforms')) { $sdk = $path }
        }
    }
}
if (-not $sdk) {
    $default = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
    if (Test-Path (Join-Path $default 'platforms')) { $sdk = $default }
}
if (-not $sdk) { Fail 'No Android SDK found. Install Android Studio, or set ANDROID_HOME.' }
$env:ANDROID_HOME = $sdk
Write-Host "Android SDK: $sdk"

$buildTools = Get-ChildItem (Join-Path $sdk 'build-tools') -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^\d+(\.\d+)*$' } |
    Sort-Object { [version]$_.Name } -Descending |
    Select-Object -First 1
if (-not $buildTools) { Fail 'The SDK has no build-tools. Install them from Android Studio''s SDK Manager.' }
$apksigner = Join-Path $buildTools.FullName 'apksigner.bat'

# ---------------------------------------------------------------------------
Step 'Reading the version'

$gradleText = [System.IO.File]::ReadAllText($gradleFile)
$versionName = [regex]::Match($gradleText, 'versionName\s+"([^"]+)"').Groups[1].Value
$versionCode = [regex]::Match($gradleText, 'versionCode\s+(\d+)').Groups[1].Value
if (-not $versionName -or -not $versionCode) { Fail "Could not read versionName and versionCode from $gradleFile." }
Write-Host "Version $versionName (versionCode $versionCode)"

# ---------------------------------------------------------------------------
Step 'The signing key'

$linked = Get-AssetlinksFingerprint

if (-not (Test-Path $keystore)) {
    if ($linked -ne $templateFingerprint) {
        Fail ("assetlinks.json names this app's key ($linked), but android\android.keystore is missing.`n" +
            "Restore android.keystore and keystore.properties from your backup. A new key cannot update the`n" +
            "copies already installed, so this script will not make one.")
    }

    Note 'First build: making the signing key.'
    $chars = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
    $random = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
    $bytes = New-Object byte[] 32
    $random.GetBytes($bytes)
    $password = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })

    $code = Invoke-Tool $keytool @(
        '-genkeypair', '-v', '-storetype', 'PKCS12',
        '-keystore', $keystore, '-alias', $keyAlias,
        '-keyalg', 'RSA', '-keysize', '4096', '-validity', '36500',
        '-storepass', $password, '-keypass', $password,
        '-dname', $dname
    )
    if ($code -ne 0) { Fail 'keytool could not make the key.' }

    $props = "storeFile=android.keystore`nstorePassword=$password`nkeyAlias=$keyAlias`nkeyPassword=$password`n"
    [System.IO.File]::WriteAllText($propsFile, $props, $utf8)

    $props = Read-Props
    $fingerprint = Get-KeystoreFingerprint $keytool $props
    $links = [System.IO.File]::ReadAllText($assetlinks).Replace($templateFingerprint, $fingerprint)
    [System.IO.File]::WriteAllText($assetlinks, $links, $utf8)

    Write-Host ''
    Note '  !! BACK UP android\android.keystore AND android\keystore.properties NOW !!'
    Note '  Put both in your password manager. Without them no installed phone can'
    Note '  ever be updated, and links stop opening in the app.'
    Note "  The key's SHA-256 is now in main-site\.well-known\assetlinks.json:"
    Note "  $fingerprint"
    Note '  Commit and deploy that file.'
} else {
    if (-not (Test-Path $propsFile)) {
        Fail 'android\android.keystore is here but keystore.properties is not. Restore it from your backup.'
    }
    $props = Read-Props
    $fingerprint = Get-KeystoreFingerprint $keytool $props
    if ($linked -eq $templateFingerprint) {
        # A key restored from a backup into a checkout that never had it written in.
        $links = [System.IO.File]::ReadAllText($assetlinks).Replace($templateFingerprint, $fingerprint)
        [System.IO.File]::WriteAllText($assetlinks, $links, $utf8)
        Note "Wrote the key's fingerprint into assetlinks.json. Commit and deploy it."
    } elseif ($linked -ne $fingerprint) {
        Fail ("android.keystore ($fingerprint) is not the key assetlinks.json names ($linked).`n" +
            'Use the keystore from your backup that matches it.')
    }
    Write-Host "Key: $fingerprint"
}

# ---------------------------------------------------------------------------
Step 'Capacitor'

Push-Location $here
try {
    if (-not (Test-Path (Join-Path $here 'node_modules'))) {
        if ((Invoke-Tool 'npm.cmd' @('ci', '--no-audit', '--no-fund')) -ne 0) { Fail 'npm ci failed.' }
    }
    if ((Invoke-Tool 'npx.cmd' @('cap', 'sync', 'android')) -ne 0) { Fail 'npx cap sync android failed.' }
} finally {
    Pop-Location
}

$firebase = Join-Path $native 'app\google-services.json'
if (Test-Path $firebase) {
    Write-Host 'Firebase: google-services.json found, notifications on.'
} else {
    Note 'Firebase: no google-services.json, so this build has no notifications. See android\FIREBASE-SETUP.md.'
}

# ---------------------------------------------------------------------------
Step 'Gradle: assembleRelease'

$gradle = Start-Process -FilePath (Join-Path $native 'gradlew.bat') `
    -ArgumentList 'assembleRelease', '--console=plain' `
    -WorkingDirectory $native -NoNewWindow -Wait -PassThru
if ($gradle.ExitCode -ne 0) { Fail 'The Gradle build failed. The error is above.' }

# The phone's and the watch's, each from its module's release folder.
function Get-Apk([string]$module, [string]$what) {
    $outputs = Join-Path $native "$module\build\outputs\apk\release"
    $apk = Join-Path $outputs "$module-release.apk"
    if (-not (Test-Path $apk)) {
        if (Test-Path (Join-Path $outputs "$module-release-unsigned.apk")) {
            Fail "Gradle made an unsigned $what APK: keystore.properties was not picked up."
        }
        Fail "No $what APK at $apk."
    }
    return $apk
}

$apk = Get-Apk 'app' 'phone'
$watchApk = Get-Apk 'wear' 'watch'

# ---------------------------------------------------------------------------
Step 'Checking the signatures'

$expected = (Get-AssetlinksFingerprint).Replace(':', '')

# The phone's must be the key every installed copy has, or none can update; the
# watch's must be the same, or the Wearable Data Layer won't let the two talk.
function Test-Signed([string]$apk, [string]$what) {
    $verify = Get-ToolOutput $apksigner @('verify', '--print-certs', $apk)
    if ($verify.Code -ne 0) { Fail "apksigner refused the $what APK:`n$($verify.Text)" }
    $match = [regex]::Match($verify.Text, 'certificate SHA-256 digest:\s*([0-9a-fA-F]{64})')
    if (-not $match.Success) { Fail "apksigner did not print the $what APK's SHA-256:`n$($verify.Text)" }
    $signed = $match.Groups[1].Value.ToUpper()
    if ($signed -ne $expected) {
        Fail "The $what APK is signed with $signed, not the key in assetlinks.json ($expected)."
    }
}

Test-Signed $apk 'phone'
Test-Signed $watchApk 'watch'
Write-Host 'Both signed with the key in assetlinks.json.'

# ---------------------------------------------------------------------------
Step 'Copying to release\'

$dir = Join-Path $repo "release\$versionName"
$target = Join-Path $dir "$apkName-$versionName.apk"
$watchTarget = Join-Path $dir "$apkName-$versionName-watch.apk"
if ((Test-Path $target) -or (Test-Path $watchTarget)) {
    Note "release\$versionName already has APKs, and they are being replaced. If that version was"
    Note 'published, raise versionCode and versionName in android\native\app\build.gradle instead.'
}
New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item $apk $target -Force
Copy-Item $watchApk $watchTarget -Force

Write-Host ''
foreach ($built in $target, $watchTarget) {
    $hash = (Get-FileHash $built -Algorithm SHA256).Hash.ToLower()
    $size = [math]::Round((Get-Item $built).Length / 1MB, 1)
    Write-Host "Built: release\$versionName\$(Split-Path $built -Leaf) ($size MB)" -ForegroundColor Green
    Write-Host "SHA-256: $hash"
}
Write-Host ''
Write-Host 'Next:'
Write-Host "  1. Commit both APKs with the code (and assetlinks.json on a first build); deploy the site first."
Write-Host "  2. GitHub > Releases > new release, tag android-v$versionName, attach both APKs before"
Write-Host '     publishing, and tick Set as the latest release. See release\README.md.'
Write-Host '  3. Installing the watch app: android\native\wear\README.md.'
