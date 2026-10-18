// uwu:// links on the desktop, shared by every UwU App. Copy this file as is
// into another UwU desktop app; only the arguments to init() differ.
//
// On Android each app claims uwu:// for its own host, and the phone sends each
// link to the right app. Windows, macOS and Linux can't do that: a URL scheme
// belongs to exactly one app. So each UwU desktop app, as it starts:
//
//   1. notes which app holds uwu:// now, if it isn't itself
//   2. claims uwu:// for itself
//   3. passes any link for another app's host on to the app it noted
//
// With two apps installed, whichever started last holds the scheme and hands
// the other its links, so every link opens the app it's for, as on a phone.
// An app that hasn't got this file yet still takes the scheme when it starts,
// and keeps the links for other hosts to itself until it's updated.
//
// Only uwu:// links ever come through here, and they're handed over as one
// argument, never through a shell.

const { app } = require("electron");
const { execFile, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { readSettings, writeSettings } = require("./settings");

const SCHEME = "uwu";
const KEY = "linkHandoff";
const platform = process.platform;

// Set by init(): this app's own name, lower case, as it appears in its
// install path, bundle name or .desktop file ("uwupromptr").
let ownName = "";

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 5000, windowsHide: true }, (error, stdout) => resolve(error ? "" : String(stdout)));
  });
}

/**
 * Splits a command line on spaces, keeping "quoted parts" whole. `escapes`:
 * a .desktop file's \" \` \$ \\ inside quotes. Never for Windows paths, whose
 * backslashes are separators.
 */
function split(command, escapes = false) {
  const parts = [];
  const pattern = escapes ? /"((?:[^"\\]|\\.)*)"|(\S+)/g : /"([^"]*)"|(\S+)/g;
  let match;
  while ((match = pattern.exec(command))) {
    if (match[1] === undefined) parts.push(match[2]);
    else parts.push(escapes ? match[1].replace(/\\(["`$\\])/g, "$1") : match[1]);
  }
  return parts;
}

/* ---- which app holds uwu:// now ---- */

async function currentHandler() {
  if (platform === "win32") {
    for (const root of ["HKCU\\Software\\Classes", "HKLM\\Software\\Classes"]) {
      const out = await run("reg", ["query", `${root}\\${SCHEME}\\shell\\open\\command`, "/ve"]);
      const found = out.match(/REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m);
      if (found) return { command: found[1] };
    }
    return null;
  }
  if (platform === "darwin") {
    try {
      const info = await app.getApplicationInfoForProtocol(`${SCHEME}://`);
      return info?.path ? { app: info.path } : null;
    } catch {
      return null;
    }
  }
  const desktop = (await run("xdg-mime", ["query", "default", `x-scheme-handler/${SCHEME}`])).trim();
  return desktop ? { desktop } : null;
}

/** Whether a handler is this app: any copy of it, installed or from source. */
function isThisApp(handler) {
  const text = JSON.stringify(handler).toLowerCase();
  return text.includes(ownName) || text.includes(process.execPath.toLowerCase().replace(/\\/g, "\\\\"));
}

/* ---- claiming ---- */

/**
 * Notes the app holding uwu://, then takes it. `name` is this app's name as
 * above. Run at every start: another UwU app may have taken it since.
 */
async function init({ name }) {
  ownName = String(name).toLowerCase();
  const before = await currentHandler();
  if (before && !isThisApp(before)) writeSettings({ [KEY]: before });

  // From source, Windows must be told to start Electron with this app, or a
  // link opens a bare Electron.
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(SCHEME);
  }
}

/* ---- passing a link on ---- */

function start(file, args) {
  const child = spawn(file, args, { detached: true, stdio: "ignore", windowsHide: false });
  // An app that has since been uninstalled: nothing to do.
  child.on("error", () => {});
  child.unref();
}

/** The Exec line of a .desktop file, from the usual places. */
function desktopExec(name) {
  if (!/^[\w.-]+\.desktop$/.test(name)) return null;
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  const dataDirs = (process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":");
  for (const dir of [dataHome, ...dataDirs]) {
    try {
      const text = fs.readFileSync(path.join(dir, "applications", name), "utf8");
      const entry = text.split(/^\[/m).find((section) => section.startsWith("Desktop Entry]"));
      const exec = entry?.match(/^Exec=(.+)$/m);
      if (exec) return exec[1].trim();
    } catch {
      // Not in this one.
    }
  }
  return null;
}

/**
 * Hands a link for another app's host to the app that held uwu:// before this
 * one. False if there's nobody to hand it to.
 */
function passOn(link) {
  const to = readSettings()[KEY];
  if (!to || typeof to !== "object" || isThisApp(to)) return false;

  if (platform === "win32" && typeof to.command === "string") {
    // "C:\...\App.exe" "%1", as Electron and most installers write it.
    let used = false;
    const parts = split(to.command).map((part) => {
      if (!/%[1lL]/.test(part)) return part;
      used = true;
      return part.replace(/%[1lL]/g, link);
    });
    if (!used) parts.push(link);
    const [file, ...args] = parts;
    if (!file) return false;
    start(file, args);
    return true;
  }

  if (platform === "darwin" && typeof to.app === "string") {
    start("/usr/bin/open", ["-a", to.app, link]);
    return true;
  }

  if (platform === "linux" && typeof to.desktop === "string") {
    const exec = desktopExec(to.desktop);
    if (!exec) return false;
    let used = false;
    const parts = [];
    for (const part of split(exec, true)) {
      if (/^%[uUfF]$/.test(part)) {
        parts.push(link);
        used = true;
      } else if (!/^%[a-zA-Z]$/.test(part)) {
        parts.push(part.replace(/%%/g, "%"));
      }
    }
    if (!used) parts.push(link);
    const [file, ...args] = parts;
    if (!file) return false;
    start(file, args);
    return true;
  }

  return false;
}

module.exports = { init, passOn };
