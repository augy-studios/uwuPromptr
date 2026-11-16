A new look for the desktop apps: your system's own glass, in place of Material You. Only the desktop apps change: on Android and Wear OS, 2.0.0 is still the latest.

## Download

| Device | File |
| --- | --- |
| Windows 10 or 11 (x64 or Arm) | `uwupromptr-2.0.3-setup.exe` (or the `.msi`, for installing on many computers at once) |
| Mac with Apple silicon (M1 and later) | `uwupromptr-2.0.3-mac-arm64.dmg` |
| Mac with an Intel processor | `uwupromptr-2.0.3-mac-x64.dmg` |
| Debian, Ubuntu, Mint (x64 or arm64) | `uwupromptr-2.0.3-amd64.deb` or `uwupromptr-2.0.3-arm64.deb` |
| Fedora, openSUSE | `uwupromptr-2.0.3-x86_64.rpm` or `uwupromptr-2.0.3-aarch64.rpm` |
| Any other Linux | `uwupromptr-2.0.3-x86_64.AppImage` or `uwupromptr-2.0.3-aarch64.AppImage` |

The Android and watch apps are on [2.0.0](https://github.com/augy-studios/uwuPromptr/releases/tag/android-v2.0.0).

## Installing

- **Already have 2.0.2, 2.0.1, 2.0.0 or 1.0.0?** It updates itself: let it restart into the new version. If 2.0.0 closes as soon as it opens, download the installer above and run it over the top: your scripts and settings stay.
- **Windows**: open the `.exe`. Windows may say "Windows protected your PC" the first time: click **More info** > **Run anyway**. It installs for you alone, no administrator needed.
- **Mac**: open the `.dmg` and drag uwuPromptr into Applications, replacing the one there. The first time, right-click it and choose **Open**; on macOS 15 or later, go to **System Settings** > **Privacy & Security** and click **Open Anyway**. If it says the app is damaged, run `xattr -cr "/Applications/uwuPromptr.app"` in Terminal.
- **Linux**: `sudo apt install ./uwupromptr-2.0.3-amd64.deb`, or `sudo dnf install ./uwupromptr-2.0.3-x86_64.rpm`. For the AppImage, make it executable and open it.

## What's new

### Windows, macOS and Linux apps
- **Your system's glass**: the Theme window's Look now offers your system's own see-through style beside the UwU Apps look, with your accent colour and the system's font.
- **Fluent 2 on Windows**: Mica behind the window, title bar included, and Acrylic panels over it.
- **macOS Tahoe on Mac**: a see-through window with Liquid Glass panels and rounded buttons.
- **Deepin & COSMIC on Linux**: a frosted, see-through window.
- **Easy to read**: the prompter itself stays nearly solid, so the script is as clear as ever.
- **Works everywhere**: where a desktop can't blur or see through windows (Windows 10, for one), uwuPromptr draws the frost itself, and the Theme window says so.
