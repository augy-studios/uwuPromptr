# Releases

Each Android build lives here, committed, one folder per version: the phone's APK and the
Wear OS watch's beside it.

```text
release/
  1.0.0/uwupromptr-1.0.0.apk
  1.0.0/uwupromptr-1.0.0-watch.apk
```

`android\build-apk.ps1` builds both into their folder (see `android/README.md`). Only the APKs
and this README are tracked here: the root `.gitignore` ignores everything else under
`release/`. The desktop installers are built by GitHub Actions and live only on the GitHub
release, as at 80 to 110 MB each GitHub refuses them in git. This file is how to publish a
version of all of them.

## Publishing a version

The Android app, the watch app and the desktop apps share a version number and one GitHub
release, tagged `android-v<version>`.

1. **Raise the version** in both apps:
   - `android/native/app/build.gradle`: `versionCode` up by one, `versionName` to the new
     version. A phone only accepts a higher `versionCode`. The watch app reads both from here.
   - `desktop/package.json`: `version` to the same, then `npm install` in `desktop/` so
     `package-lock.json` follows.
2. **Build the APKs**: `powershell -ExecutionPolicy Bypass -File android\build-apk.ps1`. One
   command makes both, the phone's and the watch's.
3. **Deploy the site first** if this release needs anything new from it, then **commit the
   code and both APKs together** and push. The push builds the desktop apps as a check (the
   **Actions** tab, **Build desktop apps**), without releasing anything.
4. **Make the release, with the desktop installers**: **Actions** > **Build desktop apps** >
   **Run workflow**, with the tag `android-v<version>` (for example `android-v1.0.0`). It
   builds Windows, macOS and Linux (about ten minutes) and puts them on a **draft** release of
   that tag. Nobody's app sees a draft, so nothing updates yet.
5. On GitHub: **Releases** > the draft > **Edit**.
   - **Release title**: `uwuPromptr <version>`.
   - **Attach both APKs** from `release/<version>/` and **wait for them to finish uploading
     before publishing**. The "new version" notification goes out on publish, and only for a
     release whose APK is there. Phones are only ever offered the phone's: the updater skips
     the `-watch.apk`.
   - Check the desktop files are all there: two `.exe`/`.msi`, two `.dmg` and two `.zip`, the
     `.deb`, the `.AppImage`, the `.blockmap`s, and `latest.yml`, `latest-mac.yml`,
     `latest-linux.yml`. Without the `.yml` files no desktop app sees the version.
   - Paste the release notes into **Describe this release** (below).
   - Leave **Set as a pre-release** unticked, tick **Set as the latest release**, and
     **Publish release**.
6. Within ten minutes every phone offers the update in its bar, and anybody with **New
   version alerts** on gets a notification straight away. The desktop apps find it within the
   hour, or at once from **Check for updates...** in the tray.
7. Post the announcement.

Publishing a release by hand without step 4 works too: the workflow sees the release and adds
the desktop installers a few minutes later.

Watches don't update themselves: somebody with the watch app installs the new `-watch.apk`
over it, as in `android/native/wear/README.md`. The release notes' **Updating** section says
so, and the Download table keeps its `Wear OS 3 or newer watch` row.

Things that stop the update reaching phones: a tag without `android-v`, a draft or
pre-release, the APK still uploading, a `versionCode` not raised, or the repository made
private. Desktop apps also miss it when a `latest*.yml` is missing, or `desktop/package.json`
wasn't raised (the workflow refuses a tag that doesn't match it).

## Writing the release notes

Three pieces, for three readers (`android-app-spec.md` section 4.5 has the full house style):

- **Release notes**, in the GitHub release: for somebody about to download. Every feature as
  `- **Name**: what it does for you.` Name controls as the app shows them, in bold. "You",
  present tense, British spelling. Only what works in this build: leave out **New version
  alerts** until Firebase is set up (`android/FIREBASE-SETUP.md`). One line per paragraph or
  bullet, unwrapped: GitHub may show a line break inside a paragraph as a break, as it does in
  issues, and unwrapped text reads right either way.
- **Announcement**, pasted as plain text from a code block: `✨UPDATE✨ uwuPromptr <version>`,
  four to six short lines, ending with the `releases/latest` link.

## First release: 1.0.0

- **Tag**: `android-v1.0.0`
- **Title**: `uwuPromptr 1.0.0`
- **Attach**: `uwupromptr-1.0.0.apk` and `uwupromptr-1.0.0-watch.apk`

Firebase is set up for this build, so both **New version alerts** bullets stay.

### Release notes

```markdown
The first uwuPromptr apps, for Android, Wear OS, Windows, macOS and Linux: the teleprompter at full brightness and a remote that needs no wifi on your phone, play, pause and the speed on your watch's crown, and on your computer a prompter that stays on top of your slides and answers a foot pedal from any app.

## Download

| Device | File |
| --- | --- |
| Android 7.0 or newer | `uwupromptr-1.0.0.apk` |
| Wear OS 3 or newer watch, paired with an Android phone | `uwupromptr-1.0.0-watch.apk` |
| Windows 10 or 11 | `uwupromptr-1.0.0-setup.exe` (or the `.msi`, for installing on many computers at once) |
| Mac with Apple silicon (M1 and later) | `uwupromptr-1.0.0-mac-arm64.dmg` |
| Mac with an Intel processor | `uwupromptr-1.0.0-mac-x64.dmg` |
| Debian, Ubuntu, Mint | `uwupromptr-1.0.0-amd64.deb` |
| Any other Linux | `uwupromptr-1.0.0-x86_64.AppImage` |

On an iPhone or any other device, use [cue.uwuapps.org](https://cue.uwuapps.org) in the browser, and add it to your home screen to install it as an app.

## Installing

- **Android**: download the `.apk` on your phone and open it. If Android asks, allow your browser to install apps. If Play Protect asks about the app, tap **More details** > **Install anyway**.
- **Wear OS watch**: a watch can't download the app itself, so it goes on from a computer with `adb`, or from your phone with an app that installs apps on watches (Wear Installer and the like). The steps are in [the watch app's guide](https://github.com/augy-studios/uwuPromptr/blob/main/android/native/wear/README.md#installing-it-on-a-watch). The watch works with the uwuPromptr app on its paired phone, so install that first.
- **Windows**: open the `.exe`. Windows says "Windows protected your PC" the first time: click **More info** > **Run anyway**.
- **Mac**: open the `.dmg` and drag uwuPromptr into Applications. The first time, right-click it and choose **Open**, then **Open** again; on macOS 15 or later, try to open it, then go to **System Settings** > **Privacy & Security** and click **Open Anyway**. If it says the app is damaged, run `xattr -cr "/Applications/uwuPromptr.app"` in Terminal.
- **Linux**: install the `.deb`, or make the `.AppImage` executable (Properties > Allow executing) and open it. Some systems need FUSE 2 for AppImages (`libfuse2t64` on Debian 13 and Ubuntu 24.04 or later).

**Updating later**: the apps update themselves, except on the watch.
- **Android**: tap **Update** on the bar at the top of the app when a new version is out, or the download-arrow button in the side Edge Tray to check.
- **Wear OS watch**: install the new `-watch.apk` over the old one, the same way you installed it.
- **Windows, Mac and the Linux AppImage**: the new version downloads by itself, and installs when you click **Update** in the title bar or quit the app. The Mac app does this from the Applications folder.
- **The `.msi` and the `.deb`**: you get a notification when a new version is out, and clicking it opens this page to download it.

Each app keeps its own scripts and settings, separate from the browser's: scripts you wrote in Chrome stay there. Copy their text across with the editor.

## What's new

### Everything on the website
- **Everything on cue.uwuapps.org**: scripts, fine speed and font control, mirroring, the focus line, the timer and the phone remote, and it works offline after the first open.

### Android app
- **Full brightness**: the screen at its brightest while the app is open, for reading through teleprompter glass or outdoors. Tap the phone-with-rays button in the side Edge Tray.
- **Remote with no wifi**: with the app on both phones, the remote connects over Bluetooth and Wi-Fi Direct, with no router and no mobile data. In the remote panel, tap **Let a nearby phone connect**; on the other phone, enter the ID and tap **Connect nearby, without wifi**. It asks for the Nearby devices permission the first time.
- **Volume keys start and stop**: either volume key, a Bluetooth selfie shutter or a headset's button starts and stops the script. Turn it on in **Prompter settings** > **Android app**.
- **The screen stays on** while the script is playing, or while a remote or your watch is connected.
- **Fullscreen** hides the navigation bar as well, from the side Edge Tray or the F key.
- **New version alerts**: a notification when a new version is out. Turn it on in **Prompter settings** > **Android app**.
- **Links open in the app**: a cue.uwuapps.org link, or a remote link with its ID, opens straight in the app.

### Wear OS watch app
- **A remote on your wrist**: play, pause, restart and the speed for the script on your phone, with its name and clock. With your phone on the remote page, it drives the prompter your phone is connected to instead. Keep uwuPromptr open on your phone; if it isn't, the watch says so, and **Open on phone** opens it.
- **Speed on the crown**: turn the crown to change the speed a tenth at a time, with a click you feel at each step and a firmer one at each whole number. On a Galaxy Watch, turn the bezel. **−** and **+** change it a whole step.
- **Wrist taps**: two taps on your wrist every minute of reading, so you keep to time without looking at a clock, and three long ones when the script ends. Pauses don't count. Choose every 30 seconds, 1, 2 or 5 minutes, or off, under **On your wrist** > **Wrist taps**.
- **Twist to play or pause**: a quick turn of the wrist and back starts or stops the script, for when your hands are busy. Turn it on under **On your wrist**. It needs a watch with a gyroscope.
- **Stays on, dimmed**: lower your wrist and the screen dims to the script's name, the minutes and the speed, rather than going back to the watch face.
- **Prompter remote tile**: **Play**, **Pause**, **Restart** and the speed from the tiles beside your watch face, with the clock counting.

### Desktop app
- **Keep on top**: the prompter stays above your slides, Zoom or OBS. Click the pin in the side Edge Tray, or tick **Keep on top** in the tray icon's menu.
- **Move to display**: with two or more screens, send the prompter to another one from the tray icon's menu, then press **F** to fill it. Handy for the screen under the glass.
- **Shortcuts in other apps**: **F8** starts and stops, **F9** speeds up and **F10** slows down, even while another app is in front. A foot pedal or Stream Deck that sends these keys works too. Turn it on in **Prompter settings** > **Desktop app**. On a Mac, hold Fn with them unless your F keys work as standard function keys.
- **The screen stays on** while the script is playing, or while a remote is connected.
- **Lives in the tray**: closing the window keeps uwuPromptr ready in the tray (the menu bar on a Mac), so it opens instantly. **Quit** is in the tray icon's menu. It can also start when you sign in: tick **Start when I sign in** there.
- **New version alerts**: a notification when a new version is out, on unless you turn it off in **Prompter settings** > **Desktop app**. Check any time from **Check for updates...** in the tray or the download-arrow button in the side Edge Tray.
- **Links open in the app**: a `uwu://cue/` link, or `uwu://cue/remote?id=` with an ID, opens straight in the app.

### Everywhere
- **Edge Trays**: the top bar, the bottom bar and a new side menu each slide off the edge of the screen with their tab, giving the script the whole screen, and stay how you left them. The side menu holds settings, mirroring, the focus line, fullscreen and theme, and can sit on the left or the right (**Prompter settings** > **Layout**).
```

### Announcement

```text
✨NEW✨ uwuPromptr 1.0.0 for Android, Wear OS, Windows, Mac and Linux
cue.uwuapps.org

Android app:
- Full brightness, for reading through prompter glass
- A phone remote that works with no wifi at all
- Volume keys and Bluetooth shutters start and stop the script

Wear OS watch app:
- Play, pause and the speed on your watch's crown
- Wrist taps to keep you on time, hands free

Desktop app:
- Keeps the prompter on top of your slides and calls
- F8, F9, F10 or a foot pedal drive it from any app

Download the apps and view patch notes: github.com/augy-studios/uwuPromptr/releases/latest
```
