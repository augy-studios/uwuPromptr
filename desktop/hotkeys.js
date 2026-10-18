// Shortcuts that work while another app is in front: PowerPoint, Zoom, OBS.
//
// Off until somebody turns them on in Prompter settings, because a global
// shortcut takes its key from every other app on the computer. On, they are
// registered only while the prompter page is open and listening, so the remote
// page and the offline page never hold them.
//
// Most USB foot pedals and Stream Deck buttons can be set to send one of these
// keys, which is how they drive the prompter without a driver of their own.

const { globalShortcut } = require("electron");
const { readSettings, writeSettings } = require("./settings");

// Gemini's suggestion, kept: F8 is what transcription pedals often send for
// play. On a Mac the F keys need Fn, unless "Use F1, F2, etc. keys as standard
// function keys" is on.
const KEYS = [
  { accelerator: "F8", action: "toggle", label: "Start and stop" },
  { accelerator: "F9", action: "faster", label: "Faster" },
  { accelerator: "F10", action: "slower", label: "Slower" },
];

let send = () => {};
let listening = false;
let held = [];
let failed = [];

function enabled() {
  return readSettings().hotkeys === true;
}

function apply() {
  for (const accelerator of held) globalShortcut.unregister(accelerator);
  held = [];
  failed = [];
  if (!enabled() || !listening) return;

  for (const key of KEYS) {
    let ok = false;
    try {
      ok = globalShortcut.register(key.accelerator, () => send(key.action));
    } catch {
      ok = false;
    }
    // False when another app already holds the key.
    if (ok) held.push(key.accelerator);
    else failed.push(key.accelerator);
  }
}

/** What the page shows: whether they're on, the keys, and any that are taken. */
function state() {
  return {
    on: enabled(),
    keys: KEYS.map(({ accelerator, label }) => ({ key: accelerator, label })),
    failed: [...failed],
  };
}

/** `sendToPage(action)` hands a pressed key's action to the prompter. */
function init(sendToPage) {
  send = sendToPage;
}

function set(on) {
  writeSettings({ hotkeys: Boolean(on) });
  apply();
  return state();
}

/** The prompter page is open and wants the keys, or it has gone. */
function listen(on) {
  if (listening === Boolean(on)) return;
  listening = Boolean(on);
  apply();
}

module.exports = { init, set, listen, state };
