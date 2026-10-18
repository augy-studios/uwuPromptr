// uwuPromptr for Windows, macOS and Linux: cue.uwuapps.org in a window of its
// own, plus what a web page can't do on a computer.
//
// The site stays the product. Its deploys reach the app the moment it next
// loads, so this only needs rebuilding when something in this folder changes.
// desktop-app-spec.md at the repository root is the pattern this follows.
//
//   the window     the app's own slim title bar (titlebar.html) with the site
//                  below it in a WebContentsView
//   the tray       lives there with the window closed; Keep on top, Move to
//                  display, updates, Start when I sign in, Quit
//   the page       window.cueDesktop (preload.js): the screen kept awake while
//                  the script plays, global shortcuts, keep on top, updates
//   links          uwu://cue/ and uwu://cue/remote?id=XXXXXX, as on Android;
//                  other UwU apps' uwu:// links passed on to them (links.js)
//   updates        updater.js, from GitHub Releases

"use strict";

const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  WebContentsView,
  ipcMain,
  nativeImage,
  powerSaveBlocker,
  screen,
  session,
  shell,
} = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { readSettings, writeSettings } = require("./settings");
const updater = require("./updater");
const hotkeys = require("./hotkeys");
const links = require("./links");

const APP_ID = "org.uwuapps.cue";
const PRODUCT = "uwuPromptr";
const SCHEME = "uwu";
const LINK_HOST = "cue";
const LIVE_SITE = "https://cue.uwuapps.org";
const SITE = siteAddress();
const ORIGIN = new URL(SITE).origin;

const BAR_HEIGHT = 40;
// The site's light page colour, until the page says otherwise.
const BAR_COLOR = "#ccffcc";
// A remote id: six of the characters the site's codes are made of.
const REMOTE_ID = /^[BCDFGHJKLMNPQRSTVWXYZ2-9]{6}$/;

const mac = process.platform === "darwin";
const linux = process.platform === "linux";
const ICON = path.join(__dirname, "build", "icon.png");

let win = null;
let view = null;
let page = null;
let tray = null;
let quitting = false;
let startLink = null;
let barColor = BAR_COLOR;
let htmlFullScreen = false;
let fullScreenForPage = false;
let awakeWanted = false;
let awakeId = null;

/**
 * The site's address. From source only, CUE_SITE points the app at another
 * copy of it (a local server), to try a site change before it's deployed.
 */
function siteAddress() {
  const wanted = process.env.CUE_SITE;
  if (!wanted || app.isPackaged) return LIVE_SITE;
  try {
    const url = new URL(wanted);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "https:" || local) return url.origin;
  } catch {
    // Not an address: the live site.
  }
  return LIVE_SITE;
}

function isSite(url) {
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
}

/** A message from the site's page in the view, and nothing else. */
function fromPage(event) {
  return Boolean(page) && event.sender === page && isSite(event.senderFrame?.url || "");
}

function notify(title, body, click) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body, icon: ICON });
  if (click) notification.on("click", click);
  notification.show();
}

/* ---- links: uwu://cue/ ---- */

function isLink(arg) {
  return typeof arg === "string" && arg.toLowerCase().startsWith(`${SCHEME}://`);
}

/**
 * The page a link stands for, exactly as the Android app maps them: the
 * remote, with its id only when it's a valid one, or the prompter. Null for a
 * uwu:// link to another UwU app, which links.js passes on to it.
 */
function pageFor(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== `${SCHEME}:` || url.hostname.toLowerCase() !== LINK_HOST) return null;

  const where = `/${url.pathname.replace(/^\/+/, "")}`.replace(/\.html$/, "").replace(/\/+$/, "");
  if (where === "/remote") {
    const id = (url.searchParams.get("id") || "").toUpperCase();
    return REMOTE_ID.test(id) ? `${SITE}/remote?id=${id}` : `${SITE}/remote`;
  }
  return `${SITE}/`;
}

function openLink(link) {
  const target = pageFor(link);
  // Another app's link, handed on, with this window left where it was. With
  // nobody to hand it to, the window comes forward as for any link.
  if (!target && links.passOn(link)) return;
  showWindow();
  if (target && page) page.loadURL(target);
}

/* ---- the window ---- */

const validColor = (value) => (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : null);

/** Saved bounds, if they're still on a screen: a monitor may have gone. */
function savedBounds(bounds) {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return null;
  const visible = screen.getAllDisplays().some(({ workArea: area }) => {
    const across = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const down = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return across >= 100 && down >= 60;
  });
  return visible ? bounds : { width: bounds.width, height: bounds.height };
}

function layout() {
  if (!win || !view) return;
  const { width, height } = win.getContentBounds();
  // The page's own fullscreen (the prompter's F) hides the bar.
  const top = htmlFullScreen ? 0 : BAR_HEIGHT;
  view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
}

/** What the title bar draws. */
function barState() {
  let where = "";
  try {
    const url = new URL(page.getURL());
    if (url.protocol === "file:") where = "Offline";
    else if (url.pathname.replace(/\.html$/, "").replace(/\/$/, "") === "/remote") where = "Remote";
  } catch {
    // Nothing loaded yet.
  }
  return {
    platform: process.platform,
    canGoBack: page.navigationHistory.canGoBack(),
    loading: page.isLoading(),
    maximized: win.isMaximized(),
    fullScreen: win.isFullScreen(),
    color: barColor,
    update: updater.state.ready,
    where,
  };
}

function sendBarState() {
  if (!win || win.isDestroyed() || !page) return;
  win.webContents.send("bar-state", barState());
}

function setBarColor(color) {
  const valid = validColor(color);
  if (!valid || valid === barColor) return;
  barColor = valid;
  // So a reload never flashes a different colour, nor the next start.
  win.setBackgroundColor(valid);
  view.setBackgroundColor(valid);
  writeSettings({ barColor: valid });
  sendBarState();
}

function goBack() {
  if (page?.navigationHistory.canGoBack()) page.navigationHistory.goBack();
}

function goForward() {
  if (page?.navigationHistory.canGoForward()) page.navigationHistory.goForward();
}

function reload() {
  if (!page) return;
  // From the offline page, "reload" means try the site again.
  if (page.getURL().startsWith("file:")) page.loadURL(`${SITE}/`);
  else page.reload();
}

/**
 * The few keys the app keeps for itself, on both the page and the bar. Alt+Left
 * is back only off the Mac: there it moves by a word in the script editor.
 */
function shortcuts(event, input) {
  if (input.type !== "keyDown") return;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  const command = mac ? input.meta && !input.control : input.control && !input.meta;
  const altOnly = input.alt && !input.control && !input.meta && !input.shift;

  if ((!mac && altOnly && key === "ArrowLeft") || (mac && command && key === "[")) goBack();
  else if ((!mac && altOnly && key === "ArrowRight") || (mac && command && key === "]")) goForward();
  else if (key === "F5" || (command && !input.shift && !input.alt && key === "r")) reload();
  else if (!app.isPackaged && (key === "F12" || (command && input.shift && key === "i"))) page.toggleDevTools();
  else return;
  event.preventDefault();
}

function openOutside(url) {
  try {
    const { protocol } = new URL(url);
    // Nothing but web pages and mail: no file:, no other app's scheme.
    if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") {
      shell.openExternal(url).catch(() => {});
    }
  } catch {
    // Not an address.
  }
}

function createWindow() {
  const settings = readSettings();
  barColor = validColor(settings.barColor) || BAR_COLOR;
  const bounds = savedBounds(settings.bounds);

  win = new BrowserWindow({
    width: bounds?.width || 1000,
    height: bounds?.height || 720,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 360,
    minHeight: 420,
    show: false,
    title: PRODUCT,
    icon: ICON,
    backgroundColor: barColor,
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    // Centred in the 40 px bar.
    ...(mac ? { trafficLightPosition: { x: 14, y: 13 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, "titlebar-preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  if (!mac) win.removeMenu();
  win.setAlwaysOnTop(settings.onTop === true);
  win.loadFile(path.join(__dirname, "titlebar.html"));
  // Keeps the window called uwuPromptr, not the page's title.
  win.on("page-title-updated", (event) => event.preventDefault());

  const bar = win.webContents;
  bar.on("will-navigate", (event) => event.preventDefault());
  bar.setWindowOpenHandler(() => ({ action: "deny" }));
  bar.on("before-input-event", shortcuts);
  bar.on("did-finish-load", sendBarState);

  view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // The prompter keeps scrolling, and its clock running, with the window
      // behind another one.
      backgroundThrottling: false,
      // The sandboxed preload can't ask app for this, but it can read argv.
      additionalArguments: [`--cue-version=${app.getVersion()}`],
    },
  });
  view.setBackgroundColor(barColor);
  win.contentView.addChildView(view);
  page = view.webContents;
  page.setUserAgent(`${page.getUserAgent()} ${PRODUCT}Desktop/${app.getVersion()}`);

  for (const name of ["resize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) {
    win.on(name, () => {
      layout();
      sendBarState();
    });
  }
  layout();

  win.once("ready-to-show", () => {
    // Maximised unless it was last closed un-maximised, and shown only then,
    // so it never flashes at its default size first.
    if (settings.maximized !== false) win.maximize();
    win.show();
    layout();
  });

  // Typing goes to the site after a click on the bar.
  win.on("focus", () => page.focus());

  win.on("close", (event) => {
    writeSettings({ bounds: win.getNormalBounds(), maximized: win.isMaximized() });
    if (quitting) return;
    event.preventDefault();
    hideWindow();
    trayHint();
  });

  for (const name of ["show", "hide", "minimize", "restore"]) win.on(name, applyAwake);

  /* The page's own fullscreen: the bar goes, and the window fills the screen
     if it wasn't already. */
  page.on("enter-html-full-screen", () => {
    htmlFullScreen = true;
    if (!win.isFullScreen()) {
      fullScreenForPage = true;
      win.setFullScreen(true);
    }
    layout();
    sendBarState();
  });
  page.on("leave-html-full-screen", () => {
    htmlFullScreen = false;
    if (fullScreenForPage) {
      fullScreenForPage = false;
      win.setFullScreen(false);
    }
    layout();
    sendBarState();
  });
  win.on("leave-full-screen", () => {
    // Left by the system (macOS's green button, Move to display): the page
    // leaves its fullscreen too, so its button shows the right state.
    fullScreenForPage = false;
    if (htmlFullScreen) page.executeJavaScript("document.exitFullscreen?.().catch(() => {})").catch(() => {});
  });

  /* Links: the site loads here, everything else in the browser, and no second
     window ever opens. */
  page.setWindowOpenHandler(({ url }) => {
    if (isSite(url)) page.loadURL(url);
    else openOutside(url);
    return { action: "deny" };
  });
  page.on("will-navigate", (event, legacyUrl) => {
    const url = event.url ?? legacyUrl;
    if (isSite(url)) return;
    event.preventDefault();
    openOutside(url);
  });

  // What each page asked for is let go as the next one starts. The prompter
  // asks again as it loads; the remote page never does.
  page.on("did-start-navigation", (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    awakeWanted = false;
    applyAwake();
    hotkeys.listen(false);
  });

  // Offline on the very first launch. After one visit the site's service
  // worker serves it offline, as in a browser. -3 is a navigation replaced by
  // another, not a failure.
  page.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !isSite(url)) return;
    page.loadFile(path.join(__dirname, "offline.html"));
  });

  page.on("did-change-theme-color", (_event, color) => setBarColor(color));
  page.on("before-input-event", shortcuts);
  for (const name of ["did-navigate", "did-navigate-in-page", "did-start-loading", "did-stop-loading"]) {
    page.on(name, sendBarState);
  }

  page.loadURL((startLink && pageFor(startLink)) || `${SITE}/`);
  startLink = null;
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function hideWindow() {
  // A full-screen window hidden on macOS leaves a black space behind.
  if (win.isFullScreen()) {
    win.once("leave-full-screen", () => win.hide());
    win.setFullScreen(false);
  } else {
    win.hide();
  }
}

function toggleWindow() {
  if (win.isVisible() && win.isFocused() && !win.isMinimized()) hideWindow();
  else showWindow();
}

/** The first time only: closing didn't quit, and here is where Quit is. */
function trayHint() {
  if (readSettings().trayHintShown) return;
  writeSettings({ trayHintShown: true });
  notify(
    `${PRODUCT} is still running`,
    mac
      ? "It stays in the menu bar so it opens instantly. Quit it from the menu bar icon, or with ⌘Q."
      : "It stays in the tray so it opens instantly. Quit it from the tray icon."
  );
}

/* ---- the screen kept awake ---- */

/**
 * While the prompter plays, or a remote is connected, and only while the
 * window can be seen. A hidden prompter has no reason to keep the screen on.
 */
function applyAwake() {
  const want = awakeWanted && win && win.isVisible() && !win.isMinimized();
  if (want && awakeId === null) {
    awakeId = powerSaveBlocker.start("prevent-display-sleep");
  } else if (!want && awakeId !== null) {
    powerSaveBlocker.stop(awakeId);
    awakeId = null;
  }
}

/* ---- keep on top, and which display ---- */

function setOnTop(on) {
  writeSettings({ onTop: on });
  win.setAlwaysOnTop(on);
  page?.send("on-top", on);
  refreshTray();
}

/**
 * Onto another monitor, maximised: the one under the prompter glass, say.
 * The prompter's own Fullscreen (F) then fills it.
 */
function moveToDisplay(id) {
  const display = screen.getAllDisplays().find((d) => d.id === id);
  if (!display || !win) return;
  const go = () => {
    if (win.isMaximized()) win.unmaximize();
    const { x, y, width, height } = display.workArea;
    // A normal size on the new display first, so un-maximising stays there.
    win.setBounds({
      x: x + Math.round(width * 0.1),
      y: y + Math.round(height * 0.1),
      width: Math.round(width * 0.8),
      height: Math.round(height * 0.8),
    });
    win.maximize();
    showWindow();
  };
  if (win.isFullScreen()) {
    win.once("leave-full-screen", go);
    win.setFullScreen(false);
  } else {
    go();
  }
}

function displayItems() {
  const displays = screen.getAllDisplays();
  if (displays.length < 2 || !win) return [];
  const primary = screen.getPrimaryDisplay().id;
  const current = screen.getDisplayMatching(win.getBounds()).id;
  return [
    {
      label: "Move to display",
      submenu: displays.map((display, index) => ({
        label: `${display.label || `Display ${index + 1}`} (${display.size.width} × ${display.size.height}${
          display.id === primary ? ", main" : ""
        })`,
        type: "radio",
        checked: display.id === current,
        click: () => moveToDisplay(display.id),
      })),
    },
  ];
}

/* ---- starting when you sign in ---- */

function autostartFile() {
  return path.join(os.homedir(), ".config", "autostart", "uwupromptr.desktop");
}

function loginOn() {
  if (linux) return fs.existsSync(autostartFile());
  return app.getLoginItemSettings().openAtLogin;
}

function setLogin(on) {
  if (linux) {
    try {
      if (on) {
        // An AppImage runs from a temporary mount, so execPath changes every
        // launch: the AppImage file itself is what to start.
        const program = process.env.APPIMAGE || process.execPath;
        const quoted = `"${program.replace(/(["`$\\])/g, "\\$1")}"`;
        fs.mkdirSync(path.dirname(autostartFile()), { recursive: true });
        fs.writeFileSync(
          autostartFile(),
          `[Desktop Entry]\nType=Application\nName=${PRODUCT}\nExec=${quoted}\nX-GNOME-Autostart-enabled=true\n`
        );
      } else {
        fs.rmSync(autostartFile(), { force: true });
      }
    } catch {
      // The menu shows what actually happened.
    }
  } else {
    app.setLoginItemSettings({ openAtLogin: on });
  }
  refreshTray();
}

/* ---- the tray ---- */

function trayMenu() {
  const state = updater.state;
  const top = [];
  if (state.ready) {
    top.push({ label: `Restart to update to ${state.ready}`, click: updater.install });
  } else if (state.available && updater.canInstall()) {
    top.push({ label: `Downloading version ${state.available}...`, enabled: false });
  } else if (state.available) {
    top.push({ label: `Download version ${state.available}`, click: updater.openReleases });
  }
  if (top.length) top.push({ type: "separator" });

  return Menu.buildFromTemplate([
    ...top,
    { label: `Open ${PRODUCT}`, click: showWindow },
    {
      label: "Open the remote",
      click: () => {
        showWindow();
        page?.loadURL(`${SITE}/remote`);
      },
    },
    { type: "separator" },
    {
      label: "Keep on top",
      type: "checkbox",
      checked: Boolean(win?.isAlwaysOnTop()),
      click: (item) => setOnTop(item.checked),
    },
    ...displayItems(),
    { type: "separator" },
    {
      label: state.checking ? "Checking for updates..." : "Check for updates...",
      enabled: !state.checking,
      click: () => updater.check(true),
    },
    {
      label: "Start when I sign in",
      type: "checkbox",
      checked: loginOn(),
      // From source there's no installed program to start.
      enabled: app.isPackaged,
      click: (item) => setLogin(item.checked),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

function refreshTray() {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(trayMenu());
}

function createTray() {
  // Electron picks tray@2x.png and tray@3x.png beside it for the screen's scale.
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "build", "tray.png")));
  tray.setToolTip(PRODUCT);
  refreshTray();
  // macOS opens the menu on any click, and a click handler there fights it.
  if (!mac) tray.on("click", toggleWindow);
  // Linux trays keep the menu they were given: rebuild it so it's current.
  if (linux) tray.on("right-click", refreshTray);
}

/* ---- the page's bridge ---- */

function wireIpc() {
  ipcMain.on("keep-awake", (event, on) => {
    if (!fromPage(event)) return;
    awakeWanted = on === true;
    applyAwake();
  });

  ipcMain.handle("hotkeys-get", (event) => (fromPage(event) ? hotkeys.state() : null));
  ipcMain.handle("hotkeys-set", (event, on) => (fromPage(event) ? hotkeys.set(on === true) : null));
  ipcMain.on("hotkeys-listen", (event, on) => {
    if (fromPage(event)) hotkeys.listen(on === true);
  });

  ipcMain.handle("on-top-get", (event) => (fromPage(event) ? win.isAlwaysOnTop() : null));
  ipcMain.handle("on-top-set", (event, on) => {
    if (!fromPage(event)) return null;
    setOnTop(on === true);
    return on === true;
  });

  ipcMain.on("check-updates", (event) => {
    if (fromPage(event)) updater.check(true);
  });
  ipcMain.handle("releases-get", (event) => (fromPage(event) ? updater.notices.get() : null));
  ipcMain.handle("releases-set", (event, on) => (fromPage(event) ? updater.notices.set(on === true) : null));

  // The title bar's buttons, from the bar's own page only.
  ipcMain.on("bar-action", (event, action) => {
    if (!win || event.sender !== win.webContents) return;
    switch (action) {
      case "back":
        goBack();
        break;
      case "reload":
        reload();
        break;
      case "minimize":
        win.minimize();
        break;
      case "maximize":
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
        break;
      case "close":
        win.close();
        break;
      case "update":
        updater.install();
        break;
      default:
        break;
    }
  });
}

/* ---- permissions and the menu ---- */

function setPermissions() {
  // Only what the site uses: copying the remote's link, and fullscreen.
  // Camera, microphone, location and the rest are refused.
  const allowed = new Set(["clipboard-sanitized-write", "fullscreen"]);
  session.defaultSession.setPermissionRequestHandler((contents, permission, done, details) => {
    done(allowed.has(permission) && isSite(details.requestingUrl || contents.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) => {
    return allowed.has(permission) && isSite(origin);
  });
}

function setAppMenu() {
  // Windows and Linux need no menu: the bar and the tray are the app's. A Mac
  // without an Edit menu has no ⌘C or ⌘V in the script editor, and no ⌘Q.
  if (!mac) {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }])
  );
}

/* ---- start-up ---- */

function ready() {
  // Started only to carry another app's link: hand it over and go.
  if (startLink && !pageFor(startLink) && links.passOn(startLink)) {
    quitting = true;
    app.quit();
    return;
  }

  // Which app held uwu:// before this one, then uwu:// for this one.
  links.init({ name: "uwupromptr" }).catch(() => {});

  setPermissions();
  setAppMenu();
  wireIpc();

  // Everything the tray's menu calls is ready before the tray is made: an
  // error here, in the main process, would stop the app starting at all.
  updater.init({
    icon: ICON,
    onChange: () => {
      refreshTray();
      sendBarState();
    },
    beforeQuit: () => {
      quitting = true;
    },
  });
  hotkeys.init((action) => page?.send("hotkey", action));

  createWindow();
  createTray();
  updater.start();

  for (const name of ["display-added", "display-removed", "display-metrics-changed"]) {
    screen.on(name, refreshTray);
  }
  win.on("moved", refreshTray);
}

function start() {
  // Global shortcuts in a Wayland session go through the desktop's portal.
  if (linux) app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");

  // Without it Windows shows no notifications from the installed app, and
  // groups it wrongly on the taskbar.
  app.setAppUserModelId(APP_ID);

  // Windows and Linux: a link the app was started with.
  startLink = process.argv.find(isLink) || null;

  app.on("second-instance", (_event, argv) => {
    const link = argv.find(isLink);
    if (link) openLink(link);
    else showWindow();
  });

  // macOS sends links this way, and can before the app is ready.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (page) openLink(url);
    else startLink = url;
  });

  // A Dock click with the window hidden.
  app.on("activate", showWindow);

  // ⌘Q, the system shutting down, an update: quit rather than hide.
  app.on("before-quit", () => {
    quitting = true;
  });
  // The tray keeps the app alive.
  app.on("window-all-closed", () => {});

  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });

  app.whenReady().then(ready);
}

// A second launch (a shortcut, a uwu:// link) arrives in the first as
// second-instance, rather than opening a second app with its own tray icon.
if (app.requestSingleInstanceLock()) start();
else app.quit();
