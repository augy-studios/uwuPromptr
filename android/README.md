# uwuPromptr for Android

The live site, [cue.uwuapps.org](https://cue.uwuapps.org), in
[Capacitor](https://capacitorjs.com)'s WebView, plus a thin native layer for what a web page
can't do. Package **`org.uwuapps.cue`**. Shared as a signed APK from GitHub Releases, not
Google Play.

The site stays the product: a deploy reaches the app the next time it opens, so the APK only
needs rebuilding when something in this folder changes. The website and the PWA lose nothing.
Every app-only feature switches on only inside the app, and only when the app says it can
do it (`AppBridge.has()`), so an older APK under a newer site just shows less.

`android-app-spec.md` at the repository root is the pattern this follows.

## Build it: one command

From the repository root, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File android\build-apk.ps1
```

It finds Java and the Android SDK, makes the signing key on the first run, syncs Capacitor,
builds the phone's app and the Wear OS watch's, checks both signatures, and leaves the APKs at:

```text
release\<versionName>\uwupromptr-<versionName>.apk         the phone's
release\<versionName>\uwupromptr-<versionName>-watch.apk   the watch's (native\wear\README.md)
```

Both share the key and the version: raise it in `native\app\build.gradle` only.

You need **JDK 21 or newer** (JDK 24 works; the script finds Temurin, Oracle and Microsoft
installs, or `JAVA_HOME`), the **Android SDK** (Android Studio's, or `ANDROID_HOME`), and
**Node.js**. The first build downloads Gradle and the libraries, a few minutes.

### The first build makes the signing key

On the first run the script makes `android\android.keystore` and `android\keystore.properties`
(a 4096-bit RSA key, random password) and writes the key's SHA-256 into
`main-site\.well-known\assetlinks.json`. Then:

1. **Back up both files** to your password manager straight away. They are git-ignored and
   exist nowhere else. Lose them and no installed phone can ever be updated: everybody would
   have to uninstall and reinstall.
2. **Commit and deploy `assetlinks.json`.** Until it is live, links to cue.uwuapps.org open in
   the browser rather than the app.
3. **Register the package for Android developer verification** on the Android Developer
   Console, with `org.uwuapps.cue` and the key's SHA-256 (the script prints it). From 30
   September 2026 in Singapore, Brazil, Indonesia and Thailand, Play Protect warns about, and
   as it rolls out blocks, apps from unregistered developers.

Every later build reuses the key. If `assetlinks.json` names a key and the keystore is
missing, the script **stops** rather than make a second one.

### Each release

1. Raise **`versionCode`** (+1) and **`versionName`** in `native\app\build.gradle`. Phones only
   accept a higher `versionCode`.
2. Run the build command.
3. Commit both APKs with the code, deploy the site first if the release needs anything new from
   it, then publish on GitHub: see `release\README.md`.

### Android Studio

`npx cap open android` (from this folder) opens `native\` in Android Studio, for running on a
phone with the debugger. That build is signed with Android's debug key, so installing the
release APK over it fails with "App not installed": uninstall first.

## What the app adds to the site

| Feature | Where | Why the app |
| --- | --- | --- |
| **Check for updates** | Download-arrow button in the side Edge Tray | Checks the site and the app in one press; the app's own updater installs with Android's installer |
| **Update bar** | Top of the screen, when a newer APK is on GitHub | Same bar as the site's "new version" bar; **Update** downloads and installs |
| **Full brightness** | Phone-with-rays button in the side Edge Tray | The screen at its brightest while the app is open, to read through teleprompter glass or in sunlight. Only this app's window: the phone's own setting is untouched |
| **Screen stays on** | Automatic, while playing or while a remote is connected | The WebView has no Screen Wake Lock API |
| **Fullscreen** | Fullscreen button in the side Edge Tray, or F | Hides the navigation bar too; the Fullscreen API is unreliable in a WebView |
| **Volume keys start and stop** | Prompter settings > Android app | Either volume key, a Bluetooth selfie shutter, or a headset's button starts and stops the script |
| **Offline remote** | Remote panel > **Let a nearby phone connect**; on the other phone, the remote page's **Connect nearby** | Two phones with the app link directly over Bluetooth and Wi-Fi Direct (Google Nearby Connections), with no router and no mobile data |
| **New version alerts** | Prompter settings > Android app | A notification when a new APK is published. Needs Firebase: `FIREBASE-SETUP.md` |
| **Wear OS watch remote** | The uwuPromptr watch app and its **Prompter remote** tile | Play, pause, restart, and the speed on the crown, for the prompter on this phone or through its remote page; wrist taps to keep time. A separate APK: `native/wear/README.md` |
| Links open in the app | cue.uwuapps.org links, and `uwu://cue/remote?id=XXXXXX` | Once `assetlinks.json` is deployed with the real key |

The status bar is hidden (swipe down to see it), and its icons follow the page's light or
dark mode. Back goes back through the page, then sends the app to the background rather than
closing it.

### The offline remote, in more detail

- Both phones need the app and Google Play services. The prompter phone opens the remote
  panel and taps **Let a nearby phone connect**; the remote phone opens the remote, types the
  same ID, and taps **Connect nearby, without wifi**.
- The prompter advertises under a name made from a hash of its ID, so the ID itself never
  goes out over the air. It is sent once the encrypted connection is up, and a phone that
  sends the wrong one is dropped.
- It carries exactly the web remote's messages, so everything the remote does (play, speed,
  font, the scrubber, the mirror of the screen, editing) works the same.
- Nearby may move the link onto Wi-Fi Direct for speed. On some phones that briefly drops the
  phone's own Wi-Fi connection while the remote is connected.

### Gemini's suggestions not built, and why

The brief asked for native features only where they are needed. Left out:

- **True OLED black, mirroring**: the site already mirrors both ways, and a pure-black
  background is a site setting, not a native one, so it would belong in the site.
- **Broadcast mode** (one director, many prompters): a different remote model (one sender,
  many receivers) on both ends; worth its own design.
- **Voice-follow scrolling, clap or snap triggers, nod and wink gestures, the eye-contact
  camera**: each needs the microphone or the camera and a sizeable feature of its own.
- **Floating overlay over other apps** (`SYSTEM_ALERT_WINDOW`), **full-screen intent alerts**,
  **battery optimisation exemption**: Google scrutinises all three, and nothing here needs
  them. A prompter in front keeps running; the screen-on flag covers long takes.
- **A ColorOS watch app**: ColorOS's watch software isn't open. The Wear OS app (`native/wear/`)
  rebuilds its crown, low-power display and motion gestures from what Wear OS offers, and runs
  on OPPO's and OnePlus's own Wear OS watches too.

## Permissions

None is asked at launch. Each is asked at the moment a feature needs it.

| Permission | Asked when | Notes |
| --- | --- | --- |
| `INTERNET`, `ACCESS_NETWORK_STATE` | Never (install time) | The site |
| `REQUEST_INSTALL_PACKAGES` | The first update | Android 8+ sends you to **Install unknown apps** for uwuPromptr; Android 8 to 10 restart the app when it is granted, and the updater carries on by itself |
| `POST_NOTIFICATIONS` | Turning on **New version alerts** | Android 13+ only. Refused twice, only Android's settings can turn it on; the app offers a button there |
| `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`, `NEARBY_WIFI_DEVICES` | **Let a nearby phone connect** or **Connect nearby** | One "Nearby devices" prompt on Android 12+ (Wi-Fi devices from 13) |
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | The same buttons, Android 11 and older (and 12 alongside Bluetooth) | Before Android 12, Nearby needs location, and location must be **switched on** too; the page says so |
| `BLUETOOTH`, `BLUETOOTH_ADMIN`, `ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE` | Never (install time, old Android only) | Nearby on older versions |

Bluetooth, Wi-Fi and location are declared optional, so a phone without them still installs
the app and only loses the offline remote.

## What's where

```text
android/
  package.json, package-lock.json   Capacitor 8.5.3 and push-notifications 8.1.3, pinned
  capacitor.config.json             loads https://cue.uwuapps.org; user agent tag uwuPromptrApp/1
  www/offline.html                  shown only on a first launch with no connection
  build-apk.ps1                     the one command
  FIREBASE-SETUP.md                 New version alerts, step by step
  native/                           the Gradle project (Android Studio opens this)
    app/build.gradle                versions, signing, Firebase and Nearby
    app/src/main/AndroidManifest.xml
    app/src/main/java/org/uwuapps/cue/
      MainActivity.java             window, back, links, notification taps, key forwarding
      CuePlugin.java                everything the page can ask for (the "Cue" plugin)
      NearbyLink.java               the offline remote over Nearby Connections
      WatchLink.java                the Wear OS watch's messages, to and from the page
      UpdateActivity.java           checks, downloads, verifies and installs updates
      InstallStatus.java            hears back from Android's installer
      Notifications.java            the "New versions" channel
    app/src/main/res/               icons and splash (from main-site/UPC-main.png), colours,
                                    values-night for dark mode
    wear/                           the Wear OS watch app, built with the phone's (wear/README.md)

main-site/                          the site's side
  js/app-bridge.js                  the channel to the app; has(), call(), on()
  js/app-native.js                  the app-only buttons and settings
  js/app-update.js                  the release check and the bar's Update
  js/nearby.js                      the offline remote's page side
  js/watch.js                       the Wear OS watch's page side
  api/app-release.js                the newest release, for the updater (cached 10 minutes)
  api/push/release.js               GitHub webhook: the "new version" notification
  api/_push/fcm.js, api/_lib/release.js
  .well-known/assetlinks.json       the signing key's fingerprint, for verified links
```

Generated by `npx cap sync` and git-ignored: `native/capacitor-cordova-android-plugins/`,
`native/app/src/main/assets/public/`, `native/app/src/main/assets/capacitor.*.json`.
`native/capacitor.settings.gradle` and `native/app/capacitor.build.gradle` are rewritten on
every sync too; they are committed, but never edit them.

## Checking a build on a phone

- Opens to the prompter with no white flash, in light and dark phone modes. No status bar;
  nothing under the gesture bar.
- Swipe down: the status bar's icons match the page's mode, after switching theme too.
- Back goes back from the remote page, then sends the app to the background.
- Airplane mode on a fresh install: the offline page. After one visit: the prompter, offline.
- The three Edge Trays: the side tray has **Full brightness** and **Check for updates** before
  the theme button, and they unroll with the rest.
- **Check for updates** says "You have the newest version, 1.0.0".
- **Full brightness**, **Fullscreen**, **Volume keys start and stop**: each does what it says,
  and none of them carries over to the remote page.
- Offline remote, both phones in airplane mode with Bluetooth on: connects, drives the
  prompter, survives the remote page reloading, and a **Disconnect** gives the prompter a new
  ID.
- Each permission: allow, refuse, and refuse for good; the page says what to do each time.
- A `uwu://cue/remote?id=XXXXXX` link opens the remote with the ID filled in.
- The same site in Chrome: no app-only buttons or settings anywhere.
