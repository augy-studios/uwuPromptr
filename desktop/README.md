# uwuPromptr for Windows, macOS and Linux

The live site, [cue.uwuapps.org](https://cue.uwuapps.org), in a window of its own, made with
[Electron](https://www.electronjs.org) and [electron-builder](https://www.electron.build), plus a
thin native layer for what a web page can't do on a computer. App id **`org.uwuapps.cue`**, the
same as the Android app's package. Shared as installers on the GitHub release, beside the APK.

The site stays the product: a deploy reaches the app the next time it loads, so the app only
needs rebuilding when something in this folder changes. Every desktop-only feature in the site
is gated on the method it needs in `window.cueDesktop` (`main-site/js/app-desktop.js`), so a
browser sees none of it and an older app under a newer site just shows less.

`desktop-app-spec.md` at the repository root is the pattern this follows.

## What the app adds to the site

| Feature | Where | Why the app |
| --- | --- | --- |
| **Screen stays on** | Automatic, while the script plays or a remote is connected | Held by the system (`powerSaveBlocker`), and kept even with the window behind another one, which the browser's Wake Lock is not |
| **Keep on top** | Pin button in the side Edge Tray, or the tray icon's menu | The prompter stays above slides, Zoom or OBS |
| **Move to display** | The tray icon's menu, with two or more monitors | Sends the window to another screen, maximised: the one under the prompter glass, say. Press **F** there for fullscreen |
| **Shortcuts in other apps** | Prompter settings > Desktop app. Off until turned on | **F8** starts and stops, **F9** faster, **F10** slower, whichever app is in front. Most USB foot pedals and Stream Deck buttons can send these keys. On a Mac, hold Fn unless the F keys are set as standard function keys |
| **Updates** | Download-arrow button in the side Edge Tray, the tray's **Check for updates...**, and the green **Update** button in the title bar | Checks the site and the app in one press; the app updates itself from GitHub Releases |
| **New version alerts** | Prompter settings > Desktop app. On unless turned off | A notification when a new version is out |
| **Lives in the tray** | Closing the window hides it; **Quit** is in the tray's menu | It opens instantly, and keeps checking for updates |
| **Start when I sign in** | The tray's menu. Off unless turned on | |
| **`uwu://cue/` links** | `uwu://cue/` and `uwu://cue/remote?id=XXXXXX` | Open the prompter or the remote, as on Android. Other UwU apps' `uwu://` links are passed on to them (below) |

The title bar is the app's own: back (for the remote page), reload, the update button and the
window's controls, in the site's colour, light or dark.

### Gemini's suggestions not built, and why

- **Hide from screen share** (`setContentProtection`): reliable only on Windows. On macOS 15
  and later, apps capturing through ScreenCaptureKit can still see the window, and Linux has
  nothing, so it would promise more than it does.
- **A transparent click-through overlay** under the webcam: it leaves no way to click the
  prompter's own controls, and fights the title bar. Keep on top covers most of the need.
- **A second, mirrored window per display**: two copies of the prompter kept in step is a
  feature of its own. Move to display plus the prompter's mirror buttons covers a glass rig.
- **USB foot pedals through `node-hid`**: a native module that complicates all three builds.
  Pedals that send keys work through the global shortcuts.
- **A local HTTP or WebSocket server for Stream Deck**: any website open in a browser could
  send it requests. Stream Deck can send the shortcuts instead.
- **A file watcher for scripts written in other editors**: the scripts live in the site's
  storage, so this needs an import flow in the site first.

## Building

CI builds every platform: **Build desktop apps** (`.github/workflows/build-desktop.yml`). A
Mac app builds only on a Mac and an `.msi` only on Windows, so use it for releases.

| System | Command, from this folder | Makes |
| --- | --- | --- |
| Any | `npm ci`, then `npm start` | Runs from source, without installing |
| Windows | `npm run build:win` | `dist/uwupromptr-<version>-setup.exe`, `.msi`, `latest.yml`, `.blockmap` |
| Linux | `bash build-linux.sh` | `.deb`, `.AppImage`, `latest-linux.yml`, copied to `release/<version>/` |
| macOS | `npm run build:mac` | `.dmg` and `.zip` for Apple silicon and Intel, `latest-mac.yml` |

From source, `CUE_SITE=http://localhost:8000 npm start` points the app at a local copy of the
site, to try a site change before deploying it. Running from VS Code's terminal, clear
`ELECTRON_RUN_AS_NODE` first, or Electron starts as plain Node.

The installers (80 to 110 MB each) are never committed: GitHub refuses files over 100 MB, and
the root `.gitignore` keeps them out of `release/`.

### Versions

| Piece | Version |
| --- | --- |
| `electron` | 44.7.0, pinned |
| `electron-builder` | 26.15.3, pinned |
| `electron-updater` | ^6.8.9, in `dependencies` (not dev), or it isn't packaged |
| Node | 22 on CI; 20 or later locally |

`package.json`'s `version` is always the Android app's `versionName`. Raise both together, and
run `npm install` once so `package-lock.json` follows.

## Releasing

With the Android app, on one release tagged `android-v<version>` (`release/README.md`):

1. Raise the version here and in the Android app. Commit and push.
2. Either run **Build desktop apps** by hand with the tag (it makes a draft with the
   installers; add the phone and watch APKs and publish), or publish the release with the
   APKs and the workflow adds the installers a few minutes later.
3. The release needs every `latest*.yml`, the Mac `.zip`s and the `.blockmap`s as well as the
   installers, or installed apps never see the version. The workflow uploads all of them.

### How each copy updates

| Installed with | Update |
| --- | --- |
| Windows `.exe` | Downloads by itself; a notification, the tray and the title bar offer **Restart to update**, or it installs when you quit |
| Linux AppImage | The same |
| macOS, in Applications | The same: the app swaps itself in, as Apple's updater refuses apps without an Apple Developer ID |
| macOS, run from the `.dmg` or Downloads | Says a new version is out; drag the new one into Applications |
| Windows `.msi`, Linux `.deb` | Says a new version is out, and opens the release page |

It looks 30 seconds after starting, every hour, and 20 seconds after the computer wakes.

### First run, unsigned

| System | What you see | Way past |
| --- | --- | --- |
| Windows | "Windows protected your PC" | **More info** > **Run anyway** |
| macOS | "can't be opened because Apple cannot check it" | Right-click the app > **Open** > **Open**; on macOS 15 and later, **System Settings** > **Privacy & Security** > **Open Anyway**. "Is damaged": `xattr -cr "/Applications/uwuPromptr.app"` |
| Linux AppImage | Won't run | Make it executable (`chmod +x`, or Properties > Allow executing). Some systems need FUSE 2 (`libfuse2t64` on Debian 13 and Ubuntu 24.04+) |

## `uwu://` links and the other UwU apps

Android routes `uwu://` links by host, so each app gets its own. Windows, macOS and Linux give
a URL scheme to **one** app. So every UwU desktop app claims `uwu://` as it starts, after
noting which app held it, and passes any link that isn't its own on to that app (`links.js`,
`desktop-app-spec.md` section 7.5). Whichever app started last holds the scheme and hands the
others their links.

An app without `links.js` still takes the scheme when it starts and keeps other apps' links.
**SG Bus Timings needs the same `links.js`** for links to its own host to keep working while
uwuPromptr holds the scheme, and for uwuPromptr's to work while it does.

On Windows links work once the app has been opened once (the `.exe` installer opens it when it
finishes; after the `.msi`, open it yourself). A Linux AppImage needs integrating into the menu
first (AppImageLauncher, Gear Lever).

## What's where

```text
desktop/
  package.json, package-lock.json   Electron, electron-builder, electron-updater; the build config
  main.js             start-up, the window, the page's and the bar's messages, the tray,
                      links, keep on top and displays, the screen kept awake, permissions
  preload.js          window.cueDesktop, for the site's page
  titlebar.html, titlebar.js, titlebar-preload.js   the app's own title bar
  updater.js          updates from GitHub Releases, per install type; the macOS swap
  hotkeys.js          F8, F9, F10 from any app
  links.js            uwu:// claimed, and other UwU apps' links passed on
  settings.js         settings.json in the app's data folder
  offline.html        a first launch with no connection
  build/              icon.png (Windows, Linux), icon-mac.png (Apple's grid), tray icons,
                      all made from main-site/UPC-main.png
  build-linux.sh      the Linux installers by hand

main-site/js/app-desktop.js   the site's side: the tray buttons, the settings, the bar colour
.github/workflows/build-desktop.yml
```

`settings.json` (in `%APPDATA%\uwuPromptr`, `~/Library/Application Support/uwuPromptr` or
`~/.config/uwuPromptr`) keeps the window's size and place, the bar's colour, the shortcuts,
keep on top, update notices and the app that held `uwu://` before. The site's own data
(scripts, settings, theme) is in the same folder but separate from any browser's: **scripts
written in a browser don't appear in the app**. Copy their text across with the editor.

## Checking a build

- Installs past the first-run warning, opens maximised, no white flash.
- The title bar follows the site's light and dark; back appears on the remote page; reload
  works (also Ctrl+R or F5); minimise, maximise and close on Windows and Linux; on a Mac the
  traffic lights clear the buttons.
- Close hides to the tray, with a notification the first time; a tray click shows and hides
  it (not on a Mac); **Quit** quits.
- The side Edge Tray has **Keep on top** and **Check for updates** before the theme button,
  and they unroll with the rest. Keep on top follows the tray's checkbox and the other way.
- With two monitors, **Move to display** moves it; **F** fills that screen, and the bar
  comes back after.
- Prompter settings > Desktop app: **Shortcuts in other apps** on, then F8, F9, F10 from
  another app. A key another app holds is named in the note.
- The screen doesn't sleep while the script plays with the window in front.
- **Check for updates** says you're up to date; with a newer release, it downloads and offers
  **Restart to update** (the `.msi` and `.deb` open the release page instead).
- `uwu://cue/remote?id=XXXXXX` opens the remote with the app closed and open.
- The same site in a browser: no desktop-only buttons or settings anywhere.
