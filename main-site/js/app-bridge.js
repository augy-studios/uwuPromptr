// The channel to the Android app, when this page is running inside it.
//
// In a browser every call here is a no-op and has() is always false, so the
// site and the PWA behave exactly as they always have. Inside the app,
// window.Capacitor is injected before any script runs, and the app's Cue plugin
// says what it can do through info().features.
//
// **Gate every app-only feature on has("<feature>"), never on `native` alone.**
// The site deploys ahead of the APK, and an older APK lacks newer features: it
// simply does not list them, and the page shows less.
//
// data-app and data-statusbar are set before first paint by the inline script
// in each page's <head>, from the user agent, so the layout does not jump when
// info() answers a moment later.

const cap = window.Capacitor;
const native = Boolean(
  cap && typeof cap.nativePromise === "function" && cap.getPlatform?.() === "android"
);

let info = null;
let infoPromise = null;

function call(plugin, method, options = {}) {
  if (!native) return Promise.reject(new Error("Not in the app"));
  return cap.nativePromise(plugin, method, options);
}

/**
 * Listen for a plugin's event. Returns something with remove(), in the app and
 * out of it, so callers never have to check which.
 */
function on(plugin, event, fn) {
  if (!native || typeof cap.addListener !== "function") return { remove() {} };
  const handle = cap.addListener(plugin, event, (data, error) => {
    if (!error) fn(data);
  });
  return { remove: () => handle?.remove?.() };
}

function loadInfo() {
  if (!native) return Promise.resolve(null);
  if (!infoPromise) {
    infoPromise = call("Cue", "info")
      .then((answer) => {
        info = answer;
        return answer;
      })
      .catch(() => null);
  }
  return infoPromise;
}

/** Resolves true once the app has said what it can do, false after `ms`. */
function ready(ms = 5000) {
  if (!native) return Promise.resolve(false);
  return Promise.race([
    loadInfo().then(Boolean),
    new Promise((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

function has(feature) {
  return Boolean(info?.features?.includes(feature));
}

/** The app's versionName, "1.0.0", or null in a browser. */
function version() {
  return info?.version ?? null;
}

/* The status bar's icons follow the page's mode, not the phone's: the site
   picks light or dark itself, and dark icons on a dark page are invisible when
   the bar is swiped down. */
function syncStatusBarStyle() {
  const dark = document.documentElement.getAttribute("data-mode") === "dark";
  call("SystemBars", "setStyle", { style: dark ? "DARK" : "LIGHT" }).catch(() => {});
}

if (native) {
  loadInfo();
  syncStatusBarStyle();
  new MutationObserver(syncStatusBarStyle).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-mode"],
  });
}

export const AppBridge = { native, call, on, ready, has, version };
