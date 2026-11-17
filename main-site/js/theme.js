// Theme system: 7 brand colour swatches + light/dark mode.
// Default is always light + classic (#ccffcc), regardless of OS preference.
// Once the user picks something, it is persisted.

const APP_KEY = "uwupromptr";

export const COLOR_THEMES = [
  { id: "classic", label: "Classic", hex: "#ccffcc" },
  { id: "not-green-1", label: "Not green 1", hex: "#ffcccc" },
  { id: "not-green-2", label: "Not green 2", hex: "#ccccff" },
  { id: "not-green-3", label: "Not green 3", hex: "#ffffcc" },
  { id: "not-green-4", label: "Not green 4", hex: "#ffccff" },
  { id: "not-green-5", label: "Not green 5", hex: "#ccffff" },
  { id: "really-light-green", label: "Really really light green", hex: "#ffffff" },
];

const STORAGE_KEY_COLOR = `${APP_KEY}.colorTheme`;
const STORAGE_KEY_MODE = `${APP_KEY}.mode`;

// Turns a colour like "#ccffcc" into "204, 255, 204", the red, green and blue
// parts on their own, which CSS can then wrap in rgba() to add transparency.
function hexToRgb(hex) {
  const colorNumber = parseInt(hex.replace("#", ""), 16);
  return `${(colorNumber >> 16) & 255}, ${(colorNumber >> 8) & 255}, ${colorNumber & 255}`;
}

// The colour theme the person last picked, or "classic" when nothing has been
// saved yet.
export function getStoredColorTheme() {
  const storedTheme = localStorage.getItem(STORAGE_KEY_COLOR);
  if (storedTheme) {
    return storedTheme;
  }
  return "classic";
}

/* Mode preference and mode are different things. The preference is what the
   person chose and can be "time"; the mode is what the document is in and
   is only ever light or dark. */

export const MODE_PREFERENCES = ["light", "dark", "time"];

/* The daylight window. Duplicated in the pre-paint script in every head,
   which has to resolve this before first paint and cannot import anything.
   Change both together. */
export const LIGHT_FROM_HOUR = 9;
export const LIGHT_UNTIL_HOUR = 18;

// The mode preference the person last picked. Anything missing or not
// recognised counts as "light".
export function getModePreference() {
  const storedPreference = localStorage.getItem(STORAGE_KEY_MODE);
  if (MODE_PREFERENCES.includes(storedPreference)) {
    return storedPreference;
  }
  return "light";
}

// Whether the given time (now, by default) falls inside the daylight window.
export function isDaylightHours(now = new Date()) {
  const hour = now.getHours();
  return hour >= LIGHT_FROM_HOUR && hour < LIGHT_UNTIL_HOUR;
}

// Turns a preference into an actual mode. "time" becomes light or dark by the
// clock; anything that is not "dark" becomes light.
export function resolveMode(preference) {
  if (preference === "time") {
    if (isDaylightHours()) {
      return "light";
    } else {
      return "dark";
    }
  }
  if (preference === "dark") {
    return "dark";
  } else {
    return "light";
  }
}

// The mode the document is in right now, resolved. What the theme button
// icon and anything else reading the active mode wants.
export function getStoredMode() {
  return resolveMode(getModePreference());
}

// Switches the page to the colour theme with this id, saves the choice, and
// tells the rest of the page with a "uwu:colorchange" event. An unknown id
// falls back to the first theme, Classic.
export function applyColorTheme(id) {
  let theme = COLOR_THEMES.find((candidate) => {
    return candidate.id === id;
  });
  if (!theme) {
    theme = COLOR_THEMES[0];
  }
  document.documentElement.setAttribute("data-color-theme", theme.id);
  document.documentElement.style.setProperty("--brand", theme.hex);
  document.documentElement.style.setProperty("--brand-rgb", hexToRgb(theme.hex));
  localStorage.setItem(STORAGE_KEY_COLOR, theme.id);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", theme.hex);
  }
  document.dispatchEvent(
    new CustomEvent("uwu:colorchange", { detail: { theme: theme.id } })
  );
  return theme;
}

// Saves a mode preference (light, dark or time), puts the page in the mode it
// resolves to, and returns that mode. Anything unrecognised is treated as light.
export function applyMode(preference) {
  let chosen = "light";
  if (MODE_PREFERENCES.includes(preference)) {
    chosen = preference;
  }
  const resolved = resolveMode(chosen);

  document.documentElement.setAttribute("data-mode", resolved);
  document.documentElement.setAttribute("data-mode-preference", chosen);
  localStorage.setItem(STORAGE_KEY_MODE, chosen);

  scheduleModeCheck();

  return resolved;
}

/* Keeping the time based mode honest while the page stays open. */

let modeTimer = null;
let watchingVisibility = false;

// Milliseconds until the next 09:00 or 18:00, whichever comes first.
function millisecondsUntilNextBoundary(now = new Date()) {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);

  const hour = now.getHours();
  if (hour < LIGHT_FROM_HOUR) {
    next.setHours(LIGHT_FROM_HOUR);
  } else if (hour < LIGHT_UNTIL_HOUR) {
    next.setHours(LIGHT_UNTIL_HOUR);
  } else {
    next.setDate(next.getDate() + 1);
    next.setHours(LIGHT_FROM_HOUR);
  }

  // A second of slack, so a timer that fires a fraction early does not land
  // back in the hour it just left and reschedule itself in a tight loop.
  return Math.max(1000, next.getTime() - now.getTime() + 1000);
}

// Sets a timer for the next 09:00 or 18:00, so a page following the clock
// switches mode on time. Also re-checks whenever the tab comes back into view,
// because browsers can delay timers in tabs nobody is looking at.
function scheduleModeCheck() {
  if (modeTimer !== null) {
    clearTimeout(modeTimer);
    modeTimer = null;
  }

  if (getModePreference() !== "time") {
    return;
  }

  modeTimer = setTimeout(() => {
    modeTimer = null;
    refreshTimeMode();
  }, millisecondsUntilNextBoundary());

  if (!watchingVisibility && typeof document !== "undefined") {
    watchingVisibility = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        refreshTimeMode();
      }
    });
  }
}

// When following the clock, puts the page in whichever mode the time now calls
// for, announces a change with a "uwu:modechange" event, and sets the next check.
export function refreshTimeMode() {
  if (getModePreference() !== "time") {
    return;
  }

  const resolved = resolveMode("time");
  const current = document.documentElement.getAttribute("data-mode");

  if (resolved !== current) {
    document.documentElement.setAttribute("data-mode", resolved);
    document.dispatchEvent(
      new CustomEvent("uwu:modechange", {
        detail: { mode: resolved, preference: "time" },
      })
    );
  }

  scheduleModeCheck();
}

// Applies the saved colour theme and mode when a page starts.
export function initTheme() {
  applyColorTheme(getStoredColorTheme());
  // The preference, not the resolved mode. Passing the resolved one would
  // quietly rewrite a stored "time" into "dark" the first evening.
  applyMode(getModePreference());
}
