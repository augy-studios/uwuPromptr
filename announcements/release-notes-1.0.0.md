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
