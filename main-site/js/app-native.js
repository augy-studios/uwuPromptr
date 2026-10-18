// What the prompter can do inside the Android app and nowhere else.
//
//   Full brightness     the screen at its brightest while the app is open, to
//                       read through teleprompter glass or in sunlight
//   Check for updates   the site and the app, in one press
//   Fullscreen          the navigation bar hidden as well as the status bar
//   Volume keys         either volume key, a Bluetooth selfie shutter or a
//                       headset's button starts and stops the script
//   New version alerts  a notification when a new version of the app is out
//
// Each one appears only when the app lists its feature in info().features, so
// a browser sees none of it and an older APK sees only what it can do. The
// screen keeping awake is in prompter.js and the offline remote in nearby.js.

import { AppBridge } from "./app-bridge.js";
import { hydrateIcons, toast } from "./ui.js";
import { checkEverythingNow } from "./app-update.js";

const APP_KEY = "uwupromptr";
const KEY_BRIGHT = `${APP_KEY}.fullBrightness`;
const KEY_KEYS = `${APP_KEY}.volumeKeys`;
const KEY_ALERTS = `${APP_KEY}.releaseAlerts`;

// Topics are shared by every app in the UwU Apps Firebase project, hence the
// prefix. api/push/release.js sends to this one.
const RELEASE_TOPIC = "cue-releases";

const el = (id) => document.getElementById(id);

function stored(key) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function store(key, on) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // Remembered for this page view only.
  }
}

function setPressed(button, on) {
  button.setAttribute("aria-pressed", String(on));
  button.classList.toggle("active", on);
}

/**
 * A button in the side tray, before the theme button, so the global actions
 * read settings, then the app's, then theme. The tray's stagger has a line for
 * every child it can hold, and its `inert` covers these too.
 */
function addTrayButton({ id, icon, label, pressed }) {
  const button = document.createElement("button");
  button.className = "glass-btn";
  button.type = "button";
  button.id = id;
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  if (pressed !== undefined) button.setAttribute("aria-pressed", String(pressed));
  button.innerHTML = `<span data-icon="${icon}"></span>`;
  el("themeBtn").before(button);
  hydrateIcons(button);
  return button;
}

/* ---- full brightness ---- */

function applyBrightness(on) {
  AppBridge.call("Cue", "brightness", { level: on ? 1 : -1 }).catch(() => {});
}

function wireBrightness() {
  let on = stored(KEY_BRIGHT);
  const button = addTrayButton({ id: "brightnessBtn", icon: "brightness", label: "Full brightness", pressed: on });
  applyBrightness(on);
  button.addEventListener("click", () => {
    on = !on;
    store(KEY_BRIGHT, on);
    setPressed(button, on);
    applyBrightness(on);
  });
}

/* ---- fullscreen ---- */

let immersive = false;

/**
 * Fullscreen in the app, where the Fullscreen API is unreliable. Returns the
 * new state, or null outside the app so the caller uses the browser's own.
 */
export function toggleImmersive() {
  if (!AppBridge.has("immersive")) return null;
  immersive = !immersive;
  AppBridge.call("Cue", "immersive", { on: immersive }).catch(() => {});
  return immersive;
}

/* ---- volume keys ---- */

function wireKeys(onPlayPause) {
  const button = el("keysToggle");
  let on = stored(KEY_KEYS);
  button.hidden = false;
  el("keysNote").hidden = false;
  setPressed(button, on);
  AppBridge.call("Cue", "keys", { on }).catch(() => {});

  AppBridge.on("Cue", "key", () => onPlayPause());

  button.addEventListener("click", () => {
    on = !on;
    store(KEY_KEYS, on);
    setPressed(button, on);
    AppBridge.call("Cue", "keys", { on }).catch(() => {});
  });
}

/* ---- new version alerts ---- */

function showAlertsNote(text, { settings = false } = {}) {
  const note = el("appSettingsNote");
  note.textContent = text;
  note.hidden = !text;
  el("appSettingsOpen").hidden = !settings;
}

async function notificationPermission() {
  const asked = await AppBridge.call("PushNotifications", "checkPermissions");
  if (asked?.receive === "granted") return "granted";
  if (asked?.receive === "denied") return "denied";
  // Asked only now, because somebody turned this on.
  const answer = await AppBridge.call("PushNotifications", "requestPermissions");
  return answer?.receive === "granted" ? "granted" : "denied";
}

function wireAlerts() {
  const button = el("alertsToggle");
  let on = stored(KEY_ALERTS);
  button.hidden = false;
  setPressed(button, on);

  // Joining a topic again is harmless, and puts back a subscription Firebase
  // may have dropped (a reinstall, cleared data).
  if (on) AppBridge.call("Cue", "topic", { name: RELEASE_TOPIC, on: true }).catch(() => {});

  el("appSettingsOpen").addEventListener("click", () => {
    AppBridge.call("Cue", "openSettings", { what: "notifications" }).catch(() => {});
  });

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      if (on) {
        // Leave the topic. Never PushNotifications.unregister, which would
        // delete the device's token and every other subscription with it.
        await AppBridge.call("Cue", "topic", { name: RELEASE_TOPIC, on: false });
        on = false;
        showAlertsNote("");
      } else {
        if ((await notificationPermission()) !== "granted") {
          showAlertsNote("Notifications are turned off for uwuPromptr. Turn them on in Android's settings, then try again.", {
            settings: true,
          });
          return;
        }
        await AppBridge.call("Cue", "topic", { name: RELEASE_TOPIC, on: true });
        on = true;
        showAlertsNote("You will get a notification when a new version of the app is out.");
      }
      store(KEY_ALERTS, on);
      setPressed(button, on);
    } catch {
      toast("Could not reach the notification service. Try again.");
    } finally {
      button.disabled = false;
    }
  });
}

/* ---- boot ---- */

/**
 * The prompter page. `onPlayPause` is what the volume keys do, and
 * `prompterWantsAwake` whether the prompter is holding the screen on already.
 *
 * Everything the app holds across pages is set here to what this page wants,
 * so nothing left on by another page (the remote) carries over.
 */
export async function initAppFeatures({ onPlayPause, prompterWantsAwake = () => false }) {
  if (!(await AppBridge.ready(5000))) return;

  AppBridge.call("Cue", "immersive", { on: false }).catch(() => {});
  // The prompter asks again the moment it plays or a remote connects.
  if (!prompterWantsAwake()) AppBridge.call("Cue", "keepAwake", { on: false }).catch(() => {});

  if (AppBridge.has("brightness")) wireBrightness();

  if (AppBridge.has("update")) {
    const check = addTrayButton({ id: "updateBtn", icon: "download", label: "Check for updates" });
    check.addEventListener("click", checkEverythingNow);
  }

  const keys = AppBridge.has("keys");
  const alerts = AppBridge.has("push");
  if (keys) wireKeys(onPlayPause);
  if (alerts) wireAlerts();
  el("appSettings").hidden = !(keys || alerts);
}

/** The remote page: none of the prompter's screen or key settings apply. */
export async function resetAppFeatures() {
  if (!(await AppBridge.ready(5000))) return;
  for (const [method, options] of [
    ["keys", { on: false }],
    ["brightness", { level: -1 }],
    ["keepAwake", { on: false }],
    ["immersive", { on: false }],
  ]) {
    AppBridge.call("Cue", method, options).catch(() => {});
  }
}
