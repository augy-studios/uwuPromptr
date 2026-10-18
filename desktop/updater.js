// New versions of the app itself, from GitHub Releases.
//
// New versions of the *site* are the site's own business: its service worker
// and update bar work here exactly as in a browser. This is only for when the
// app's native side changes.
//
// electron-updater reads latest.yml, latest-mac.yml or latest-linux.yml from
// releases/latest/download/ (GitHub's download server, so no API rate limit
// and no token), and how it installs depends on how the app was installed:
//
//   Windows .exe (NSIS)    downloads in the background, installs on restart
//   Linux AppImage         the same
//   macOS, writable .app   the same, by swapping the bundle itself (below)
//   Windows .msi           only says it's out; the download is on GitHub
//   Linux .deb             the same: installing one needs the password
//   From source            nothing
//
// macOS: electron-updater hands the downloaded .zip to Squirrel.Mac, which
// refuses any app not signed with an Apple Developer ID. This app is signed
// ad hoc, so Squirrel is kept out of it: the zip is downloaded and checked as
// usual, unzipped with ditto, and a small script swaps the bundles once the app
// has quit.

const { app, Notification, shell, powerMonitor } = require("electron");
const { autoUpdater } = require("electron-updater");
const { execFile, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { readSettings, writeSettings } = require("./settings");

const PRODUCT = "uwuPromptr";
const RELEASES = "https://github.com/augy-studios/uwuPromptr/releases/latest";
const mac = process.platform === "darwin";

const FIRST_CHECK_MS = 30 * 1000;
const EVERY_MS = 60 * 60 * 1000;
const AFTER_WAKE_MS = 20 * 1000;

const state = {
  checking: false,
  // The newest version found, while it's newer than this one.
  available: null,
  // A version downloaded and ready to install on restart.
  ready: null,
};

let icon;
let onChange = () => {};
let beforeQuit = () => {};
let started = false;
let askedFor = false;
let notifiedFor = null;
// macOS: the unzipped new bundle, { version, dir, app }.
let macUpdate = null;
let swapStarted = false;
// Notifications are kept until closed: one that is garbage collected loses its
// click handler on Windows.
const shown = new Set();

function changed() {
  try {
    onChange(state);
  } catch {
    // A redraw failing is no reason to stop updating.
  }
}

function notify(title, body, click) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body, icon });
  shown.add(notification);
  const forget = () => shown.delete(notification);
  notification.on("close", forget);
  notification.on("click", () => {
    forget();
    click?.();
  });
  notification.show();
}

function openReleases() {
  shell.openExternal(RELEASES).catch(() => {});
}

/* ---- can this copy replace itself? ---- */

function macBundle() {
  // .../uwuPromptr.app/Contents/MacOS/uwuPromptr
  return path.resolve(process.execPath, "..", "..", "..");
}

function macCanInstall() {
  const bundle = macBundle();
  // On the .dmg still, or run straight from Downloads, where macOS runs a
  // read-only copy from somewhere else.
  if (!bundle.endsWith(".app") || bundle.startsWith("/Volumes/") || bundle.includes("/AppTranslocation/")) {
    return false;
  }
  try {
    // /Applications is writable only for admins.
    fs.accessSync(bundle, fs.constants.W_OK);
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function canInstall() {
  if (!app.isPackaged) return false;
  if (process.platform === "win32") {
    // Only NSIS leaves an uninstaller beside the app. An updater run under an
    // .msi install would put a second copy beside it.
    return fs.existsSync(path.join(path.dirname(process.execPath), `Uninstall ${PRODUCT}.exe`));
  }
  if (process.platform === "linux") return Boolean(process.env.APPIMAGE);
  if (mac) return macCanInstall();
  return false;
}

/* ---- telling people ---- */

function noticesOn() {
  return readSettings().updateNotices !== false;
}

/** Once per version, unless the check was asked for. */
function shouldTell(version) {
  if (askedFor) return true;
  return noticesOn() && notifiedFor !== version;
}

function tellReady(version) {
  if (!shouldTell(version)) return;
  notifiedFor = version;
  notify(
    `${PRODUCT} ${version} is ready`,
    "Click to restart and update. Otherwise it updates the next time you quit.",
    install
  );
}

function tellOut(version) {
  if (!shouldTell(version)) return;
  notifiedFor = version;
  const how = mac
    ? "Click to download it from GitHub, then drag it into Applications over this one."
    : "Click to download it from GitHub, then install it over this one.";
  notify(`${PRODUCT} ${version} is out`, how, openReleases);
}

/* ---- macOS: the bundle swap ---- */

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error) => (error ? reject(error) : resolve()));
  });
}

async function unzipForMac(event) {
  // Checked again later, the same download comes back as downloaded.
  if (macUpdate?.version === event.version) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uwupromptr-update-"));
  // ditto keeps the bundle's symlinks and signature whole; unzip doesn't.
  await run("/usr/bin/ditto", ["-x", "-k", event.downloadedFile, dir]);
  const name = fs.readdirSync(dir).find((entry) => entry.endsWith(".app"));
  if (!name) throw new Error("No app in the update");
  macUpdate = { version: event.version, dir, app: path.join(dir, name) };
}

// Waits for the app to exit, moves the old bundle aside, the new one in, and
// the old one back if that failed. $1 pid, $2 bundle, $3 new bundle, $4 its
// temporary folder, $5 1 to open it afterwards.
const SWAP = `
while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
old="$2.old.$$"
if mv "$2" "$old"; then
  if mv "$3" "$2"; then
    rm -rf "$old"
    xattr -dr com.apple.quarantine "$2" 2>/dev/null
  else
    mv "$old" "$2"
  fi
fi
rm -rf "$4"
if [ "$5" = 1 ]; then open "$2"; fi
`;

function swapMac(restart) {
  if (!macUpdate || swapStarted) return;
  swapStarted = true;
  spawn(
    "/bin/bash",
    ["-c", SWAP, "swap", String(process.pid), macBundle(), macUpdate.app, macUpdate.dir, restart ? "1" : "0"],
    { detached: true, stdio: "ignore" }
  ).unref();
}

/* ---- the updater ---- */

function wire() {
  autoUpdater.logger = null;
  autoUpdater.autoDownload = canInstall();
  autoUpdater.autoInstallOnAppQuit = canInstall() && !mac;

  if (mac) {
    // Squirrel.Mac would take the zip from here and refuse it. Announce the
    // download and keep the zip for the swap instead.
    autoUpdater.updateDownloaded = async function (_zipFileInfo, event) {
      this.dispatchUpdateDownloaded(event);
      return [event.downloadedFile];
    };
    app.on("will-quit", () => swapMac(false));
  }

  autoUpdater.on("checking-for-update", () => {
    state.checking = true;
    changed();
  });

  autoUpdater.on("update-not-available", () => {
    state.checking = false;
    state.available = null;
    changed();
    if (askedFor) notify("You're up to date", `${PRODUCT} ${app.getVersion()} is the newest version.`);
    askedFor = false;
  });

  autoUpdater.on("update-available", (info) => {
    state.checking = false;
    state.available = info.version;
    changed();
    if (canInstall()) {
      // It downloads now; the "ready" notification follows.
      if (askedFor) notify(`Downloading ${PRODUCT} ${info.version}`, "You'll get a notification when it's ready to install.");
    } else {
      tellOut(info.version);
      askedFor = false;
    }
  });

  autoUpdater.on("update-downloaded", async (event) => {
    try {
      if (mac) await unzipForMac(event);
    } catch {
      // The zip couldn't be opened. Offer the download instead.
      tellOut(event.version);
      askedFor = false;
      return;
    }
    state.ready = event.version;
    changed();
    tellReady(event.version);
    askedFor = false;
  });

  autoUpdater.on("error", () => {
    state.checking = false;
    changed();
    // A failed check is answered by check() below. This is a download that
    // failed after the check found something.
    if (askedFor && state.available && canInstall()) {
      notify("Couldn't download the update", "Check your connection, then try again from the tray.");
      askedFor = false;
    }
  });
}

/**
 * `icon` for notifications; `onChange(state)` redraws the tray and the title
 * bar; `beforeQuit()` lets the window close for real before an install.
 */
function init(options) {
  icon = options.icon;
  onChange = options.onChange || onChange;
  beforeQuit = options.beforeQuit || beforeQuit;
  if (app.isPackaged) wire();
}

/** 30 s after start, every hour, and 20 s after the computer wakes. */
function start() {
  if (started || !app.isPackaged) return;
  started = true;
  setTimeout(() => check(false), FIRST_CHECK_MS);
  setInterval(() => check(false), EVERY_MS);
  powerMonitor.on("resume", () => setTimeout(() => check(false), AFTER_WAKE_MS));
}

/** `byHand`: from the tray or the page, so it always says what it found. */
async function check(byHand) {
  if (!app.isPackaged) {
    if (byHand) notify("Nothing to update", "This copy runs from source. Installed copies update themselves.");
    return;
  }
  if (state.ready) {
    if (byHand) {
      askedFor = true;
      tellReady(state.ready);
      askedFor = false;
    }
    return;
  }
  if (state.checking) return;
  askedFor = Boolean(byHand);
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    state.checking = false;
    changed();
    if (askedFor) notify("Couldn't check for updates", "Check your connection, then try again from the tray.");
    askedFor = false;
  }
}

/** Restart into the downloaded version. */
function install() {
  if (!state.ready) return;
  // Before quitting, or the window's close handler hides it instead.
  beforeQuit();
  if (mac) {
    swapMac(true);
    app.quit();
    return;
  }
  // Silent, and open the app again afterwards.
  autoUpdater.quitAndInstall(true, true);
}

module.exports = {
  init,
  start,
  check,
  install,
  canInstall,
  openReleases,
  get state() {
    return { ...state };
  },
  notices: {
    get: () => noticesOn(),
    set: (on) => {
      writeSettings({ updateNotices: Boolean(on) });
      return Boolean(on);
    },
  },
};
