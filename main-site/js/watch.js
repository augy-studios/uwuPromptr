// The Wear OS watch app (android/native/wear/), through the Android app.
//
// The watch talks to the uwuPromptr app on its own phone, and the phone's page
// does what it asks: on the prompter page, to this prompter; on the remote
// page, through the remote to whichever prompter it is connected to. It speaks
// the web remote's own messages, so it is one more remote, with no code to
// type: only the same app on the paired watch, signed with the same key, can
// reach it at all.
//
// App only, and only when the app lists the "watch" feature (it needs Google
// Play services). In a browser none of this does anything.
//
// What goes back is a small summary rather than the remote's whole state: the
// watch has no copy of the screen to draw, and Bluetooth to a watch is no
// place for twenty messages a second. It goes once a second while the script
// plays (the watch counts the seconds between itself), at once when anything
// else changes, and only while a watch has said hello lately.

import { AppBridge } from "./app-bridge.js";

// The watch says hello every 20 seconds while its screen or tile is up. One
// not heard from for this long has been put away, and nothing more is sent.
const ATTACHED_MS = 90000;
// While the script plays, the clock and the progress at most this often.
const STEADY_MS = 1000;
const MAX_NAME = 80;

// What a watch may ask for. It drives the prompter; it never edits the
// script, hangs up the remote or changes anything but the speed.
const SIMPLE = new Set(["toggle", "play", "pause", "reset"]);

let summarise = null;
let heardAt = 0;
let attached = false;
let attachedChanged = () => {};
let lastKey = "";
let sentAt = 0;

/**
 * `summary()` says what the watch shows: { live, role, playing, speed,
 * elapsed, progress, name }. `onCommand(message)` carries out a checked
 * remote command. `onAttached(on)` hears when a watch starts or stops
 * listening.
 */
export async function initWatch({ summary, onCommand, onAttached }) {
  if (!(await AppBridge.ready(5000)) || !AppBridge.has("watch")) return;
  summarise = summary;
  if (onAttached) attachedChanged = onAttached;

  AppBridge.on("Cue", "watch", (event) => {
    let message;
    try {
      message = JSON.parse(event?.data);
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;

    heardAt = Date.now();
    setAttached(true);
    if (message.type === "command") {
      const command = checked(message);
      if (command) onCommand(command);
    }
    // A hello or a command, answered at once: the watch's tile waits on it.
    send(true);
  });

  // The clock while it plays, and noticing a watch that has gone.
  setInterval(updateWatch, STEADY_MS);
}

/** Something the watch shows may have changed. Cheap to call often. */
export function updateWatch() {
  if (!summarise) return;
  if (attached && Date.now() - heardAt > ATTACHED_MS) setAttached(false);
  if (attached) send(false);
}

export function watchAttached() {
  return attached;
}

function setAttached(on) {
  if (attached === on) return;
  attached = on;
  lastKey = "";
  attachedChanged(on);
}

function send(force) {
  const state = summarise();
  const name = String(state.name ?? "").slice(0, MAX_NAME);
  const key = JSON.stringify([state.live, state.role, state.playing, state.speed, name]);
  const now = Date.now();
  if (!force && key === lastKey && !(state.playing && now - sentAt >= STEADY_MS)) return;
  lastKey = key;
  sentAt = now;

  const data = JSON.stringify({
    v: 1,
    live: Boolean(state.live),
    role: state.role,
    playing: Boolean(state.playing),
    speed: Number(state.speed) || 0,
    elapsed: Math.round(Number(state.elapsed) || 0),
    progress: Math.round((Number(state.progress) || 0) * 10) / 10,
    name,
  });
  AppBridge.call("Cue", "watchSend", { data }).catch(() => {});
}

/** The command in the remote's own shape, or null for anything a watch may not do. */
function checked(message) {
  if (SIMPLE.has(message.name)) return { type: "command", name: message.name };
  if (message.setting !== "speed") return null;
  const value = Number(message.value);
  if (!Number.isFinite(value)) return null;
  if (message.name === "nudge") {
    return { type: "command", name: "nudge", setting: "speed", value: Math.sign(value), coarse: Boolean(message.coarse) };
  }
  if (message.name === "set") return { type: "command", name: "set", setting: "speed", value };
  return null;
}
