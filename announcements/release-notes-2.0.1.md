A fix for the Windows and macOS apps, which could close the moment they opened. Only the desktop apps change: on Android and Wear OS, 2.0.0 is still the latest.

## Download

| Device | File |
| --- | --- |
| Windows 10 or 11 (x64 or Arm) | `uwupromptr-2.0.1-setup.exe` (or the `.msi`, for installing on many computers at once) |
| Mac with Apple silicon (M1 and later) | `uwupromptr-2.0.1-mac-arm64.dmg` |
| Mac with an Intel processor | `uwupromptr-2.0.1-mac-x64.dmg` |
| Debian, Ubuntu, Mint (x64 or arm64) | `uwupromptr-2.0.1-amd64.deb` or `uwupromptr-2.0.1-arm64.deb` |
| Fedora, openSUSE | `uwupromptr-2.0.1-x86_64.rpm` or `uwupromptr-2.0.1-aarch64.rpm` |
| Any other Linux | `uwupromptr-2.0.1-x86_64.AppImage` or `uwupromptr-2.0.1-aarch64.AppImage` |

The Android and watch apps are on [2.0.0](https://github.com/augy-studios/uwuPromptr/releases/tag/android-v2.0.0).

## Installing

- **Already have 2.0.0 or 1.0.0?** If the app opens, it updates itself: let it restart into the new version. If it closes as soon as it opens, download its installer above and run it over the top: your scripts and settings stay.
- **Windows**: open the `.exe`. Windows may say "Windows protected your PC" the first time: click **More info** > **Run anyway**. It installs for you alone, no administrator needed.
- **Mac**: open the `.dmg` and drag uwuPromptr into Applications, replacing the one there. The first time, right-click it and choose **Open**; on macOS 15 or later, go to **System Settings** > **Privacy & Security** and click **Open Anyway**. If it says the app is damaged, run `xattr -cr "/Applications/uwuPromptr.app"` in Terminal.
- **Linux**: `sudo apt install ./uwupromptr-2.0.1-amd64.deb`, or `sudo dnf install ./uwupromptr-2.0.1-x86_64.rpm`. For the AppImage, make it executable and open it.

## What's new

### Windows, macOS and Linux apps
- **No more closing on start**: on Windows and macOS, the app closed as soon as it opened, or when you pressed **Get started** in Make it yours, while the F8, F9 and F10 shortcuts were on. They work again, from any app.
- **Start when I sign in**: its icon is back in Make it yours.
