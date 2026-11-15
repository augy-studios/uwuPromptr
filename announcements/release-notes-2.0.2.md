A tidier window for the desktop apps: nothing fixed beside the prompter any more, and taskbar buttons that work as they look. Only the desktop apps change: on Android and Wear OS, 2.0.0 is still the latest.

## Download

| Device | File |
| --- | --- |
| Windows 10 or 11 (x64 or Arm) | `uwupromptr-2.0.2-setup.exe` (or the `.msi`, for installing on many computers at once) |
| Mac with Apple silicon (M1 and later) | `uwupromptr-2.0.2-mac-arm64.dmg` |
| Mac with an Intel processor | `uwupromptr-2.0.2-mac-x64.dmg` |
| Debian, Ubuntu, Mint (x64 or arm64) | `uwupromptr-2.0.2-amd64.deb` or `uwupromptr-2.0.2-arm64.deb` |
| Fedora, openSUSE | `uwupromptr-2.0.2-x86_64.rpm` or `uwupromptr-2.0.2-aarch64.rpm` |
| Any other Linux | `uwupromptr-2.0.2-x86_64.AppImage` or `uwupromptr-2.0.2-aarch64.AppImage` |

The Android and watch apps are on [2.0.0](https://github.com/augy-studios/uwuPromptr/releases/tag/android-v2.0.0).

## Installing

- **Already have 2.0.1, 2.0.0 or 1.0.0?** It updates itself: let it restart into the new version. If 2.0.0 closes as soon as it opens, download the installer above and run it over the top: your scripts and settings stay.
- **Windows**: open the `.exe`. Windows may say "Windows protected your PC" the first time: click **More info** > **Run anyway**. It installs for you alone, no administrator needed.
- **Mac**: open the `.dmg` and drag uwuPromptr into Applications, replacing the one there. The first time, right-click it and choose **Open**; on macOS 15 or later, go to **System Settings** > **Privacy & Security** and click **Open Anyway**. If it says the app is damaged, run `xattr -cr "/Applications/uwuPromptr.app"` in Terminal.
- **Linux**: `sudo apt install ./uwupromptr-2.0.2-amd64.deb`, or `sudo dnf install ./uwupromptr-2.0.2-x86_64.rpm`. For the AppImage, make it executable and open it.

## What's new

### Windows, macOS and Linux apps
- **No more sidebar**: the edge trays are all that sit round the prompter now, so putting them away gives the script the whole window. The remote page is a button at the top, beside a new Scripts button.
- **Scripts that slide**: the Scripts button at the top slides your scripts in beside the prompter, and away again.
- **A pointing hand**: over everything you can click, as on the website.
- **The taskbar's buttons** (Windows): hover the taskbar icon, and start and stop shows play or pause as the prompter is. Previous and next switch scripts without bringing the window up, and only show when there's another script to switch to.
