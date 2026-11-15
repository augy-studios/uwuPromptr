uwuPromptr's apps, rebuilt: every screen now drawn by the app itself rather than the website in a window, quicker to open, smooth to scroll, and working offline from the first open, with Material You on Android, Report a bug, tours, an Updates page and much more on the desktop.

## Download

| Device | File |
| --- | --- |
| Android 7.0 or newer | `uwupromptr-2.0.0.apk` |
| Wear OS 3 or newer watch, paired with an Android phone | `uwupromptr-2.0.0-watch.apk` |
| Windows 10 or 11 (x64 or Arm) | `uwupromptr-2.0.0-setup.exe` (or the `.msi`, for installing on many computers at once) |
| Mac with Apple silicon (M1 and later) | `uwupromptr-2.0.0-mac-arm64.dmg` |
| Mac with an Intel processor | `uwupromptr-2.0.0-mac-x64.dmg` |
| Debian, Ubuntu, Mint (x64 or arm64) | `uwupromptr-2.0.0-amd64.deb` or `uwupromptr-2.0.0-arm64.deb` |
| Fedora, openSUSE | `uwupromptr-2.0.0-x86_64.rpm` or `uwupromptr-2.0.0-aarch64.rpm` |
| Any other Linux | `uwupromptr-2.0.0-x86_64.AppImage` or `uwupromptr-2.0.0-aarch64.AppImage` |

On an iPhone or any other device, use [cue.uwuapps.org](https://cue.uwuapps.org) in the browser, and add it to your home screen to install it as an app.

## Installing

- **Already have 1.0.0?** It updates itself: tap **Update** on the Android app's bar, or let the desktop app restart into the new version. Your scripts, settings and theme come across by themselves the first time 2.0.0 opens.
- **Android**: download the `.apk` on your phone and open it. If Android asks, allow your browser to install apps. If Play Protect asks about the app, tap **More details** > **Install anyway**.
- **Wear OS watch**: install the new `-watch.apk` over the old one, from a computer with `adb` or from your phone with an app that installs apps on watches. The steps are in [the watch app's guide](https://github.com/augy-studios/uwuPromptr/blob/main/flutter/android/wear/README.md#installing-it-on-a-watch).
- **Windows**: open the `.exe`. Windows may say "Windows protected your PC" the first time: click **More info** > **Run anyway**. It installs for you alone, no administrator needed.
- **Mac**: open the `.dmg` and drag uwuPromptr into Applications. The first time, right-click it and choose **Open**; on macOS 15 or later, go to **System Settings** > **Privacy & Security** and click **Open Anyway**. If it says the app is damaged, run `xattr -cr "/Applications/uwuPromptr.app"` in Terminal.
- **Linux**: `sudo apt install ./uwupromptr-2.0.0-amd64.deb`, or `sudo dnf install ./uwupromptr-2.0.0-x86_64.rpm`. For the AppImage, make it executable and open it.

## What's new

### Android app
- **A real app**: every screen built for Android, quick to open, with the script scrolling smoothly and working with no connection from the very first open.
- **Material You by default**: your phone's font and, on Android 12 and later, your wallpaper's colours. The UwU Apps look from the website, with its brand colours and the Jua font, is one switch away in **Theme**.
- **Updates page**: what's new in this version and every one before it, and **Update** downloads the next version, checks it and installs it.
- **New version alerts**: a notification the moment a new version is out, even with the app closed. Turn it on in the Updates page or in Prompter settings.
- **Your scripts come with you**: everything the 1.0.0 app kept is brought across the first time 2.0.0 opens.
- **Back does what you'd expect**: it closes the editor, goes back from the remote to the prompter, and a second press sends the app to the background, so a connected remote keeps going.
- **Full brightness, the volume keys, the offline remote and the watch** all work as before.

### Windows, macOS and Linux apps
- **Make it yours**: the first window picks the theme, the brand colour (or your computer's own accent colour) and whether uwuPromptr starts when you sign in.
- **Its own title bar**, with back and forward through the pages and scripts you've opened, and a **command bar** (`Ctrl+K`): search every script by its name or its words, run any command, type a remote ID, or paste a link.
- **Scripts beside the prompter**: on a wide window your scripts stay in a list on the left, and a navigation rail switches between the prompter and the remote.
- **Mini remote**: a small window that drives the prompter from anywhere on your desktop, kept on top, for when the prompter is full screen on another display.
- **Tray countdown**: the script, the clock and how far through it is in the tray's tooltip (and beside the menu bar icon on a Mac).
- **Your scripts in the Jump List and the Dock**, and the taskbar's thumbnail buttons start and stop the script without bringing the window forward.
- **Screenshots**, including a long one of the whole script, copied and saved to Downloads.
- **Keep on top, Move to display and shortcuts in other apps** (F8, F9, F10 for a foot pedal) carry on, with your settings from 1.0.0.
- **Updates itself**, from 1.0.0 too: it checks as it opens and every hour, downloads the update and offers **Restart to update**.

### Everywhere
- **Report a bug**: say what went wrong, add up to three pictures or use **Screenshot a page**, and it reaches Augy straight away. You get a report ID to quote. Never your script's words, unless a picture shows them.
- **Shown around the first time**: a short tour of the prompter, the remote and the remote control window, which Prompter settings' **Show me around** replays.
- **Privacy**: a page at [cue.uwuapps.org/privacy](https://cue.uwuapps.org/privacy) says what's kept and where it goes. In short: your scripts stay on your device, and the apps have no ads or analytics.
- **The remote pairs both ways**: the app's prompter takes the website's remote, and the app's remote drives the website's prompter.
