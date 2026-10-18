// The prompter's three Edge Trays, per edge-tray-spec.md.
//
//   top      the top bar: brand, the script switcher, edit, remote
//   bottom   the transport: play, reset, font, speed, the clock
//   side     a column at the left or right edge: settings, the display
//            toggles, fullscreen, theme, and the Android app's own actions
//
// Each slides off its edge when its tab is pressed, leaving only the tab, and
// each is remembered per browser. The state lives as classes on <html>
// (top-collapsed, bottom-collapsed, side-collapsed) because the inline script
// in <head> sets them before first paint, and one set of CSS rules then covers
// both the first frame and every toggle after it.
//
// While a tray is open, the reading area keeps clear of it; put away, the
// script takes the room. That is done in CSS from the bars' measured heights.

const APP_KEY = "uwupromptr";
const SIDE_KEY = `${APP_KEY}.traySide`;

const TRAYS = {
  top: {
    key: `${APP_KEY}.topTrayOpen`,
    collapsed: "top-collapsed",
    bodyClass: "top-tray-open",
    tab: "topTab",
    panel: "topBar",
    hide: "Hide top bar",
    show: "Show top bar",
  },
  bottom: {
    key: `${APP_KEY}.bottomTrayOpen`,
    collapsed: "bottom-collapsed",
    bodyClass: "bottom-tray-open",
    tab: "bottomTab",
    panel: "transportBar",
    hide: "Hide bottom bar",
    show: "Show bottom bar",
  },
  side: {
    key: `${APP_KEY}.trayOpen`,
    collapsed: "side-collapsed",
    bodyClass: "tray-open",
    tab: "sideTab",
    panel: "sideButtons",
    hide: "Hide menu",
    show: "Show menu",
  },
};

const root = document.documentElement;

export function isTrayOpen(name) {
  return !root.classList.contains(TRAYS[name].collapsed);
}

export function setTray(name, open, { save = true } = {}) {
  const tray = TRAYS[name];
  const tab = document.getElementById(tray.tab);
  const panel = document.getElementById(tray.panel);

  root.classList.toggle(tray.collapsed, !open);
  document.body.classList.toggle(tray.bodyClass, open);
  tab.setAttribute("aria-expanded", String(open));
  const label = open ? tray.hide : tray.show;
  tab.setAttribute("aria-label", label);
  tab.setAttribute("title", label);
  // Off-screen controls must not take focus or clicks, or be read out.
  panel.inert = !open;

  if (save) {
    try {
      localStorage.setItem(tray.key, open ? "1" : "0");
    } catch {
      // Remembered for this page view only.
    }
  }
}

export function getTraySide() {
  return root.getAttribute("data-tray-side") === "left" ? "left" : "right";
}

/**
 * Which edge the side tray is on. The tab stays on the tray's inner side, and
 * first in the tab order on the right, after the buttons on the left, so the
 * order a keyboard walks is the order the eye reads.
 */
export function setTraySide(side, { save = true } = {}) {
  const left = side === "left";
  if (left) root.setAttribute("data-tray-side", "left");
  else root.removeAttribute("data-tray-side");

  const tray = document.getElementById("sideTray");
  const tab = document.getElementById("sideTab");
  if (left) tray.append(tab);
  else tray.prepend(tab);

  if (save) {
    try {
      localStorage.setItem(SIDE_KEY, left ? "left" : "right");
    } catch {
      // See setTray.
    }
  }
  document.dispatchEvent(new CustomEvent("uwu:trayside", { detail: { side: left ? "left" : "right" } }));
}

/* The bars' heights, as --top-bar-h and --bottom-bar-h, which is how much
   room the reading area leaves for each while it is open. Measured rather than
   fixed, because the bars change height with the screen: the shortcut hints go
   on a phone, and the transport wraps. */
function measureBars() {
  const publish = (element, property) => {
    root.style.setProperty(property, `${element.offsetHeight}px`);
  };
  const top = document.getElementById("topBar");
  const bottom = document.getElementById("transportBar");
  publish(top, "--top-bar-h");
  publish(bottom, "--bottom-bar-h");

  if (typeof ResizeObserver !== "function") return;
  new ResizeObserver(() => publish(top, "--top-bar-h")).observe(top);
  new ResizeObserver(() => publish(bottom, "--bottom-bar-h")).observe(bottom);
}

/* The side column scrolls only when it does not fit: between the two bars on
   a phone held sideways, or with the Android app's extra buttons. Any other
   time it is a plain column, because a scroll box clips the buttons' shadows. */
function watchSideOverflow() {
  const column = document.getElementById("sideButtons");
  const check = () => {
    // Measured without the class, so a column that has stopped overflowing
    // can be seen to fit again.
    column.classList.remove("scrolls");
    column.classList.toggle("scrolls", column.scrollHeight > column.clientHeight + 1);
  };
  check();
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(check).observe(document.querySelector(".hud-side"));
  }
  window.addEventListener("resize", check);
  // Buttons the Android app adds later.
  new MutationObserver(check).observe(column, { childList: true });
}

export function initEdgeTrays() {
  for (const [name, tray] of Object.entries(TRAYS)) {
    let open = true;
    try {
      open = localStorage.getItem(tray.key) !== "0";
    } catch {
      // Open, the default.
    }
    setTray(name, open, { save: false });
    document.getElementById(tray.tab).addEventListener("click", () => {
      setTray(name, !isTrayOpen(name));
    });
  }

  let side = "right";
  try {
    side = localStorage.getItem(SIDE_KEY) === "left" ? "left" : "right";
  } catch {
    // The right edge, the default.
  }
  setTraySide(side, { save: false });

  measureBars();
  watchSideOverflow();

  // The first frame has been laid out with the real state and the real bar
  // heights and no transitions. From the next one on, every change animates.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.remove("trays-booting"));
  });
}
