// Scripts and prompter settings, both in localStorage. Everything this app
// keeps is on the device: nothing is uploaded, and the prompter works with
// no network at all.

const APP_KEY = "uwupromptr";
const KEY_SCRIPTS = `${APP_KEY}.scripts`;
const KEY_ACTIVE = `${APP_KEY}.activeScript`;
const KEY_SETTINGS = `${APP_KEY}.settings`;
const KEY_HOST_CODE = `${APP_KEY}.hostCode`;

export const SETTING_RANGES = {
  // Granular, which is the point of this app: promptr.tv moves in whole
  // steps, this moves in tenths and single pixels.
  fontSize: { min: 16, max: 200, step: 1, coarse: 4, default: 60 },
  speed: { min: 0.1, max: 40, step: 0.1, coarse: 1, default: 12 },
  lineHeight: { min: 1, max: 2.4, step: 0.05, coarse: 0.1, default: 1.4 },
  margin: { min: 0, max: 40, step: 1, coarse: 5, default: 8 },
  // Where the focus line sits, as a percentage down the viewport. It has no
  // coarse step because nothing nudges it from the keyboard; it is here so
  // that it clamps and resets like every other numeric setting.
  focusPosition: { min: 10, max: 80, step: 1, coarse: 5, default: 40 },
};

export const DEFAULT_SETTINGS = {
  fontSize: SETTING_RANGES.fontSize.default,
  speed: SETTING_RANGES.speed.default,
  lineHeight: SETTING_RANGES.lineHeight.default,
  margin: SETTING_RANGES.margin.default,
  focusPosition: SETTING_RANGES.focusPosition.default,
  flipX: false,
  flipY: false,
  focusLine: true,
  timer: true,
};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    // Corrupt or unavailable storage is not a reason to fail to boot; the
    // person gets defaults rather than a blank screen.
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing with storage denied, or a full quota. The session
    // still works, it just will not survive a reload.
  }
}

export function newId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/* The remote id this prompter publishes.

   Kept rather than minted on every start, because a code that changes whenever
   the panel is reopened or the page reloaded is a code the remote cannot be
   told to come back on: the phone remembers what it was given, and a prompter
   that has quietly moved on leaves it holding an id that no longer exists.

   It survives a reload for the same reason. Retiring it is a deliberate act,
   from the New ID button or from a remote that signed off, and that is the
   only thing that clears it. */
export function getStoredHostCode() {
  try {
    return localStorage.getItem(KEY_HOST_CODE) || "";
  } catch {
    return "";
  }
}

export function setStoredHostCode(code) {
  try {
    if (code) localStorage.setItem(KEY_HOST_CODE, code);
    else localStorage.removeItem(KEY_HOST_CODE);
  } catch {
    // See writeJson. A code that cannot be stored still works for this
    // session; it just will not be the same one after a reload.
  }
}

const WELCOME = `Welcome to uwuPromptr.

Tap Edit to replace this with your own script, or open the scripts menu up top to start a new one.

Press space to start and stop scrolling. Up and down change the font size, left and right change the speed, and holding shift with them moves in bigger steps.

Everything you write stays on this device, and the prompter keeps working with no connection at all.`;

export function getScripts() {
  const scripts = readJson(KEY_SCRIPTS, null);
  if (Array.isArray(scripts) && scripts.length) return scripts;

  const first = [{ id: newId(), name: "My first script", body: WELCOME, updated: Date.now() }];
  writeJson(KEY_SCRIPTS, first);
  return first;
}

export function saveScripts(scripts) {
  writeJson(KEY_SCRIPTS, scripts);
}

export function getActiveScriptId() {
  const scripts = getScripts();
  const stored = localStorage.getItem(KEY_ACTIVE);
  if (stored && scripts.some((s) => s.id === stored)) return stored;
  return scripts[0].id;
}

export function setActiveScriptId(id) {
  try {
    localStorage.setItem(KEY_ACTIVE, id);
  } catch {
    // See writeJson.
  }
}

export function getActiveScript() {
  const scripts = getScripts();
  const id = getActiveScriptId();
  return scripts.find((s) => s.id === id) || scripts[0];
}

export function updateScript(id, patch) {
  const scripts = getScripts().map((s) =>
    s.id === id ? { ...s, ...patch, updated: Date.now() } : s
  );
  saveScripts(scripts);
  return scripts;
}

export function createScript(name = "Untitled script") {
  const script = { id: newId(), name, body: "", updated: Date.now() };
  saveScripts([...getScripts(), script]);
  return script;
}

export function deleteScript(id) {
  const remaining = getScripts().filter((s) => s.id !== id);
  // Never leave the app with nothing to show; the last script deleted is
  // replaced by a fresh empty one rather than an empty menu.
  const scripts = remaining.length
    ? remaining
    : [{ id: newId(), name: "Untitled script", body: "", updated: Date.now() }];
  saveScripts(scripts);
  if (getActiveScriptId() === id) setActiveScriptId(scripts[0].id);
  return scripts;
}

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson(KEY_SETTINGS, {}) };
}

export function saveSettings(settings) {
  writeJson(KEY_SETTINGS, settings);
}

export function clampSetting(name, value) {
  const range = SETTING_RANGES[name];
  if (!range) return value;
  const clamped = Math.min(range.max, Math.max(range.min, Number(value)));
  // Round to the step, so repeated nudges do not accumulate a long tail of
  // floating point noise in what is shown on screen.
  const decimals = (String(range.step).split(".")[1] || "").length;
  return Number(clamped.toFixed(decimals));
}
