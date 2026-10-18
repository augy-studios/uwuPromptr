// New versions of the Android app, offered in the update bar.
//
// Only inside the app, and only when it lists the "update" feature. The page
// asks /api/app-release for the newest release on GitHub, and if it is newer
// than the app's own version, the bar offers it. Update hands over to the
// app's updater, which downloads it and installs it with Android's installer.

import { AppBridge } from "./app-bridge.js";
import { offerAppUpdate, checkSiteNow } from "./sw-update.js";

// On returning to the app after this long, look again. The server caches the
// answer for ten minutes, so this costs GitHub nothing.
const RECHECK_AFTER_MS = 60 * 60 * 1000;

let lastCheck = 0;

/**
 * Whether version `a` is later than `b`, number by number, so 1.10.0 comes
 * after 1.9.0. The same rule as api/_lib/release.js and UpdateActivity.newer.
 */
export function isNewer(a, b) {
  const x = String(a ?? "").split(".").map((n) => parseInt(n, 10) || 0);
  const y = String(b ?? "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? 0;
    const q = y[i] ?? 0;
    if (p !== q) return p > q;
  }
  return false;
}

async function checkAppRelease() {
  lastCheck = Date.now();
  try {
    const response = await fetch("/api/app-release", { cache: "no-store" });
    if (!response.ok) return;
    const release = await response.json();
    if (!release?.version || !isNewer(release.version, AppBridge.version())) return;

    offerAppUpdate({
      version: release.version,
      onUpdate: () => {
        AppBridge.call("Cue", "update", { version: release.version }).catch(() => {});
      },
    });
  } catch {
    // Offline, or the server could not ask GitHub. The next check will do.
  }
}

/**
 * The Edge Tray's Check for updates: the site's service worker and the app,
 * in one press. The app's updater says "you have the newest version" itself
 * when there is nothing newer.
 */
export function checkEverythingNow() {
  checkSiteNow();
  AppBridge.call("Cue", "update", { check: true }).catch(() => {});
}

export async function initAppUpdates() {
  if (!(await AppBridge.ready(5000)) || !AppBridge.has("update")) return;

  checkAppRelease();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastCheck > RECHECK_AFTER_MS) {
      checkAppRelease();
    }
  });
}
