// What the prompter can do inside the desktop app (desktop/) and nowhere else.
//
//   Screen stays on          while the script plays or a remote is connected,
//                            held by the app (prompter.js asks through here)
//   Keep on top              the window above every other, from the side tray
//                            or the app's tray icon
//   Check for updates        the site and the app, in one press
//   Shortcuts in other apps  F8, F9 and F10 drive the prompter while PowerPoint
//                            or Zoom is in front; foot pedals and Stream Decks
//                            that send those keys too
//   New version alerts       a notification when a new version of the app is out
//
// window.cueDesktop comes from the app's preload, before any script here runs.
// **Gate every feature on the method it needs, never on cueDesktop alone**: the
// site deploys ahead of the app, and an older app simply lacks newer methods.
// In a browser none of this does anything.
//
// The app's title bar takes the page's theme-color. The site sets it to the
// brand colour, which is the page in light mode but not in dark, so in the app
// it follows the mode too.

import { addTrayButton } from "./app-native.js";
import { checkSiteNow } from "./sw-update.js";
import { toast } from "./ui.js";

const desk = window.cueDesktop;
const root = document.documentElement;
const el = (id) => document.getElementById(id);

// The prompter's dark page, .stage in css/app.css.
const DARK_PAGE = "#0c100e";

/** Whether the app has this method, by its dotted name: "hotkeys.onPress". */
export function desktopHas(name) {
  if (!desk) return false;
  let value = desk;
  for (const part of name.split(".")) value = value?.[part];
  return typeof value === "function";
}

/* ---- the title bar's colour ---- */

function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const brand = getComputedStyle(root).getPropertyValue("--brand").trim();
  const colour = root.getAttribute("data-mode") === "dark" ? DARK_PAGE : brand;
  if (/^#[0-9a-f]{6}$/i.test(colour)) meta.setAttribute("content", colour);
}

if (desk) {
  syncThemeColor();
  // theme.js sets the brand colour inline, as --brand, after data-color-theme.
  new MutationObserver(syncThemeColor).observe(root, {
    attributes: true,
    attributeFilter: ["data-mode", "data-color-theme", "style"],
  });
}

/* ---- the screen kept awake ---- */

/**
 * Holds the display on, or lets it go, through the app. False outside the app,
 * so the caller uses the browser's Screen Wake Lock instead.
 */
export function desktopKeepAwake(on) {
  if (!desktopHas("keepAwake")) return false;
  desk.keepAwake(Boolean(on));
  return true;
}

function setPressed(button, on) {
  button.setAttribute("aria-pressed", String(on));
  button.classList.toggle("active", on);
}

/* ---- keep on top ---- */

function wireOnTop() {
  let on = false;
  const button = addTrayButton({ id: "onTopBtn", icon: "pin", label: "Keep on top", pressed: on });
  desk.onTop
    .get()
    .then((value) => {
      on = Boolean(value);
      setPressed(button, on);
    })
    .catch(() => {});

  button.addEventListener("click", () => {
    on = !on;
    setPressed(button, on);
    desk.onTop.set(on).catch(() => {});
  });

  // Switched from the tray icon's menu.
  if (desktopHas("onTop.onChange")) {
    desk.onTop.onChange((value) => {
      on = Boolean(value);
      setPressed(button, on);
    });
  }
}

/* ---- shortcuts in other apps ---- */

function renderHotkeys(state) {
  if (!state) return;
  const button = el("hotkeysToggle");
  setPressed(button, Boolean(state.on));

  const keys = (state.keys ?? []).map((k) => `${k.key}: ${k.label.toLowerCase()}.`).join(" ");
  let text = `${keys} They work whichever app is in front, and so does a foot pedal or Stream Deck set to send them.`;
  if (desk.platform === "darwin") {
    text += " On a Mac, hold Fn with them, unless the F keys are set to work as standard function keys.";
  }
  if (state.on && state.failed?.length) {
    text += ` Another app is using ${state.failed.join(" and ")}, so ${state.failed.length > 1 ? "they do" : "it does"} nothing here for now.`;
  }
  el("hotkeysNote").textContent = text;
}

function wireHotkeys(onHotkey) {
  const button = el("hotkeysToggle");
  button.hidden = false;
  el("hotkeysNote").hidden = false;

  // Listening is what registers the keys, so this comes before asking which
  // of them another app already holds.
  desk.hotkeys.onPress((action) => onHotkey(String(action)));
  desk.hotkeys.get().then(renderHotkeys).catch(() => {});

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      renderHotkeys(await desk.hotkeys.set(button.getAttribute("aria-pressed") !== "true"));
    } catch {
      toast("Could not change the shortcuts. Try again.");
    } finally {
      button.disabled = false;
    }
  });
}

/* ---- new version alerts ---- */

function wireReleases() {
  const button = el("desktopAlertsToggle");
  button.hidden = false;
  // On unless turned off.
  let on = true;
  setPressed(button, on);
  desk.releases
    .get()
    .then((value) => {
      on = value !== false;
      setPressed(button, on);
    })
    .catch(() => {});

  button.addEventListener("click", () => {
    on = !on;
    setPressed(button, on);
    desk.releases.set(on).catch(() => toast("Could not change that. Try again."));
  });
}

/* ---- boot ---- */

/**
 * The prompter page. `onHotkey(action)` is what a global shortcut does:
 * "toggle", "faster" or "slower".
 */
export function initDesktopFeatures({ onHotkey }) {
  if (!desk) return;

  if (desktopHas("onTop.get") && desktopHas("onTop.set")) wireOnTop();

  if (desktopHas("checkForUpdates")) {
    const check = addTrayButton({ id: "desktopUpdateBtn", icon: "download", label: "Check for updates" });
    check.addEventListener("click", () => {
      checkSiteNow();
      // The app says what it found in a notification.
      desk.checkForUpdates();
      toast("Checking for updates");
    });
  }

  const keys = desktopHas("hotkeys.get") && desktopHas("hotkeys.set") && desktopHas("hotkeys.onPress");
  const alerts = desktopHas("releases.get") && desktopHas("releases.set");
  if (keys) wireHotkeys(onHotkey);
  if (alerts) wireReleases();
  el("desktopSettings").hidden = !(keys || alerts);
}
