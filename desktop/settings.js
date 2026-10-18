// The app's own settings: one small JSON file in the app's userData folder.
//
// Read and merged on every write, so two modules writing different keys never
// undo each other. A failed read is an empty object, and a failed write is
// ignored: the window just opens at its default size next time. Nothing secret
// is ever kept here.
//
// Keys: bounds, maximized, barColor, trayHintShown, updateNotices, hotkeys,
// onTop.

const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const file = () => path.join(app.getPath("userData"), "settings.json");

function readSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(file(), "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeSettings(changes) {
  try {
    fs.writeFileSync(file(), JSON.stringify({ ...readSettings(), ...changes }));
  } catch {
    // Not worth stopping anything for.
  }
}

module.exports = { readSettings, writeSettings };
