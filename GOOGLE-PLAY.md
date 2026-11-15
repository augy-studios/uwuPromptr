# Putting uwuPromptr on Google Play

A step-by-step guide to publishing the Android app on Google Play, for the repo as it stands at
2.0.0 (15 November 2026). Google changes its Play rules often: each rule below says where it
comes from, so re-check that page if this date is far behind you.

**What's done in the repo already:** the Play build (`flutter\build-apk.ps1 -Aab`) makes a signed,
shrunk and obfuscated App Bundle with no updater of its own, and checks it; the release notes and
store graphics are written and drawn (`announcements/`, `docs/*-assets/`, `docs/feature-graphic.png`);
the Privacy page is at <https://cue.uwuapps.org/privacy>. **What's left is yours:** the account, the
decisions in section 3, and the clicks in Play Console.

## Contents

1. [The short version](#1-the-short-version)
2. [What the Play build is](#2-what-the-play-build-is)
3. [Decisions to make](#3-decisions-to-make)
4. [Step 1: Build the App Bundle](#4-step-1-build-the-app-bundle)
5. [Step 2: Developer account](#5-step-2-developer-account)
6. [Step 3: Create the app](#6-step-3-create-the-app)
7. [Step 4: Store listing](#7-step-4-store-listing)
8. [Step 5: App content (the Dashboard tasks)](#8-step-5-app-content-the-dashboard-tasks)
9. [Step 6: Data safety](#9-step-6-data-safety)
10. [Step 7: Testing tracks, then production](#10-step-7-testing-tracks-then-production)
11. [After launch](#11-after-launch)
12. [Checklist](#12-checklist)

---

## 1. The short version

- Google Play takes an **Android App Bundle** (`uwupromptr-<version>.aab`), not the APK on
  GitHub. `release/2.0.0/uwupromptr-2.0.0.aab` is ready.
- It's the same app as the GitHub APK, with the same package (`org.uwuapps.cue`) and signing key,
  minus the self-updater, which Play forbids: Play updates it instead.
- The bundle is shrunk and obfuscated as Play recommends (R8 for the Java and its libraries,
  unused resources removed, Dart obfuscated with its symbols split off), and carries R8's mapping
  and the native symbol tables, so Play Console's crash reports and its "deobfuscation file"
  warning are covered.
- Play App Signing is required. Give Play **your existing key** (section 3, D1), and installs from
  GitHub and from Play update each other: a phone on the GitHub 1.0.0 or 2.0.0 APK takes the Play
  version as an update, scripts kept.
- The **Wear OS watch app** stays on GitHub only for now (section 11 says how to add it to Play
  later).
- A new personal developer account must run a **closed test with 12 testers for 14 days** before
  it can publish to everyone. Plan on about three weeks.

## 2. What the Play build is

| | GitHub APK | Play App Bundle |
|---|---|---|
| Built with | `build-apk.ps1` | `build-apk.ps1 -Aab` |
| Updater | Updates page, update bar, downloads and installs the APK | None: Play updates it. The Updates page still lists every version, with **Update on Google Play** |
| `REQUEST_INSTALL_PACKAGES` | Yes | Removed (`flutter/android/app/src/play/AndroidManifest.xml`), and the script checks it's gone |
| Advertising ID (`AD_ID`) | Never: removed from the manifest | The same, and the script checks it's gone |
| New version alerts | Yes, with Firebase | Yes, with Firebase (optional on Play: Play notifies too) |
| Processors | ARM 32 and 64 bit in one APK | Play delivers each device only what it needs, x86_64 Chromebooks included |
| Signed with | `flutter\android.keystore` | The same, as the upload key; Play re-signs with the app signing key (D1) |

The app asks for these permissions, each only when it's needed:

- **Internet** and **network state**: the remote's pairing, Report a bug, the update check.
- **Post notifications** (Android 13+): only when New version alerts is turned on.
- **Nearby devices** (Bluetooth scan, advertise, connect; nearby Wi-Fi devices on Android 13+):
  only when the offline remote is used (**Let a nearby phone connect** or **Connect nearby**).
- **Location** (fine and coarse, **Android 11 and 12 only**, `maxSdkVersion` 31): Android needs it
  for Bluetooth scanning on those versions, for the same offline remote. Foreground only, never
  background, so no location declaration form is needed; the store listing and the Privacy page
  say what it's for.
- **Wake lock**: the screen held on while the script scrolls or a remote is connected.

Target SDK: Flutter 3.47's default (36), which Play requires for new apps from 31 August 2026.

## 3. Decisions to make

| | Decision | Recommended |
|---|---|---|
| D1 | **Which key Play signs with.** Your existing key, uploaded once to Play App Signing, keeps the GitHub APK and the Play app able to update each other, and keeps `main-site/.well-known/assetlinks.json` as it is (remote links and QR codes keep opening the app). A key Play makes means a Play install can't update a GitHub install (and the other way round): people would uninstall first, and lose the scripts on their phone. | Your existing key |
| D2 | **Personal or organisation account.** Personal is quicker, but has the 12-tester rule. Organisation needs a registered business (a D-U-N-S number). | Personal (or the account your other UwU Apps already use) |
| D3 | **Countries.** uwuPromptr isn't tied to a place. | Every country |
| D4 | **Privacy policy URL.** Play requires one: `https://cue.uwuapps.org/privacy` (`main-site/privacy.html`, linked from Prompter settings in the site and the apps). Keep it and section 9 saying the same things. | Done |
| D5 | **Category.** Teleprompters sit in Productivity or Video Players & Editors. | **Productivity** |

## 4. Step 1: Build the App Bundle

In PowerShell, from the project root, with `android.keystore` and `keystore.properties` in
`flutter\` (they're not in git: restore them from your backup; they're the same files the 1.0.0
app was signed with):

```powershell
powershell -ExecutionPolicy Bypass -File flutter\build-apk.ps1 -Aab
```

It writes `release\<version>\uwupromptr-<version>.aab`, and refuses to finish unless the bundle:

- is signed with the app's key (SHA-256 `92:56:49:17:9E:D8:7E:0F:F4:72:40:3D:E0:F3:15:B9:DD:12:20:C1:CD:B4:7F:A8:8B:22:86:DA:57:11:DB:7A`);
- has no `REQUEST_INSTALL_PACKAGES` and no `AD_ID` in its manifest;
- carries `BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map` (R8's mapping, which
  Play reads for crash reports) and the stripped symbol tables of `libflutter.so` and `libapp.so`.

Beside it, `uwupromptr-<version>-play-mapping.txt` and `-play-symbols.zip` stay on your computer
(git-ignored): with them, `flutter symbolize` reads an obfuscated Dart stack trace from Play's
crash reports.

Every upload needs a higher `versionCode` than any before it. `build-apk.ps1` raises it by itself
on every run (the `+N` in `flutter\pubspec.yaml`), APK or bundle, so a fresh build is always
uploadable; commit `pubspec.yaml` with it.

## 5. Step 2: Developer account

1. Sign in to the Google account that will own the app, with 2-Step Verification on.
2. Register at <https://play.google.com/console/signup>: **US$25, once**, by a card in the
   account holder's name. You must be 18 or older and accept the Developer Distribution
   Agreement; Google may ask for government ID ([registration](https://support.google.com/googleplay/android-developer/answer/6112435)).
   Already have an account for SG Bus Timings or another UwU App? Use that one, and skip to
   step 3.
3. Choose **personal** (D2), and complete **identity verification**. Allow a few days, and don't
   create the app until it's done. Personal accounts also confirm an Android device through the
   Play Console app.
4. **Developer verification**: creating the app in Play Console registers the package name
   `org.uwuapps.cue` to your account ([developer verification](https://developer.android.com/developer-verification)).
   If you registered it on the Android Developer Console for the 1.0.0 APK, Play Console shows it
   as yours already. Check the Home page afterwards: it covers the GitHub APK too, as both use the
   same package and key.

## 6. Step 3: Create the app

1. **Create app**: name `uwuPromptr`, default language **English (United Kingdom)** (`en-GB`), as
   the app and its notes are written, **App**, **Free**, your contact email. Accept the
   declarations.
2. **Test and release** > **Setup** > **App signing** (or when you create the first release):
   choose **Use a different key** > **Export and upload a key from Java keystore**, and follow
   Play's steps with its PEPK tool and `flutter\android.keystore` (D1). The key's alias is in
   `flutter\keystore.properties`. Use the same key as the **upload key** too. Afterwards, the page
   shows the **app signing key certificate**: its SHA-256 should be the one in section 4. If it
   differs (you let Play make a key), add Play's SHA-256 to
   `main-site/.well-known/assetlinks.json` beside the existing one and deploy, so remote links
   still open the app ([Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756)).
3. The package name comes from the first bundle you upload. **It's permanent.**

## 7. Step 4: Store listing

**Grow users** > **Store presence** > **Main store listing**
([asset specs](https://support.google.com/googleplay/android-developer/answer/9866151)):

| Field | Limit | uwuPromptr |
|---|---|---|
| App name | 30 | `uwuPromptr` |
| Short description | 80 | `A teleprompter that works offline, with fine speed control and a phone remote` (77) |
| Full description | 4,000 | Below |
| App icon | 512 × 512 PNG | `main-site/UPC-512.png` |
| Feature graphic | 1024 × 500, no alpha | `docs/feature-graphic.png` |
| Phone screenshots | 2 to 8 | `docs/phone-assets/01…08` (1620 × 2880) |
| 7-inch tablet screenshots | up to 8 | `docs/tablet-assets/7-inch/01…08` (1620 × 2880) |
| 10-inch tablet screenshots | up to 8 | `docs/tablet-assets/10-inch/01…08` (2880 × 1620) |
| Chromebook screenshots | up to 8 | `docs/desktop-assets/01…08` (2880 × 1620) |
| Category | one | **Productivity** (D5) |
| Tags | up to 5 | Teleprompter, Video, Productivity, Presentations, Remote control (whichever of these Play offers) |
| Contact | email, website | Your email; `https://cue.uwuapps.org` |

Upload the screenshots in their numbered order: the first three show in search results.

Full description:

```text
uwuPromptr is a teleprompter that works offline. Write a script, press play, and it scrolls at the speed you set.

FINE CONTROL WHILE IT RUNS
Speed moves a tenth at a time and the font a pixel at a time, with bigger steps when you want them, all while the script scrolls. Set the line height, the side margins and where the focus line sits, and keep a clock of how long you've been reading.

FOR TELEPROMPTER GLASS
Mirror the script across or upside down for a beam-splitter rig, go full screen, and turn the screen to its brightest for reading through glass or outdoors. The screen stays on while the script plays.

YOUR PHONE AS THE REMOTE
Open Remote control for a six-letter code, and type it on another phone, tablet or computer to drive the prompter: play and pause, faster and slower, a bigger or smaller font, jump to any point, and even rewrite the script, with a live copy of the prompter's screen in your hand. It works with the uwuPromptr website on any device too.

NO WIFI? PHONE TO PHONE
With uwuPromptr on both phones, the remote connects over Bluetooth and Wi-Fi Direct, with no router and no mobile data.

CLICKERS AND VOLUME KEYS
Start and stop with either volume key, a Bluetooth selfie shutter or a headset's button.

AS MANY SCRIPTS AS YOU LIKE
Keep every script, switch between them in a tap, and paste from a word processor: smart quotes and stray line breaks are cleaned up as they come in.

YOUR LOOK
Material You by default: your phone's font and, on Android 12 and later, your wallpaper's colours. Prefer uwuPromptr's own look? Switch to the UwU Apps theme for its seven brand colours. Light, dark, or time-based.

PRIVATE BY DESIGN
No account, no ads, no analytics. Your scripts stay on your phone, and the remote sends them straight from one device to the other.

ALSO
A short tour of each page the first time you open it, Report a bug with a screenshot and a report ID, and the uwuPromptr app for Windows, macOS and Linux, and the website at cue.uwuapps.org.
```

## 8. Step 5: App content (the Dashboard tasks)

**Policy and programmes** > **App content**
([prepare your app for review](https://support.google.com/googleplay/android-developer/answer/9859455)):

| Task | Answer |
|---|---|
| Privacy policy | Your URL (D4) |
| Ads | **No ads** |
| App access | **All functionality is available without special access**: there are no accounts |
| Content rating | Fill the questionnaire: a productivity tool, no violence, no gambling, no shared public content. Users can't talk to each other: the remote connects one person's own devices by a code they type |
| Target audience | 13 and over; not designed for children |
| News app | No |
| Government app | No |
| Financial features | None |
| Health | No |
| Advertising ID | **No**: the app has no ads or analytics SDK, and its manifest removes the permission |
| Account deletion | Not required: the app has no accounts and no sign-up |
| Nearby / location | If asked: location is requested on Android 11 and 12 only, in the foreground, because Android needs it to scan for Bluetooth devices for the offline remote. It's never read or stored |

## 9. Step 6: Data safety

**App content** > **Data safety**
([form help](https://support.google.com/googleplay/android-developer/answer/10787469)). Data is
"collected" when it leaves the phone to the developer; data used only on the phone isn't, and
neither is data sent with end-to-end encryption between the user's own devices that the developer
can't read. The scripts never reach uwuPromptr's server.

| Data type | What happens | Declare |
|---|---|---|
| Other user-generated content | What's typed in Report a bug, sent on to Telegram. (Scripts go only between the user's own devices, end to end encrypted, over the remote) | Collected, **optional** (only when someone sends a report), App functionality |
| Email address | Only if someone leaves an email in Report a bug as the way to reach them | Collected, optional, App functionality |
| Photos | Up to three pictures added to Report a bug, sent on to Telegram | Collected, optional, App functionality |
| Diagnostics (App info and performance) | Report a bug adds the app's version, the device and system as the app describes them, and the page on show, all shown before it's sent | Collected, optional, Analytics |
| Device or other IDs | Only with New version alerts on: Firebase subscribes the phone to a topic, through Google's servers; uwuPromptr's server keeps no ID | Collected, optional, App functionality (Firebase Cloud Messaging) |
| Approximate or precise location | Not collected: the permission is for Bluetooth scanning on Android 11 and 12, and nothing is read | Not collected |
| IP address | PeerJS's introduction service sees both devices' IP addresses while it connects them; Report a bug counts reports per IP address, for a minute (and an hour, with Redis), to stop floods | Disclose under the privacy policy |
| Contacts, calendar, messages, health, financial info, web history, files | Not used | Not collected |

Other answers:

- **Encrypted in transit**: **Yes** (HTTPS for the site's API, DTLS for the remote's WebRTC
  channel, Nearby Connections' encryption for the offline remote).
- **Can people ask for data to be deleted?** **Yes**: there's no account; the scripts are on the
  phone (uninstalling deletes them), and bug reports are deleted on request by email, quoting the
  report's ID, as the Privacy page says.
- **Shared with third parties?** No: Vercel (the server), Firebase and Telegram (which delivers
  bug reports to you) are service providers working for uwuPromptr, which Play doesn't count as
  sharing.
- Check the SDKs' own notes in the [Play SDK Index](https://play.google.com/sdks): Firebase
  Messaging, Google Play services (Nearby, Wearable), flutter_webrtc.

## 10. Step 7: Testing tracks, then production

1. **Internal testing**: **Test and release** > **Testing** > **Internal testing** > **Create new
   release**, upload `uwupromptr-2.0.0.aab`, paste the release notes from
   `announcements/play-release-notes-2.0.0.md`, and add yourself and a few testers by email. No
   review in the usual case. Use it to check:
   - a phone with the **GitHub APK** installed takes the Play version as an update, scripts kept
     (only with D1's existing key, and only when the Play bundle's `versionCode` is higher than the
     APK's: the 2.0.0 bundle's is, as it's built after the APK);
   - the Updates page shows **Update on Google Play**, and there's no update bar;
   - the remote pairs with the website, and the offline remote between two test phones.
2. **Closed testing**, for a new personal account
   ([testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465)):
   a closed track with **at least 12 testers opted in for 14 days in a row**. Invite 15 or so (the
   UwU Apps Telegram channel is a good place), so a few dropping out doesn't restart the clock.
3. **Apply for production** from the Dashboard once that's met, and answer its three sections.
   Google usually replies within seven days.
4. **Production**: create the release (the same bundle, or a newer one), the release notes, the
   countries (D3), and **Start rollout**. The first review can take a few days.

## 11. After launch

- **Every update**: raise the version name, `build-apk.ps1 -Aab` (the code goes up by itself),
  upload to a track, paste `announcements/play-release-notes-<version>.md`, roll out. The GitHub
  release goes on as before with the APKs (`release/README.md`).
- **Point people to Play**: add the Play link to the site and the GitHub release notes once it's
  live.
- **The watch app on Play, later**: Play takes a Wear OS app as its own bundle on the same listing
  (**Advanced settings** > **Form factors** > **Wear OS**), with Wear screenshots and a review of
  its own. It'd need `flutter/android/wear/` built as a bundle; until then the `-watch.apk` stays
  on GitHub.
- **Target API each year**: Play raises the required target SDK every August. Upgrading Flutter
  raises it; check `targetSdk` in the built bundle's manifest
  ([target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878)).
- **Crashes**: Play Console > **Quality** > **Android vitals**. Java stack traces are readable
  thanks to the mapping in the bundle; for Dart ones, `flutter symbolize -i <trace> -d
  <unzipped -play-symbols.zip>`.

## 12. Checklist

- [ ] D1–D5 decided; the privacy policy page live (deploy the site)
- [ ] `flutter\android.keystore` and `flutter\keystore.properties` backed up somewhere safe
- [ ] `uwupromptr-<version>.aab` built with `-Aab`, its checks passed
- [ ] Developer account registered and verified
- [ ] App created; App Signing set up with the existing key; its SHA-256 matches section 4
- [ ] Store listing: text, icon, feature graphic, phone, tablet and Chromebook screenshots
- [ ] App content tasks answered; Data safety filled
- [ ] Internal test installed and checked
- [ ] Closed test: 12+ testers, 14 days; production applied for and approved
- [ ] Production rolled out; the site links to Play
