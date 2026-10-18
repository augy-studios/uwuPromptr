# Releases

Each Android build lives here, committed, one folder per version:

```text
release/
  1.0.0/uwupromptr-1.0.0.apk
  1.1.0/uwupromptr-1.1.0.apk
```

`android\build-apk.ps1` puts each build in its folder (see `android/README.md`). This file is
how to publish one.

## Publishing a version

1. **Raise the version** in `android/native/app/build.gradle`: `versionCode` up by one,
   `versionName` to the new version. A phone only accepts a higher `versionCode`.
2. **Build**: `powershell -ExecutionPolicy Bypass -File android\build-apk.ps1`.
3. **Deploy the site first** if this release needs anything new from it, then **commit the
   code and the APK together** and push.
4. On GitHub: **augy-studios/uwuPromptr** > **Releases** > **Draft a new release**.
   - **Choose a tag**: `android-v<version>`, for example `android-v1.0.0`, created on publish.
     The updater only reads tags that start `android-v`.
   - **Release title**: `uwuPromptr <version>`.
   - **Attach the APK** from `release/<version>/` and **wait for it to finish uploading
     before publishing**. The "new version" notification goes out on publish, and only for a
     release whose APK is there.
   - Paste the release notes into **Describe this release** (below).
   - Leave **Set as a pre-release** unticked, tick **Set as the latest release**, and
     **Publish release**.
5. Within ten minutes every copy of the app offers the update in its bar, and anybody with
   **New version alerts** on gets a notification straight away.
6. Post the announcement.

Things that stop the update reaching phones: a tag without `android-v`, a draft or
pre-release, the APK still uploading, a `versionCode` not raised, or the repository made
private.

## Writing the release notes

Three pieces, for three readers (`android-app-spec.md` section 4.5 has the full house style):

- **Release notes**, in the GitHub release: for somebody about to download. Every feature as
  `- **Name**: what it does for you.` Name controls as the app shows them, in bold. "You",
  present tense, British spelling. Only what works in this build: leave out **New version
  alerts** until Firebase is set up (`android/FIREBASE-SETUP.md`).
- **Announcement**, pasted as plain text from a code block: `✨UPDATE✨ uwuPromptr <version>`,
  four to six short lines, ending with the `releases/latest` link.

## First release: 1.0.0, drafted

Adjust before publishing: drop **New version alerts** if Firebase is not set up yet.

### Release notes

```markdown
The first uwuPromptr app for Android: the teleprompter at full brightness, a phone remote that
needs no wifi, and your volume keys or a Bluetooth shutter as a clicker.

## Download

| Device | File |
| --- | --- |
| Android 7.0 or newer | `uwupromptr-1.0.0.apk` |

On an iPhone, a computer or any other phone, use [cue.uwuapps.org](https://cue.uwuapps.org)
in the browser, and add it to your home screen to install it as an app.

## Installing

Download the `.apk` on your phone and open it. If Android asks, allow your browser to
install apps. If Play Protect asks about the app, tap **More details** > **Install anyway**.

**Updating later**: the app updates itself. Tap **Update** on the bar at the top of the app
when a new version is out, or the download-arrow button in the side Edge Tray to check.

The app keeps its own scripts and settings, separate from the browser's: scripts you wrote
in Chrome stay there. Copy their text across with the editor.

## What's new

### Everything on the website
- **Everything on cue.uwuapps.org**: scripts, fine speed and font control, mirroring, the
  focus line, the timer and the phone remote, and it works offline after the first open.

### Android app
- **Full brightness**: the screen at its brightest while the app is open, for reading through
  teleprompter glass or outdoors. Tap the phone-with-rays button in the side Edge Tray.
- **Remote with no wifi**: with the app on both phones, the remote connects over Bluetooth and
  Wi-Fi Direct, with no router and no mobile data. In the remote panel, tap **Let a nearby
  phone connect**; on the other phone, enter the ID and tap **Connect nearby, without wifi**.
  It asks for the Nearby devices permission the first time.
- **Volume keys start and stop**: either volume key, a Bluetooth selfie shutter or a
  headset's button starts and stops the script. Turn it on in **Prompter settings** >
  **Android app**.
- **The screen stays on** while the script is playing, or while a remote is connected.
- **Fullscreen** hides the navigation bar as well, from the side Edge Tray or the F key.
- **New version alerts**: a notification when a new version is out. Turn it on in
  **Prompter settings** > **Android app**.
- **Links open in the app**: a cue.uwuapps.org link, or a remote link with its ID, opens
  straight in the app.

### Everywhere
- **Edge Trays**: the top bar, the bottom bar and a new side menu each slide off the edge of
  the screen with their tab, giving the script the whole screen, and stay how you left them.
  The side menu holds settings, mirroring, the focus line, fullscreen and theme, and can sit
  on the left or the right (**Prompter settings** > **Layout**).
```

### Announcement

```text
✨NEW✨ uwuPromptr 1.0.0 for Android
cue.uwuapps.org

New:
- Full brightness, for reading through prompter glass
- A phone remote that works with no wifi at all
- Volume keys and Bluetooth shutters start and stop the script
- Screen stays on while you read
- Bars that slide away, so the script gets the whole screen

Download the apps and view patch notes: github.com/augy-studios/uwuPromptr/releases/latest
```
