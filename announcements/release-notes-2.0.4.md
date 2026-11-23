The Android app's bottom rows, clear of the navigation bar, with a slider for phones where they still sit too low or too high. The desktop apps are the same as 2.0.3.

## Download

| Device | File |
| --- | --- |
| Android 7.0 or newer | `uwupromptr-2.0.4.apk` |
| Wear OS 3 or newer watch, paired with an Android phone | `uwupromptr-2.0.4-watch.apk` |
| Windows 10 or 11 (x64 or Arm) | `uwupromptr-2.0.4-setup.exe` (or the `.msi`, for installing on many computers at once) |
| Mac with Apple silicon (M1 and later) | `uwupromptr-2.0.4-mac-arm64.dmg` |
| Mac with an Intel processor | `uwupromptr-2.0.4-mac-x64.dmg` |
| Debian, Ubuntu, Mint (x64 or arm64) | `uwupromptr-2.0.4-amd64.deb` or `uwupromptr-2.0.4-arm64.deb` |
| Fedora, openSUSE | `uwupromptr-2.0.4-x86_64.rpm` or `uwupromptr-2.0.4-aarch64.rpm` |
| Any other Linux | `uwupromptr-2.0.4-x86_64.AppImage` or `uwupromptr-2.0.4-aarch64.AppImage` |

On an iPhone or any other device, use [cue.uwuapps.org](https://cue.uwuapps.org) in the browser, and add it to your home screen to install it as an app.

## Installing

- **Already have 2.0.0 or 1.0.0 on Android?** It updates itself: tap **Update** on the app's bar, or open the Updates page.
- **Already have an earlier desktop app?** It updates itself: let it restart into the new version.
- **Android**: download the `.apk` on your phone and open it. If Android asks, allow your browser to install apps. If Play Protect asks about the app, tap **More details** > **Install anyway**.
- **Wear OS watch**: nothing changes on the watch, but its `-watch.apk` is here to match. The steps are in [the watch app's guide](https://github.com/augy-studios/uwuPromptr/blob/main/flutter/android/wear/README.md#installing-it-on-a-watch).
- **Windows**: open the `.exe`. Windows may say "Windows protected your PC" the first time: click **More info** > **Run anyway**. It installs for you alone, no administrator needed.
- **Mac**: open the `.dmg` and drag uwuPromptr into Applications, replacing the one there. The first time, right-click it and choose **Open**; on macOS 15 or later, go to **System Settings** > **Privacy & Security** and click **Open Anyway**. If it says the app is damaged, run `xattr -cr "/Applications/uwuPromptr.app"` in Terminal.
- **Linux**: `sudo apt install ./uwupromptr-2.0.4-amd64.deb`, or `sudo dnf install ./uwupromptr-2.0.4-x86_64.rpm`. For the AppImage, make it executable and open it.

## What's new

### Android app
- **Clear of the navigation bar**: the windows (Prompter settings, Theme and the rest) and the script editor now keep their last rows above the bar, with their colour running on behind it.
- **Space above the navigation bar**: a new slider in **Prompter settings** > **Android app** moves the bottom rows (the prompter's controls, the remote and the windows) up or down, for a phone that puts them too low or too high. **Automatic** is the phone's own measure, and the button beside it goes back to it.
- **A tidier stage**: with the top or bottom tray open, the script no longer leaves a second gap for the bar behind it.
