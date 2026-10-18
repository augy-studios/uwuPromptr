# Desktop app: spec for wrapping an UwU Apps site in Electron

A Windows, macOS and Linux app that is the live website in a window of its own, made with
[Electron](https://www.electronjs.org) and [electron-builder](https://www.electron.build), plus
a thin native layer for what a web page can't do on a computer: living in the tray with the
window closed, notifications without Web Push, starting at sign-in, its own title bar, small
always-there windows on the desktop, the taskbar's and Dock's menus, `uwu://` links, location
on Linux, and updating itself from GitHub Releases. It's shared as installers on a GitHub
release, not through any store.

The site stays the product. Its deploys reach the app the moment it next loads, so the app only
needs rebuilding when its native side changes. The website and PWA lose nothing: everything a
browser can do stays exactly as it was, and desktop features switch on only inside the app.

This document is self-contained. It's the desktop companion of `android-app-spec.md`: the two
apps share a version number, a GitHub release and the site's server side, and where they
differ it says so.

---

## 0. Decide first

| Decision | Example | Why it matters |
|---|---|---|
| App id | `org.uwuapps.<id>` | electron-builder's `appId`, Windows' `AppUserModelId` (notifications and the taskbar group by it), the macOS bundle id. Same as the Android package, never changed |
| Short id | `<id>` | The `uwu://<id>/` links, the page's `window.<id>Desktop`, the user agent tag, file names |
| The site's host | `<host>` | `SITE` in `main.js`; the only origin the app trusts |
| Product name and user agent tag | `<App>`, `<App>Desktop/<version>` | The window, the tray tooltip, the installers' names; the tag lets the server and the page tell the app apart |
| Platforms | Windows `.exe` + `.msi`, macOS `.dmg` (arm64 + x64), Linux `.deb` + `.AppImage` | Each builds only on its own system (§9.3), and each updates differently (§8) |
| Native features | tray, notifications, widgets | Each one costs upkeep on three systems. Add one only where the page genuinely can't do it (§6) |
| GitHub repository | `<owner>/<repo>` | Must be **public**: the updater downloads from its releases without signing in |
| Code signing | none (ad-hoc on macOS) | Unsigned apps warn on first run (§9.5) and can't use macOS's own updater (§8.3). A certificate removes both, at a yearly cost |

The rule that keeps the app maintainable: **the native side never duplicates the page.** It
adds capabilities and hands them to the page through one preload bridge (§5). Layouts, copy
and logic stay in the site. The title bar is the one piece of UI the app draws itself, and it
takes its colour from the site.

---

## 1. How it works

```text
 ┌──────────────── Desktop app (Electron main process, main.js) ───────────────┐
 │ BrowserWindow (frameless: titleBarStyle "hidden")                            │
 │   its own webContents ── titlebar.html  (back, forward, reload, address,     │
 │   │                      screenshots, update, window controls)              │
 │   └ WebContentsView ──── https://<host>/   (the site, below the bar)          │
 │        preload.js → window.<id>Desktop ──IPC──► main.js handlers             │
 │                                                                              │
 │ Tray icon + menu        glance.js (tooltip, menu-bar text, Dock badge,      │
 │ updater.js              Jump List, Dock menu, taskbar thumbnail buttons)    │
 │ widgets.js              frameless windows loading <host>/widget.html        │
 │ location.js (Linux)     Wi-Fi scan → BeaconDB → navigator.geolocation        │
 └──────────────────────────────────────────────────────────────────────────────┘
        │ latest*.yml, installers                ▲ polls the site's APIs
        ▼                                        │ (no Web Push in Electron)
 GitHub Releases (android-v<version>)      Vercel: /api/* (same as the web)
        ▲
 GitHub Actions: builds every platform, uploads to the release
```

- The page detects the app by `window.<id>Desktop` (from `preload.js`), and each feature by the
  method it needs being there (`typeof <id>Desktop.locate === "function"`).
- Offline on the very first launch, the view shows the app's own `offline.html`. After that, the
  site's own service worker serves it offline, exactly as in Chrome.
- The site's service worker and update bar keep working inside the app for **site** deploys;
  the app's **own** updates are the tray's, the title bar's and the notifications' (§8). The
  site's Android update bar never shows here.
- Closing the window hides it; the app keeps running in the tray, so its timers (alerts,
  countdowns) carry on. Quit is in the tray's menu.

---

## 2. The project

```text
desktop/
  package.json, package-lock.json   Electron, electron-builder, electron-updater; the build config
  main.js            start-up, the window, the title bar's and the page's IPC, tray, links,
                     settings, screenshots, start at sign-in, permissions
  preload.js         window.<id>Desktop for the site's page (and widget pages)
  titlebar.html      the title bar, drawn by the app (inline CSS, strict CSP)
  titlebar.js        its buttons, address field and colour
  titlebar-preload.js  window.bar for the title bar
  updater.js         electron-updater, per-platform install, macOS self-swap, notifications
  widgets.js         desktop widget windows
  glance.js          the tray tooltip / menu-bar text / Dock badge; Jump List, Dock menu,
                     taskbar thumbnail buttons
  location.js        Linux only: where the computer is, from its Wi-Fi
  offline.html       the first-launch-offline page
  build/             icon.png (1024 px), tray.png + tray@2x.png + tray@3x.png
  build-linux.sh     build the Linux installers on any Linux machine
  README.md          what the app adds, building, macOS notes
.github/workflows/build-desktop.yml   builds every platform, uploads to the release
main-site/
  js/<the page's desktop-aware scripts>   each branches on window.<id>Desktop
  js/desktop-location.js           Linux: navigator.geolocation pointed at the app
  widget.html                      the page a widget window loads
release/README.md                  publishing, with the Android app, on one release
```

### Versions (October 2026, known to build together)

| Piece | Version | Notes |
|---|---|---|
| `electron` | 44.7.0 | devDependency, pinned exactly |
| `electron-builder` | 26.15.3 | devDependency, pinned exactly |
| `electron-updater` | ^6.8.9 | the one runtime **dependency**: it must be in `dependencies`, or it isn't packaged and the app crashes at start |
| Node | 22 on CI; 20+ builds | Debian 13's own Node 20 is enough on Linux |
| `package.json` `version` | the Android app's `versionName` | The two always match; raise both together |

`node_modules/` and `dist/` are git-ignored. The installers (80 to 110 MB each) are **never
committed**: GitHub refuses files over 100 MB, so they live only on the GitHub release.

---

## 3. Setting it up

### 3.1 `package.json`

```json
{
  "name": "<app>-desktop",
  "productName": "<App>",
  "version": "<the Android versionName>",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "build:win": "electron-builder --win nsis msi --x64 --publish never",
    "build:linux": "electron-builder --linux deb AppImage --x64 --publish never",
    "build:mac": "electron-builder --mac dmg zip --x64 --arm64 --publish never"
  },
  "dependencies": { "electron-updater": "^6.8.9" },
  "devDependencies": { "electron": "44.7.0", "electron-builder": "26.15.3" },
  "build": {
    "appId": "org.uwuapps.<id>",
    "productName": "<App>",
    "directories": { "output": "dist", "buildResources": "build" },
    "files": ["main.js", "preload.js", "updater.js", "widgets.js", "glance.js", "location.js",
              "offline.html", "titlebar.html", "titlebar.js", "titlebar-preload.js",
              "build/tray.png", "build/tray@2x.png", "build/tray@3x.png", "build/icon.png"],
    "artifactName": "<app>-${version}${suffix}.${ext}",
    "protocols": [{ "name": "<App> link", "schemes": ["uwu"] }],
    "publish": [{ "provider": "generic",
                  "url": "https://github.com/<owner>/<repo>/releases/latest/download" }],
    "win":  { "icon": "build/icon.png", "target": ["nsis", "msi"] },
    "nsis": { "artifactName": "<app>-${version}-setup.${ext}", "oneClick": false,
              "perMachine": false, "allowToChangeInstallationDirectory": true,
              "createDesktopShortcut": true, "shortcutName": "<App>" },
    "msi":  { "artifactName": "<app>-${version}.${ext}", "oneClick": false, "perMachine": false,
              "createDesktopShortcut": true, "shortcutName": "<App>" },
    "mac":  { "icon": "build/icon.png", "category": "public.app-category.<category>",
              "target": ["dmg", "zip"], "artifactName": "<app>-${version}-mac-${arch}.${ext}",
              "identity": "-", "hardenedRuntime": false,
              "extendInfo": { "NSLocationUsageDescription": "<App> uses your location to …",
                              "NSLocationWhenInUseUsageDescription": "<App> uses your location to …" } },
    "dmg":  { "artifactName": "<app>-${version}-mac-${arch}.${ext}" },
    "linux": { "icon": "build/icon.png", "category": "Utility", "synopsis": "<one line>",
               "executableName": "<app>", "maintainer": "UwU Apps <email>",
               "target": ["deb", "AppImage"] },
    "deb":  { "artifactName": "<app>-${version}-amd64.${ext}" },
    "appImage": { "artifactName": "<app>-${version}-x86_64.${ext}" }
  }
}
```

- **`files` is an allow-list.** A new `.js` file left out of it runs from source (`npm start`)
  and crashes the installed app at start with "Cannot find module". Add every file the moment
  it's made.
- **`publish` points at `releases/latest/download`**, a generic provider, not the `github`
  provider: it reads `latest*.yml` from whichever release is newest, whatever its tag, so the
  tag can stay `android-v<version>` (shared with the Android app's updater), and needs no
  token or API call.
- `--publish never` on every build: CI uploads the files itself (§9.3); electron-builder
  never touches the release.
- `artifactName`s are what people see on the release page and what the docs name. Keep the
  `<app>-<version>-<what>.<ext>` shape and never rename them in a later version: the
  release notes, the guide and `latest*.yml` all say them.
- `nsis.oneClick: false` gives a normal installer with a folder choice; `perMachine: false`
  installs for the user, with no admin prompt, which is also what lets it update itself.
- `mac.identity: "-"` signs ad-hoc (no certificate): enough for Apple silicon to run it.
  `hardenedRuntime: false` goes with it. The `NS…UsageDescription` strings are **required**
  for macOS to ever show the location prompt; without them geolocation fails silently.
- `protocols` registers `uwu://` in the `.deb`'s menu entry and the macOS `Info.plist`.
  Windows registers it at run time (§7.5).

### 3.2 `main.js` at start-up, in order

1. `app.requestSingleInstanceLock()`; if it fails, `app.quit()` and stop. A second launch
   (a shortcut, sign-in while running, a `uwu://` link) arrives as `second-instance` with its
   `argv`.
2. `app.setAppUserModelId(APP_ID)`. **Without it, Windows shows no notifications** from an
   installed app, and pins and groups it wrongly.
3. `open-url` (macOS links) and `activate` (Dock click with the window hidden) handlers, before
   `ready`: macOS can send `open-url` before the app is ready.
4. `app.setAsDefaultProtocolClient("uwu")` (with the script path when `process.defaultApp`).
5. `whenReady`:
   1. The permission handlers (§10).
   2. First run of an installed app only: start at sign-in on, remembered as chosen (§7.4).
   3. `createWindow()`.
   4. **Every module whose functions the tray's menu calls is initialised before the tray
      is made.** The menu is built at once and calls them; a module that throws because it
      isn't initialised throws in the main process, where an uncaught error stops the whole
      app at start. Make each module's functions return harmless defaults until `init()`.
   5. `createTray()`, which also starts the updater.
   6. Widgets: `init()`, then `restore()`.
6. `before-quit` sets `quitting = true`; `window-all-closed` does nothing (the tray keeps the
   app alive).

### 3.3 The window

```js
win = new BrowserWindow({
  width: bounds?.width || 480, height: bounds?.height || 880, x: bounds?.x, y: bounds?.y,
  minWidth: 360, minHeight: 520, show: false, title: "<App>",
  icon: path.join(__dirname, "build", "icon.png"),
  backgroundColor: BAR_COLOR, autoHideMenuBar: true,
  titleBarStyle: "hidden",
  ...(mac ? { trafficLightPosition: { x: 14, y: 13 } } : {}),
  webPreferences: { preload: "titlebar-preload.js", contextIsolation: true, sandbox: true, nodeIntegration: false },
});
win.removeMenu();
win.loadFile("titlebar.html");
win.on("page-title-updated", (e) => e.preventDefault());  // keeps "<App>", not the page's title
```

The site goes in a `WebContentsView` added to `win.contentView`, laid out below the bar:

```js
const view = new WebContentsView({ webPreferences: {
  preload: "preload.js", contextIsolation: true, sandbox: true, nodeIntegration: false,
  backgroundThrottling: false,                       // timers keep running in the tray
  additionalArguments: [`--<id>-version=${app.getVersion()}`],
} });
view.setBackgroundColor(BAR_COLOR);
page.setUserAgent(`${page.getUserAgent()} <App>Desktop/${app.getVersion()}`);
```

- **Layout**: `view.setBounds({ x: 0, y: BAR_HEIGHT, width, height: height - BAR_HEIGHT })` on
  `resize`, `maximize`, `unmaximize`, `enter-full-screen`, `leave-full-screen`; and `y: 0`
  while the **page** is full screen (`enter-html-full-screen` / `leave-html-full-screen`), when
  the bar hides.
- **`backgroundThrottling: false`** is what keeps the page's polling (alerts, countdowns)
  running while the window is hidden. Leave it out and Chromium slows hidden timers to once a
  minute or less.
- **The version through `additionalArguments`**: the sandboxed preload can't call `app`, but it
  can read `process.argv`.
- **Shown maximised**: `ready-to-show` → maximise unless the settings say it was last closed
  un-maximised (`maximized === false`), then `show()`. `show: false` until then, so it never
  flashes at its default size first.
- **Size and place kept**: on `close`, `writeSettings({ bounds: win.getNormalBounds(),
  maximized: win.isMaximized() })`. `getNormalBounds`, not `getBounds`, or a maximised window
  restores to full-screen size.
- **Typing goes to the site**: `win.on("focus", () => page.focus())`. Without it, keys go to
  the title bar's page after clicking the window's frame.
- **Close hides**: `win.on("close")` → unless `quitting`, `preventDefault()` and `hide()`. The
  first time only, a notification says it's still running and where Quit is (§7.2).
- **Offline at first launch**: `did-fail-load` for the main frame, on the site's origin, with
  any code but `-3` (ERR_ABORTED, which is a navigation replaced by another) → `page.loadFile
  ("offline.html")`.

### 3.4 Links and navigation

- `page.setWindowOpenHandler`: the site's own URLs load in the view; `http(s):` and `mailto:`
  open with `shell.openExternal`; **always** `{ action: "deny" }`. No second app window ever
  opens.
- `will-navigate`: the site's origin and `file:` (the offline page) go ahead; anything else is
  prevented and opened externally if it's `http(s):` or `mailto:`.
- Nothing else is ever opened externally: no `file:`, no custom schemes from the page.

---

## 4. Look and feel

The app should feel like the site in a tidy window: no browser chrome, no system title bar,
the site's colour edge to edge, and the few native touches matching each system.

### 4.1 The title bar (`titlebar.html`)

A 40 px bar the app draws itself (`BAR_HEIGHT = 40`), its own page in the window's own
`webContents`, with the site below it.

| Part | Look | Does |
|---|---|---|
| The bar | Height 40 px, background the site's `theme-color` (until it's known, `BAR_COLOR`, the site's light page colour). `-webkit-app-region: drag` so it moves the window; `user-select: none`. Font `13px/1 system-ui, -apple-system, "Segoe UI", sans-serif` | Left padding 8 px; **78 px on macOS** for the traffic lights, back to 8 px in full screen |
| Back, Forward, Reload | 30 × 28 px buttons, radius 6 px, 18 px stroke icons (stroke 2, round caps and joins). Hover: a translucent wash. Disabled: 35 % opacity | Back/forward through the view's history; disabled when it can't. Reload's icon spins (1 s linear) while the page loads |
| Address | A pill filling the space (height 28 px, radius 14 px), a translucent field colour, a 13 px padlock, the address in the bar's font, ellipsised. Shown without `https://` and without a lone trailing `/` | Click: the first click selects all, as a browser's does. Type an address and Enter: the site's own pages load here; another site opens in the browser ("Opened in your browser"); not an address: "Not an address". Esc or clicking away puts the page's address back. **Ctrl+L / F6** from anywhere |
| Copy link | 24 × 22 px inside the pill's right end, radius 11 px | Copies the page's address. The pill says "Link copied" for 1.5 s, the address faded to 45 % |
| Screenshot | Camera icon, 4 px left margin | The site as on screen, without the bar: copied **and** saved in Downloads, with a notification that shows it in its folder on click |
| Long screenshot | A phone-with-down-arrow icon | The whole page, top to bottom (§7.9) |
| Restart to update | Green (`#1e9e46`, hover `#18843a`, pressed `#136e30`), white download icon, `hidden` until an update is downloaded | Restarts and installs. Title `Restart to update to <version>` |
| Minimise, Maximise/Restore, Close | Windows and Linux only. Each 46 px wide, the bar's full height, square corners, 10 px 1 px-stroke icons with `shape-rendering: crispEdges` (Close with `auto`). Hover wash; **Close hover `#c42b1c`, pressed `#b22a1c`, white icon**, as Windows' own | Maximise toggles to Restore with the overlapping-squares icon. Close hides to the tray. Hidden on macOS and in full screen |

- **Writing colour follows the site's colour**: the bar computes the relative luminance of the
  `theme-color` (sRGB → linear, `0.2126 R + 0.7152 G + 0.0722 B`) and goes light text with
  lighter washes below 0.4, dark text above. Tokens: `--bg`, `--fg`, `--field`, `--hover`,
  `--select`, redefined under `:root.dark`.
- **The site's colour**: `page.on("did-change-theme-color")`, accepted only as `#rrggbb`. Also
  set as the view's background, so a reload never flashes a different colour.
- **Strict CSP** in the bar's page: `default-src 'none'; script-src 'self'; style-src
  'unsafe-inline'`. It loads nothing from the network.
- Every button has `title` (with its shortcut) and `aria-label`; the address field has
  `aria-label="Address"`, `spellcheck="false"`, `autocomplete="off"`.
- Buttons opt out of dragging with `-webkit-app-region: no-drag`, or they can't be clicked.

**Why the app draws its own controls on Windows and Linux**: `titleBarOverlay` (the system's
buttons drawn over a hidden title bar) doesn't always show over a `WebContentsView` that
covers the window. Drawing them in the bar is reliable on both systems. macOS keeps its real
traffic lights, placed with `trafficLightPosition: { x: 14, y: 13 }` to sit centred in 40 px.

### 4.2 Light, dark and the first paint

- The site decides light or dark itself; the bar follows the site's `theme-color`, never the
  system's mode. The site must update `<meta name="theme-color">` when its mode changes.
- `backgroundColor` on the window and `setBackgroundColor` on the view: the site's page colour,
  so the first frame is the right colour, not white.
- `offline.html` follows the **system's** mode (`prefers-color-scheme`), as the site's choice
  isn't known yet: `color-scheme: light dark`, the site's light and dark page colours, a
  rounded **Try again** link to `https://<host>/`. Inline CSS, no fonts or images from the
  network.

### 4.3 The tray icon

- `build/tray.png` at 16 px, with `tray@2x.png` (32) and `tray@3x.png` (48) beside it: Electron
  picks the right one for the screen's scale by the `@Nx` names. A crisp silhouette of the
  app's mark, square, transparent around it.
- Tooltip: the product name, or a glance line (§7.7).
- macOS draws it in the menu bar, where colour icons are allowed but look out of place on a
  dark menu bar: test both modes. (A template image, `…Template.png`, would follow the menu
  bar's colour, at the cost of the app's colour.)

### 4.4 Notifications

- `new Notification({ title, body, icon: build/icon.png })`, after
  `Notification.isSupported()`. The icon shows beside the text on Windows and Linux; macOS
  always uses the app's own icon.
- **Short, plain sentences**: `<App> 2.1.1 is ready` / `Click to restart and update.
  Otherwise it updates the next time you quit.`
- Clicking does what the text says: opens the window on a page, restarts to update, opens the
  release page, or shows a saved screenshot in its folder.

### 4.5 Widget windows

Small frameless windows (§7.6): 320 × 300 by default, min 200 × 110, `frame: false`,
`skipTaskbar: true`, resizable any way, a dark `backgroundColor` matching the widget page's
background so resizing never flashes white. The widget page draws its own drag strip and its
buttons (refresh, change, keep on top, close).

### 4.6 Other things that change the look

| Watch for | In the app | Do |
|---|---|---|
| Fonts from Google Fonts | Load over the network as in Chrome; offline only if the service worker cached them | Keep the SW caching them |
| `100vh` | The view's height: the window minus 40 px | Fine; `100dvh` works too |
| Scrollbars | Chromium's desktop scrollbars, which can take width, unlike a phone's | Check the layout at the narrowest window; style them as the site does for desktop Chrome |
| Hover styles | Real hover, as in a desktop browser | The site's `@media (hover: hover)` styles apply |
| Window width | From 360 px up to a full screen | The site must lay out well at desktop widths, not just a phone's |
| `beforeinstallprompt`, "install the app" banners | Never fired | Hide install prompts when `window.<id>Desktop` exists |
| `display-mode: standalone` | Not matched | Don't use it to detect the app |

---

## 5. The bridge

### 5.1 Page side

The page sees only `window.<id>Desktop`, from `preload.js`:

```js
contextBridge.exposeInMainWorld("<id>Desktop", {
  version,                       // from --<id>-version= in process.argv
  platform: process.platform,    // "win32", "darwin", "linux"
  notify: (n) => ipcRenderer.send("notify", n),               // { title, body, url: "#…" }
  open: (hash) => ipcRenderer.send("open-hash", hash),        // a #address in the app's window
  releases: { get: () => ipcRenderer.invoke("releases-get"),   // update notifications on?
              set: (on) => ipcRenderer.invoke("releases-set", Boolean(on)) },
  ...(process.platform === "linux" && { locate: (opts) => ipcRenderer.invoke("locate", opts) }),
  ...(widgetId && { widget: { get, save, close, onTop } }),  // only in a widget's window
});
```

Rules:

- **Gate every feature on the method being there**, never on `window.<id>Desktop` alone:
  `if (window.<id>Desktop?.releases)`. An older installed app lacks newer methods; the site
  deploys ahead of the app and must cope.
- **App-only UI is `hidden` in the markup** and revealed only after the check. A browser must
  never flash it.
- Every `invoke` has a `.catch()`; an `ipcRenderer.invoke` to a handler an older app lacks
  rejects.
- One preload serves the site and the widget pages; features only for one are added
  conditionally (`widgetId`, `platform`).
- Only `contextBridge`: no `nodeIntegration`, no `remote`, no exposing `ipcRenderer` itself.

### 5.2 Main side

```js
const isSite = (url) => { try { return new URL(url).origin === ORIGIN; } catch { return false; } };
ipcMain.on("notify", (e, n) => {
  if (!isSite(e.senderFrame?.url || "") || !n || typeof n !== "object") return;
  // …
});
```

- **Every handler checks the sender**: the page's handlers by `e.senderFrame.url`'s origin
  being the site's; the title bar's by `e.sender === win.webContents`; a widget's by finding
  its window from `e.sender`. A page from anywhere else (a link that slipped through, an
  iframe) gets nothing.
- **Validate every argument**: lengths capped (`title` 120, `body` 500), ids by pattern,
  hashes by `^#[\w/.,~-]*$`, booleans with `Boolean()`. The page is the site, but the view
  runs whatever a compromised or mistaken deploy sends.
- `ipcMain.handle` for anything that answers; `ipcMain.on` for fire-and-forget. Errors become
  data (`{ error: { code, message } }`): an `Error` thrown across IPC loses its fields.

### 5.3 The user agent

`<App>Desktop/<version>` appended to Chromium's. The server can tell desktop traffic apart, and
the page can lay itself out for the app before the preload is read (rarely needed: the
preload runs before the page's scripts).

---

## 6. What Electron can't do

These work in Chrome and **silently fail** in the app. Each needs the app's version or a
graceful fallback, behind the method check.

| Web feature | In Electron | The app's way |
|---|---|---|
| Web Push (`PushManager.subscribe`) | Missing: there's no push service behind it | The page polls the site's API while the app runs, by the same rules as the server, and hands what's new to `<id>Desktop.notify` (§7.3). The tray keeps it running |
| Geolocation on **Linux** | Always fails: Chromium's only provider there is Google's, which needs an API key Electron doesn't ship | `location.js`: Wi-Fi scan + BeaconDB, and `js/desktop-location.js` replacing `navigator.geolocation` (§7.10) |
| Geolocation on Windows | Works, **only** with Windows' **Settings** > **Privacy & security** > **Location** on | Say so in the page's error |
| Geolocation on macOS | Works once allowed, **only** with `NSLocationUsageDescription` in `Info.plist` | `mac.extendInfo` (§3.1). macOS may ask again after each update of an ad-hoc signed app |
| `Notification` from the page | Works, but clicks can't open the right page in the window, and the permission is the app's | Route through `<id>Desktop.notify` |
| `window.open`, `target="_blank"` | Would open a bare Electron window | `setWindowOpenHandler` (§3.4) |
| "Add to home screen", `beforeinstallprompt` | Never fired | Hide install prompts |
| Background sync, periodic sync | Not useful: no service worker wakes the app | The app is running in the tray anyway; plain timers with `backgroundThrottling: false` |
| Service worker, Cache Storage, IndexedDB, localStorage | Work | Nothing, but see below |

**Storage is separate from the browser's.** The app starts with empty `localStorage`: no saved
settings, theme, favourites or device ids from the browser. It lives in the app's own
`userData` folder and survives updates. A site with Sync is fine; one that keeps everything
locally should say so when the app first ships.

---

## 7. What the app adds

### 7.1 Settings: `settings.json`

One small JSON file in `app.getPath("userData")`, read and merged on every write:

```js
const readSettings = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } };
const writeSettings = (changes) => { try { fs.writeFileSync(file, JSON.stringify({ ...readSettings(), ...changes })); } catch {} };
```

Keys: `bounds`, `maximized`, `trayHintShown`, `loginChosen`, `updateNotices`, and each feature's
own (`widgets`, `favourites`, a glance item). A failed read is an empty object; a failed write
is ignored (the window just opens at its default size next time). Never keep anything secret
here.

### 7.2 The tray, and closing to it

- `new Tray(nativeImage.createFromPath("build/tray.png"))`, `setToolTip("<App>")`.
- Its menu, rebuilt whenever something in it changes (`tray.setContextMenu(menu())`):

  ```text
  Restart to update to 2.1.1        (only once downloaded; or "Download version 2.1.1")
  ─────
  <glance lines, if any>            (§7.7)
  Open <App>
  <one or two of the site's main pages, by #address>
  Add a widget                      (§7.6)
  ─────
  Check for updates...              ("Checking for updates..." greyed while it runs)
  ☑ Start when I sign in
  ─────
  Quit
  ```

- **Click**: on Windows and Linux, a left click shows the window, or hides it if it's already
  in front and focused. **macOS opens the menu on any click**, so no click handler there.
- **Linux trays show the menu on any click** and keep the menu they were given: rebuild it on
  `right-click`, so checkboxes are right.
- **The first close** hides the window and shows one notification: `<App> is still running`,
  "It keeps checking … from the tray. Quit it from the tray icon." (on macOS: "…from the menu
  bar. Quit it from the menu bar icon, or with ⌘Q."). Then `trayHintShown: true`, never again.
- **Quit** sets `quitting = true` then `app.quit()`; the window's `close` handler lets it go.
  `before-quit` also sets it, so ⌘Q and the system's shutdown quit rather than hide.

### 7.3 Notifications from the page

The page can't get pushes (§6), so it polls the site's own API while the app runs, applies the
same rules the server uses for Web Push (the first look only notes how things are; after that,
only what changed), and calls `<id>Desktop.notify({ title, body, url })`. Main shows it
(§4.4); a click shows the window on `url` (a `#address`). Use the same polling interval the
data deserves (a minute for live alerts), and stop when every alert kind is off.

### 7.4 Starting when you sign in

- **On from the first run** of an installed (`app.isPackaged`) app, and remembered
  (`loginChosen: true`), so turning it off in the tray sticks. It opens maximised like any
  start, so whatever it's for is in front of the user from the moment they sign in.
- **Windows and macOS**: `app.setLoginItemSettings({ openAtLogin })`, read back with
  `getLoginItemSettings().openAtLogin`.
- **Linux**: Electron has none. Write `~/.config/autostart/<app>.desktop`:

  ```ini
  [Desktop Entry]
  Type=Application
  Name=<App>
  Exec="<path>"
  X-GNOME-Autostart-enabled=true
  ```

  `<path>` is `process.env.APPIMAGE` for an AppImage (it runs from a temporary mount, so
  `process.execPath` changes every launch), else `process.execPath`. "Is it on" is whether the
  file exists.

### 7.5 `uwu://<id>/` links

- Windows and Linux give a URL scheme to **one** app, unlike Android, which shares `uwu://`
  out by host. The desktop app answers every `uwu://` link and opens only its own host;
  anything else just shows the window. If two UwU Apps ever both want `uwu://` on the desktop,
  they need one shared handler passing each link on by its host.
- Map links exactly as the Android app does: the site's short links by path
  (`uwu://<id>/go/<code>`), anything else as the site's `#address`
  (`uwu://<id>/<thing>` → `https://<host>/#<thing>`), `uwu://<id>/` alone to the home page.
  Accept only `^[\w\-./,~%]*$` in the path.
- **Where links arrive**: Windows and Linux in `argv` (`process.argv` at first launch,
  `second-instance`'s `argv` later); macOS as `open-url`, which can come before `ready` (keep
  it as the start link) or while running.
- **Registering**: `app.setAsDefaultProtocolClient("uwu")` at every start. On Windows that
  writes the per-user registry, so **links work once the app has been opened once** (the
  `.exe` installer opens it when it finishes; after the `.msi`, open it yourself). From source
  (`process.defaultApp`), pass `process.execPath` and the script path, or Windows starts
  Electron without the app. Linux: the `.deb`'s menu entry declares it (`protocols`); an
  AppImage only once integrated into the menu (AppImageLauncher, Gear Lever).
- A link to a `#address` while the site is open sets `location.hash` rather than reloading:
  the site's router must handle `hashchange`.

### 7.6 Desktop widgets

A Windows app outside the Microsoft Store can't add to Windows 11's Widgets board, so widgets
live on the desktop as small windows:

- Each is a `BrowserWindow` loading `https://<host>/widget.html?id=<uuid>`, with the same
  preload and `--<id>-widget=<uuid>` in `additionalArguments`, so `<id>Desktop.widget` exists
  only there.
- Frameless, `skipTaskbar`, resizable, optionally `alwaysOnTop` (the widget's pin button).
- **Kept**: id, its configuration, `onTop` and `bounds` in `settings.json`; bounds saved 500 ms
  after the last `move`/`resize`. Restored at every start.
- **Closed with its ×** (or Alt+F4): removed. **Closed by quitting**: kept (check `quitting`
  in `close`).
- The widget page never navigates (`will-navigate` prevented, `setWindowOpenHandler` denies);
  a click on its content opens that thing in the main window through `<id>Desktop.open`.
- Added from the tray's menu. The page's configuration is validated in main (ids by pattern,
  lists capped).

### 7.7 At a glance: tray, menu bar, Dock, taskbar

What the page can hand the app to show outside the window, each from the page through the
bridge and kept in `settings.json`:

| Where | API | Notes |
|---|---|---|
| Tray tooltip (Windows, Linux) | `tray.setToolTip(text)` | **Windows cuts it at 127 characters**: trim with "…" yourself |
| Beside the menu-bar icon (macOS) | `tray.setTitle(" text")` | A leading space keeps it off the icon. Keep it short; it takes menu-bar room |
| Dock badge (macOS) | `app.dock.setBadge("3")` | A few characters; `""` clears it |
| Jump List (Windows taskbar right-click) | `app.setUserTasks([{ program: process.execPath, arguments: "uwu://<id>/<thing>", iconPath: process.execPath, iconIndex: 0, title, description }])` | **Only from an installed app**: run from source there's no program to point at. Each task is a `uwu://` link to the app itself, arriving as `second-instance` |
| Dock menu (macOS) | `app.dock.setMenu(Menu.buildFromTemplate(…))` | Handlers run in main directly |
| Taskbar thumbnail buttons (Windows) | `win.setThumbarButtons([{ tooltip, icon, flags, click }])` | **Only take once the window is on the taskbar**: set them again after the first `show()`. Up to 7. Icons are 16 px pictures; simple ones can be drawn in code (`nativeImage.createFromBitmap`, BGRA, white on the dark toolbar). `flags: ["disabled"]` when there's nothing to go to |

- A live glance (a countdown) refreshes on a `setInterval` in main (30 s is plenty), fetching
  the site's public API with `fetch`. On failure, say so in the tooltip ("couldn't get it just
  now") rather than leaving stale numbers.
- Clear everything (tooltip back to the product name, title and badge empty) when the page
  turns it off.

### 7.8 The address field and keyboard

| Keys | Does |
|---|---|
| Alt+Left / Alt+Right; ⌘[ / ⌘] on macOS | Back / forward |
| F5, Ctrl+R / ⌘R | Reload |
| F6, Ctrl+L / ⌘L | To the address, all selected |
| Esc in the address | Back to the page, address restored |

Handled in `before-input-event` on **both** the view and the bar's `webContents`, `keyDown`
only, `preventDefault()` when used. While the address is being typed in, focus is the bar's
(`bar-edit`); Enter or Esc gives it back to the page (`bar-done`).

What's typed counts as an address if it's the site's (`<host>/#x`), a path or `#address` on it
(`/#x`, `#x`), a `uwu://<id>/` link, an `http(s)://` URL, or a dotted host (`example.com`).
**A bare word or number is not an address** (a number would be read as an IP address).

### 7.9 Screenshots

- **Screenshot**: `page.capturePage()` (the view only, not the bar) → PNG.
- **Long screenshot**: the whole page through the DevTools protocol, in one capture:
  1. `page.debugger.attach("1.3")` (detach after only if you attached).
  2. Insert user CSS `* { content-visibility: visible !important; }`: rows the site leaves
     undrawn until they scroll near otherwise come out as empty boxes.
  3. Scroll to the top, with `scroll-behavior` forced to `auto` for that moment (a smooth
     scroll hasn't arrived when the capture runs), and wait two animation frames. From the
     top, so sticky headers are where they belong.
  4. `Page.getLayoutMetrics` → `cssContentSize`; height capped at `floor(16384 /
     devicePixelRatio)`: **16384 px is the tallest image Chromium draws**.
  5. `Page.captureScreenshot` with `captureBeyondViewport: true` and a clip of that size.
  6. Remove the CSS and scroll back to where it was, whatever happened.
- Either: onto the clipboard as `image/png` (`clipboard.write([new ClipboardItem(…)])`) **and**
  saved as `<App> <yyyy-mm-dd hh.mm.ss>[ (long)].png` in Downloads; a notification that shows
  it in its folder on click. One at a time (the buttons dim while one runs).

### 7.10 Location on Linux

`location.js`, reached as `<id>Desktop.locate({ maxAge })`:

1. Respect GNOME's switch: `gsettings get org.gnome.system.location enabled` → `false` means
   refuse with code 1 and a sentence saying where to turn it on. No `gsettings` (KDE, others):
   no switch to respect.
2. `nmcli -t -f SSID,BSSID,SIGNAL,FREQ dev wifi list --rescan auto` with `LC_ALL=C` and a
   12 s timeout. Parse terse output (`\:` is an escaped colon). Drop networks whose SSID ends
   `_nomap`, duplicates, and bad BSSIDs; signal 0–100 → dBm as `signal / 2 - 100`; strongest
   40.
3. POST `{ considerIp: true, wifiAccessPoints }` to `https://api.beacondb.net/v1/geolocate`
   with the app's user agent (`<App>Desktop/<version> (+https://<host>)`).
4. **Refuse anything less accurate than 3 km**: that's an IP-address guess, a town wide.
5. Keep an answer 4 s (a trip's steady asking shouldn't rescan each time), and share one
   lookup between callers asking at once.

Only BSSIDs and strengths leave the computer, never names. Page side, `js/desktop-location.js`
replaces `getCurrentPosition`, `watchPosition` (polling every 5 s, skipping repeats of the
same answer) and `clearWatch`, and carries the app's sentence as the error's message.

---

## 8. Updates

Two kinds:

| Kind | Who | How it shows |
|---|---|---|
| A new **site** version | The site's service worker, exactly as in a browser | The site's own update bar |
| A new **app** version | `updater.js` (electron-updater) | A notification, the tray's top item, and the title bar's green button |

### 8.1 When it looks

- 30 s after start, then **every hour** (the app lives in the tray for days), and **20 s after
  the computer wakes** (`powerMonitor.on("resume")`; the network takes a moment).
- From the tray's **Check for updates...**: a notification says what it found, **even "You're
  up to date"** and "Couldn't check for updates".
- Only when packaged: from source, `start()` does nothing and the tray's check says there's
  nothing to update.
- It reads `latest.yml` (Windows), `latest-mac.yml`, `latest-linux.yml` from
  `releases/latest/download/`. That's GitHub's download server, not its API: no rate limit to
  mind, no token.
- **The desktop apps can't be pushed to.** A GitHub webhook can tell phones the moment a
  release is published (`android-app-spec.md` §10.6); Electron has no FCM or Web Push, so it
  polls. That's soon enough: the installers reach the release a few minutes after publishing,
  once CI has built them.

### 8.2 How it installs, by how it was installed

| Installed with | `canInstall()` | Update |
|---|---|---|
| Windows `.exe` (NSIS) | `Uninstall <App>.exe` beside the executable | Downloads in the background, SHA-512 checked against `latest.yml`; notification `<App> X is ready`, "Click to restart and update. Otherwise it updates the next time you quit."; `quitAndInstall(true, true)` (silent, reopens) |
| Linux AppImage | `process.env.APPIMAGE` set | The same |
| macOS app somewhere writable | §8.3 | The same, by the app's own swap |
| Windows `.msi` | No uninstaller beside it | Notification `<App> X is out`, "Click to download it from GitHub, then install it over this one." An updater would install a second copy beside the MSI's |
| Linux `.deb` | No `APPIMAGE` | The same: a `.deb` needs the user's password |
| From source | not packaged | Nothing |

- `autoDownload = canInstall()`, `autoInstallOnAppQuit = canInstall() && !mac`,
  `logger = null`.
- **Notify once per version**, unless the check was asked for. Track `notifiedFor`.
- **"New versions of the app"**: the unasked notifications can be turned off from the page
  (`<id>Desktop.releases.set(false)`, kept as `updateNotices: false`). On unless turned off. The
  tray's item and the bar's button still offer the update; asked-for checks always answer.
- The tray's first item and the title bar's button come from `state.ready` /
  `state.available`, and every change calls back so both redraw.
- `quitting` must be set before `quitAndInstall`, or the window's `close` handler hides the
  window and the install never starts: emit a custom event main listens for.

### 8.3 macOS without a Developer ID

electron-updater hands the downloaded `.zip` to Squirrel.Mac, which **refuses any app not
signed with an Apple Developer ID**. So, for an ad-hoc signed app:

1. Let electron-updater find and download the `.zip` for this Mac's processor (it checks the
   SHA-512), but override `autoUpdater.updateDownloaded` to only dispatch the event, keeping
   Squirrel out of it.
2. Unzip with `/usr/bin/ditto -x -k` (keeps the bundle's symlinks and signature whole) into a
   temporary folder.
3. On quit (`will-quit`), or for **Restart to update**, spawn a detached shell script that
   waits for the app's PID to exit, moves the old `.app` aside, moves the new one in, puts the
   old one back if that fails, removes the quarantine attribute
   (`xattr -dr com.apple.quarantine`), cleans up, and `open`s the app if restarting.
4. `canInstall()` only when the bundle ends `.app`, isn't on `/Volumes/` (still on the
   `.dmg`), isn't under `/AppTranslocation/` (run straight from Downloads, macOS runs a
   read-only copy), and both it and its folder are writable. `/Applications` is writable only
   for admins.
5. Checked again later, the same downloaded version comes back as downloaded: don't unzip it a
   second time.

macOS may ask for location again after each update: it can't tell an ad-hoc signed app's new
version is the same app.

---

## 9. Building, releasing

### 9.1 Version

`package.json`'s `version` = the Android app's `versionName`, raised together, on every
release that changes either. `package-lock.json`'s own two `version` fields go with it
(`npm install` rewrites them, or edit both).

### 9.2 Locally

| System | Command | Makes |
|---|---|---|
| Windows | `cd desktop; npm ci; npm run build:win` | `.exe`, `.msi`, `latest.yml`, `.blockmap` |
| Linux | `bash build-linux.sh` | `.deb`, `.AppImage`, `latest-linux.yml`, copied to `release/<version>/` |
| macOS | `npm ci; npm run build:mac` | `.dmg` and `.zip` for arm64 and x64, `latest-mac.yml` |
| Any | `npm start` | Runs from source, without installing |

- **A Mac app can only be built on a Mac, an `.msi` only on Windows.** CI covers that.
- `build-linux.sh`: `set -euo pipefail`, `npm ci` if `electron-builder` or `electron-updater`
  is missing from `node_modules`, build, copy the two installers **and `latest-linux.yml`**.
  Run it with `bash build-linux.sh` rather than `chmod +x`: a mode change shows in git and
  blocks the next `git pull`.
- On a headless Linux server, `dpkg-deb --info` checks the `.deb`; the app itself can't run
  there.

### 9.3 GitHub Actions: `build-desktop.yml`

Triggers:

- **A push changing `desktop/**`** (or the workflow): builds all three, keeps them as the run's
  artifacts for 30 days.
- **By hand** (`workflow_dispatch`) with a release tag: the same, uploaded to that release with
  `gh release upload --clobber`. **No release of that tag yet: a draft is made** (titled
  `<App> <version>`, a note to add the APK and publish). Nobody's app sees a draft, so nothing
  updates until it's published.
- **A release published**: builds from its tag and uploads, **unless** it already has all three
  `latest*.yml` (made by a hand run).

Shape:

- A first job decides whether to build and makes the draft; `permissions: contents: write`.
- A matrix job, `fail-fast: false`, one per system (`macos-latest`, `windows-latest`,
  `ubuntu-latest`), `timeout-minutes: 30`, `working-directory: desktop`, `shell: bash`,
  Node 22 with npm caching on `desktop/package-lock.json`.
- `CSC_IDENTITY_AUTO_DISCOVERY: "false"`: with no certificate, don't go looking for one.
- Checkout the **release's tag** when triggered by a release, else the branch.
- Each uploads exactly its files:

  | System | Files |
  |---|---|
  | macOS | `dist/*.dmg`, `dist/*.zip`, `dist/*.blockmap`, `dist/latest-mac.yml` |
  | Windows | `dist/*-setup.exe`, `dist/*.msi`, `dist/*.blockmap`, `dist/latest.yml` |
  | Linux | `dist/*.deb`, `dist/*.AppImage`, `dist/latest-linux.yml` |

- `concurrency` keyed on the ref and tag, `cancel-in-progress: true`.
- `upload-artifact` paths don't follow `working-directory`: prefix them with `desktop/`.

### 9.4 Releasing

1. Raise the version (§9.1) with the Android app's. Commit and push.
2. Either run **Build desktop apps** with the new tag (`android-v<version>`), which makes a
   draft with the installers, then add the APK and publish; or publish the release with the
   APK and let the workflow add the installers a few minutes later.
3. The release must have, besides the installers: **every `latest*.yml`, the Mac `.zip`s and
   the `.blockmap`s**. Without the `.yml` files, installed apps never see the version.
4. Release notes: one **Download** table row per installer, an **Updating** paragraph per
   platform (what happens by itself, what to click), the first-run warnings for anyone new
   (§9.5). The style is `android-app-spec.md` §4.5's.

### 9.5 Unsigned installers

| System | First run | Way past |
|---|---|---|
| Windows | SmartScreen: "Windows protected your PC" | **More info** > **Run anyway**. A code-signing certificate removes it |
| macOS | "can't be opened because Apple cannot check it for malicious software" | Finder: right-click > **Open** > **Open**; macOS 15 and later: **System Settings** > **Privacy & Security** > **Open Anyway**. "Is damaged": `xattr -cr "/Applications/<App>.app"`. An Apple Developer ID removes both |
| Linux AppImage | Won't run | Make it executable (`chmod +x`, or Properties > Allow executing). Some systems need FUSE 2 (`libfuse2t64` on Debian 13 and Ubuntu 24.04+, `libfuse2` before) |

---

## 10. Permissions and security

```js
const ALLOWED = new Set(["geolocation", "notifications", "clipboard-sanitized-write", "fullscreen"]);
session.defaultSession.setPermissionRequestHandler((wc, permission, done, details) =>
  done(ALLOWED.has(permission) && isSite(details.requestingUrl || wc.getURL())));
session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) =>
  ALLOWED.has(permission) && origin === ORIGIN);
```

- **Both** handlers: the request handler answers prompts, the check handler answers
  `navigator.permissions.query` and some APIs' silent checks. Only what the site uses; camera,
  microphone, MIDI and the rest are refused.
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` on **every**
  `webContents`: the window's bar, the site's view, each widget.
- Only `https://<host>` is trusted. Everything else either opens in the browser or does
  nothing (§3.4).
- **No key, token or secret in the app.** Anything that needs one goes through the site's
  server. The app is a public download; anything inside it is public.
- Shell commands (macOS swap, Linux `nmcli`, `gsettings`) take arguments as `execFile`/`spawn`
  arrays, never a string built from page input.

---

## 11. Icons

| Asset | Size | Notes |
|---|---|---|
| `build/icon.png` | 1024 × 1024 | electron-builder makes the `.ico`, `.icns` and Linux sizes from it. Also the window and notification icon |
| `build/tray.png`, `@2x`, `@3x` | 16, 32, 48 px | A clear silhouette; square; transparent around it (§4.3) |
| Taskbar thumbnail button icons | 16 px | Drawn in code or small PNGs; white |

- Generate every size from the source SVG; never upscale a small PNG.
- macOS rounds nothing for you: the 1024 px art should already be the system's rounded square
  shape if it wants to sit well in the Dock.

---

## 12. Things that break

The failures met building the app, by where they show up.

### Build

- **A file left out of `build.files`**: works from source, "Cannot find module" in the
  installed app.
- **`electron-updater` in `devDependencies`**: not packaged; crash at start.
- `package-lock.json` out of step with `package.json`: `npm ci` fails on CI. Run `npm install`
  once locally and commit the lock.
- Building the Mac app on Windows or Linux, or the `.msi` off Windows: not possible; use CI.
- CI looking for a signing certificate that isn't there: set
  `CSC_IDENTITY_AUTO_DISCOVERY=false`.
- Old Node on Linux (`EBADENGINE`): Node 20 or later.
- A missing Ruby on an unusual Linux for `fpm`: `ruby ruby-dev rpm`. electron-builder normally
  brings its own.
- `chmod +x build-linux.sh` on the build machine: git sees a change and `git pull` refuses.

### Look

- `titleBarOverlay` relied on over a `WebContentsView`: the window's controls vanish on some
  systems. Draw them (§4.1).
- Buttons in the bar without `-webkit-app-region: no-drag`: unclickable.
- No left padding on macOS: the traffic lights sit on the back button.
- `page-title-updated` not prevented: the window's name becomes the page's title.
- No `backgroundColor` on the window and view: a white flash on start and on reload.
- The bar not following `theme-color`, or no contrast check: dark text on a dark bar.
- The window shown before `ready-to-show` or before maximising: it flashes small first.
- `getBounds` saved instead of `getNormalBounds`: a maximised window "restores" to full size.
- App-only UI not `hidden` in the markup: flashes in the browser, or shows in older apps.
- No tray `@2x`/`@3x`: a blurry tray icon on high-DPI screens.

### Function

- **A module the tray's menu calls, not yet initialised when the tray is made: an uncaught
  error in the main process, and the app doesn't start at all.** Initialise first, and make
  uninitialised functions harmless.
- No `app.setAppUserModelId`: no notifications on Windows.
- No single-instance lock: a second launch opens a second app with its own tray icon.
- `backgroundThrottling` left on: alerts and countdowns stall with the window hidden.
- `close` not prevented: closing quits, and nothing runs in the tray. Prevented always:
  **Quit and updates never close it**; check a `quitting` flag.
- A feature gated on `window.<id>Desktop` instead of the method: breaks on older apps.
- Web Push used in the app: nothing ever arrives (§6).
- Geolocation trusted on Linux: always fails without `location.js`.
- `NSLocationUsageDescription` missing: no location prompt on macOS, ever.
- Tray menu not rebuilt after a change, or on Linux's `right-click`: stale items and
  checkboxes.
- A click handler on the macOS tray: fights the menu.
- Tooltips over 127 characters on Windows: cut mid-word.
- Jump List set from source (`npm start`): points at the bare Electron binary.
- Thumbnail buttons set before the window is shown: silently ignored.
- `setAsDefaultProtocolClient` without the script path from source on Windows: links open a
  bare Electron.
- Expecting `uwu://` links before the app has run once (Windows, `.msi`), or from a
  non-integrated AppImage: nothing opens.
- `did-fail-load` treating `-3` (aborted) as offline: the offline page replaces a real
  navigation.
- Linux autostart pointing at `process.execPath` for an AppImage: a path that's gone by the
  next sign-in.
- Long screenshot without the `content-visibility` override: empty boxes below the fold; with
  smooth scrolling on: a capture taken mid-scroll; taller than 16384 px: Chromium fails.
- IPC handlers that don't check the sender: any page that reaches the view can drive the app.
- An `Error` thrown across `ipcMain.handle`: arrives without its fields; answer with data.

### Updates and release

- `latest*.yml`, the Mac `.zip`s or the `.blockmap`s missing from the release: installed apps
  never see the version.
- The `github` publish provider with `android-v*` tags, or a token: the generic
  `releases/latest/download` URL avoids both.
- Squirrel.Mac left in charge with an ad-hoc signed app: downloads, then fails to install
  every time (§8.3).
- The Mac app run from the `.dmg` or straight from Downloads: can't replace itself; it only
  says there's a new version.
- `autoInstallOnAppQuit` on the `.msi` or `.deb`: a second copy, or a failed install.
- `quitAndInstall` without setting `quitting`: the window hides and the install never runs.
- Notifying on every hourly check: the same "is out" every hour. Once per version.
- Version not raised in both `package.json` and the Android app: the release's `latest*.yml`
  says the old number, and nobody updates.
- A draft release: invisible to every installed app until published.
- The repository private: the updater 404s for everyone.
- Installers committed to git: over 100 MB, push refused.

---

## 13. Checklists

### Before the first build

- [ ] App id, short id, host, product name, user agent tag decided (§0); repository public
- [ ] `package.json`: `files` lists every file; `electron-updater` in `dependencies`;
      artifact names; `publish` generic at `releases/latest/download`; macOS location strings
- [ ] `main.js`: single-instance lock, `setAppUserModelId`, protocol client, permission
      handlers, modules initialised before the tray
- [ ] Window: frameless with the app's title bar, the site in a `WebContentsView`,
      `backgroundThrottling: false`, background colours, maximised `ready-to-show`, bounds kept
- [ ] Title bar: every control, drag regions, macOS padding, theme colour with contrast
- [ ] Links: site in-app, everything else in the browser, no second windows
- [ ] Tray icon at 1×, 2×, 3×; menu; close-to-tray with the one-time hint; Quit
- [ ] `offline.html` in the site's colours, both modes
- [ ] `preload.js`: only `contextBridge`; every main handler checks its sender and validates
- [ ] Site: every desktop feature behind its method check, hidden in the browser; polling in
      place of Web Push; `desktop-location.js` loaded before anything asks for location
- [ ] `.github/workflows/build-desktop.yml`; `.gitignore` has `node_modules/` and `dist/`
- [ ] Site deployed with all of the above

### On each system, every release

- [ ] Installs (past the first-run warning), opens maximised, no white flash
- [ ] Title bar: colour follows the site's light and dark; back, forward, reload, address
      (typing, Ctrl+L, Esc), copy; screenshots copy, save and notify
- [ ] Windows and Linux: minimise, maximise/restore, close to tray; macOS: traffic lights clear
      of the buttons, full screen hides the bar's padding
- [ ] Close hides to the tray, with the hint once; tray click shows and hides (not macOS); Quit
      quits
- [ ] Notifications arrive with the window hidden, and their clicks open the right page
- [ ] Start at sign-in on from the first run; turning it off sticks
- [ ] A `uwu://<id>/` link opens the right page, with the app closed and open
- [ ] Widgets: add, move, resize, pin, close (gone), quit and restart (back where they were)
- [ ] Glance: tooltip, macOS title and badge, Jump List, Dock menu, thumbnail buttons
- [ ] Location: allowed on Windows and macOS; on Linux via Wi-Fi; refusals explained
- [ ] **Check for updates...** says up to date; with a newer release, it downloads, the tray and
      the bar offer Restart to update, and it reopens updated (the `.msi`/`.deb` offer the
      download instead)
- [ ] The same build of the site in a browser: no app-only UI, nothing changed

### Publishing

- [ ] Version raised in `package.json` and the lock, matching the Android app
- [ ] Installers, `latest*.yml`, Mac `.zip`s and `.blockmap`s on the release
- [ ] Release published (not a draft), set as latest
- [ ] Release notes with every installer, how each platform updates, and the first-run warnings
