// First-visit tours (docs/page-tour-spec.md): the page dims, one thing on it is lit, and a chalk
// arrow runs to it from a line saying what it does. Next moves on, Skip ends it. A tour for each
// page (the prompter, which is also the welcome, and the remote) and for the Remote control
// window, each shown the first time it's on screen; Prompter settings' Show me around replays
// any of them. The same tours, under the same keys, as the apps' (flutter/lib/features/tour/).
//
// Each step's element is scrolled into view before it's lit, and the card and its arrow are kept
// on screen whatever the size of the screen or of the element (§3): below or above the element if
// there's room, else beside it, else on a solid backing at the far end, without an arrow.
//
// The two pages are two documents. A replay of the other page's tour goes there with ?tour=<id>,
// runs, and comes back.

const WELCOME_KEY = "uwupromptr.tour.welcome";
const PAGES_KEY = "uwupromptr.tour.pages";
const PAD = 8;
const START = "prompter";

const TOURS = {
  prompter: {
    label: "Prompter",
    steps: [
      { el: "#scriptSwitch, #topTab", text: "Your scripts. Switch to another one, or start a new one, here." },
      { el: "#editBtn, #topTab", text: "Write or paste your script. It saves as you type." },
      { el: "#playBtn, #bottomTab", text: "Start and stop the scroll. Space does it too." },
      { el: "#speedValue, #bottomTab", text: "Faster or slower while it runs, a tenth at a time. The font size is beside it." },
      { el: "#remoteBtn, #topTab", text: "Drive it from your phone: this gives a code to type in there." },
      { el: "#settingsBtn, #sideTab", text: "Settings has every option, and Show me around for these tours again." },
    ],
  },
  remote: {
    label: "Remote",
    steps: [
      { el: "#codeInput", text: "Type the remote ID the prompter shows: on another device, or in the app." },
      { el: "#connectBtn", text: "Connect. Both devices need to be on the same network, or a hotspot from one to the other." },
      { el: "#playBtn", text: "Start and stop the prompter from here." },
      { el: ".nudge-row", text: "The outer buttons are big steps, the inner ones fine." },
      { el: "#preview", text: "A copy of the prompter’s screen, scrolling with it. Edit changes its script." },
      { el: "#homeLink", text: "Back to this device’s own prompter." },
    ],
  },
  "remote-panel": {
    label: "Remote control",
    steps: [
      { el: "#remoteCode", text: "Type this ID into the remote on the other device. Tap it to copy it." },
      { el: "#qrHolder svg", text: "Or scan this with the other phone’s camera." },
      { el: "#nearbyHostBtn", text: "No wifi? Two phones with the app connect straight to each other." },
      { el: "#remoteOpenBtn", text: "To make this device the remote instead." },
    ],
  },
};

/* ---- the pages ---- */

const pages = {
  active() {
    if (document.body.classList.contains("page-remote")) return "remote";
    const open = document.querySelector(".modal-backdrop:not(.hidden)");
    if (open) return open.id === "remoteModal" ? "remote-panel" : open.id;
    return "prompter";
  },
  open(id) {
    if (id === "remote") {
      location.href = "/remote?tour=remote";
    } else if (id === "prompter" || id === "remote-panel") {
      if (document.body.classList.contains("page-remote")) {
        location.href = `/?tour=${id}`;
        return;
      }
      if (id === "remote-panel") document.getElementById("remoteBtn")?.click();
    }
  },
};

/* ---- seen ---- */

function seen(id) {
  try {
    if (id === START) return localStorage.getItem(WELCOME_KEY) === "done";
    return JSON.parse(localStorage.getItem(PAGES_KEY) || "[]").includes(id);
  } catch {
    // Broken storage counts every tour as seen, rather than showing one on every visit.
    return true;
  }
}

function markSeen(id) {
  try {
    if (id === START) return localStorage.setItem(WELCOME_KEY, "done");
    const list = JSON.parse(localStorage.getItem(PAGES_KEY) || "[]");
    if (!list.includes(id)) localStorage.setItem(PAGES_KEY, JSON.stringify([...list, id]));
  } catch {
    // Shown again next time.
  }
}

/* ---- the layer ---- */

let steps = [];
let at = 0;
let root = null;
let page = null;
let cameBack = null;

/* Visible: not hidden, not off screen in a put away tray, and not behind inert. */
function visible(el) {
  if (!el || el.closest("[hidden]") || el.closest("[inert]") || el.closest(".hidden")) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
  return getComputedStyle(el).visibility !== "hidden";
}
const target = (s) => [...document.querySelectorAll(s.el)].find(visible) || null;

function build() {
  root = document.createElement("div");
  root.className = "tour";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "tourText");
  root.innerHTML =
    '<div class="tourHole"></div>' +
    '<svg class="tourArrow" aria-hidden="true"><defs><filter id="tourChalk"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.5"/></filter></defs>' +
    '<path class="tourLine" filter="url(#tourChalk)"/><path class="tourHead" filter="url(#tourChalk)"/></svg>' +
    '<button class="tourSkip" type="button">Skip</button>' +
    '<div class="tourCard"><p id="tourText" class="tourText" aria-live="polite"></p>' +
    '<div class="tourFoot"><span class="tourDots" aria-hidden="true"></span><button class="tourNext" type="button">Next</button></div></div>';
  document.body.appendChild(root);
  root.querySelector(".tourSkip").addEventListener("click", end);
  root.querySelector(".tourNext").addEventListener("click", next);
  root.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") end();
    if (e.key === "ArrowRight") next();
  });
  window.addEventListener("resize", place);
  window.addEventListener("scroll", place, true);
}

function show(i) {
  at = i;
  const el = steps[i].target;
  // §3.1: a tall element from its top.
  const tall = el.getBoundingClientRect().height > innerHeight * 0.6;
  el.scrollIntoView({ block: tall ? "start" : "center", behavior: "instant" });
  root.querySelector(".tourText").textContent = steps[i].text;
  root.querySelector(".tourDots").innerHTML = steps.map((_, n) => `<span${n === i ? ' class="on"' : ""}></span>`).join("");
  root.querySelector(".tourNext").textContent = i === steps.length - 1 ? "Done" : "Next";
  requestAnimationFrame(place);
  root.querySelector(".tourNext").focus({ preventScroll: true });
}

const M = 12;
const EDGE = 20;
const GAP_MIN = 36;
const GAP_MAX = 70;
const CARD_MIN = 220;
const clamp = (lo, v, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/* §3: the hole, the card on the side with room, lined up with the element, and the arrow
   between them, all of it on screen. */
function place() {
  if (!root) return;
  const el = steps[at]?.target;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const vw = innerWidth;
  const vh = innerHeight;
  Object.assign(root.querySelector(".tourHole").style, {
    left: `${r.left - PAD}px`,
    top: `${r.top - PAD}px`,
    width: `${r.width + PAD * 2}px`,
    height: `${r.height + PAD * 2}px`,
  });
  const v = { left: Math.max(r.left, 0), right: Math.min(r.right, vw), top: Math.max(r.top, 0), bottom: Math.min(r.bottom, vh) };
  const card = root.querySelector(".tourCard");
  card.classList.remove("solid");
  card.style.width = "";
  let cw = card.offsetWidth;
  let ch = card.offsetHeight;
  const room = { below: vh - v.bottom - PAD - M, above: v.top - PAD - M, right: vw - v.right - PAD - M, left: v.left - PAD - M };
  let side = null;
  if (Math.max(room.below, room.above) >= ch + GAP_MIN) side = room.below >= room.above ? "below" : "above";
  else {
    const s = room.right >= room.left ? "right" : "left";
    const fit = room[s] - GAP_MIN;
    if (fit >= Math.min(cw, CARD_MIN)) {
      if (fit < cw) {
        card.style.width = `${fit}px`;
        cw = card.offsetWidth;
        ch = card.offsetHeight;
      }
      if (ch <= vh - M * 2) side = s;
      else card.style.width = "";
    }
  }
  const line = root.querySelector(".tourLine");
  const head = root.querySelector(".tourHead");
  let left;
  let top;
  if (!side) {
    card.classList.add("solid");
    cw = card.offsetWidth;
    ch = card.offsetHeight;
    left = (vw - cw) / 2;
    top = (v.top + v.bottom) / 2 > vh / 2 ? M : vh - ch - M;
    Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
    line.setAttribute("d", "");
    head.setAttribute("d", "");
    return;
  }
  const midX = (v.left + v.right) / 2;
  const midY = (v.top + v.bottom) / 2;
  let sx;
  let sy;
  let tx;
  let ty;
  if (side === "below" || side === "above") {
    const gap = clamp(GAP_MIN, room[side] - ch, GAP_MAX);
    left = clamp(M, midX - cw / 2, vw - cw - M);
    top = side === "below" ? v.bottom + PAD + gap : v.top - PAD - gap - ch;
    top = clamp(M, top, vh - ch - M);
    tx = clamp(v.left + 12, midX, v.right - 12);
    ty = side === "below" ? v.bottom + PAD + 4 : v.top - PAD - 4;
    sx = clamp(left + 24, tx, left + cw - 24);
    sy = side === "below" ? top - 6 : top + ch + 6;
  } else {
    const gap = clamp(GAP_MIN, room[side] - cw, GAP_MAX);
    left = side === "right" ? v.right + PAD + gap : v.left - PAD - gap - cw;
    left = clamp(M, left, vw - cw - M);
    top = clamp(M, midY - ch / 2, vh - ch - M);
    tx = side === "right" ? v.right + PAD + 4 : v.left - PAD - 4;
    ty = clamp(v.top + 12, midY, v.bottom - 12);
    sx = side === "right" ? left - 6 : left + cw + 6;
    sy = clamp(top + 16, ty, top + ch - 16);
  }
  Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
  const inX = (x) => clamp(EDGE, x, vw - EDGE);
  const inY = (y) => clamp(EDGE, y, vh - EDGE);
  tx = inX(tx);
  ty = inY(ty);
  sx = inX(sx);
  sy = inY(sy);
  const dx = tx - sx;
  const dy = ty - sy;
  const mx = inX((sx + tx) / 2 - dy * 0.2);
  const my = inY((sy + ty) / 2 + dx * 0.2);
  root.querySelector(".tourArrow").setAttribute("viewBox", `0 0 ${vw} ${vh}`);
  line.setAttribute("d", `M${sx},${sy} Q${mx},${my} ${tx},${ty}`);
  line.style.setProperty("--len", Math.ceil(line.getTotalLength()) + 10);
  const ang = Math.atan2(ty - my, tx - mx);
  const a1 = ang + Math.PI * 0.8;
  const a2 = ang - Math.PI * 0.8;
  const len = 14;
  head.setAttribute("d", `M${tx + Math.cos(a1) * len},${ty + Math.sin(a1) * len} L${tx},${ty} L${tx + Math.cos(a2) * len},${ty + Math.sin(a2) * len}`);
}

function next() {
  if (at < steps.length - 1) show(at + 1);
  else end();
}

function end() {
  if (page) markSeen(page);
  removeEventListener("resize", place);
  removeEventListener("scroll", place, true);
  root?.remove();
  root = null;
  page = null;
  document.body.classList.remove("touring");
  // A replay that came over from the other page goes back to it.
  if (cameBack) {
    const back = cameBack;
    cameBack = null;
    location.href = back;
    return;
  }
  setTimeout(forPage, 600);
}

/** `id`'s tour, on its page. */
export function startTour(id) {
  if (root || !TOURS[id]) return;
  if (pages.active() !== id) {
    pages.open(id);
    // Over on another document: it starts there. On this one, once the window has opened.
    if (id === "remote" || document.body.classList.contains("page-remote")) return;
  }
  setTimeout(() => {
    steps = TOURS[id].steps.map((s) => ({ ...s, target: target(s) })).filter((s) => s.target);
    if (!steps.length) {
      markSeen(id);
      return;
    }
    page = id;
    document.body.classList.add("touring");
    build();
    show(0);
  }, 400);
}

let waiting = null;

/* The tour for what's on screen, the first time, once it's drawn. */
function forPage() {
  const id = pages.active();
  if (!id || root || seen(id) || !TOURS[id]) return;
  clearInterval(waiting);
  let tries = 0;
  waiting = setInterval(() => {
    tries++;
    if (pages.active() !== id || root) return clearInterval(waiting);
    if (tries < 2) return;
    clearInterval(waiting);
    startTour(id);
  }, 500);
}

/** At start-up: a replay asked for by the link, or the page's first tour, unless a link with a
    remote ID opened the page (it came for that, not a tour). */
export function initTours() {
  const params = new URLSearchParams(location.search);
  const asked = params.get("tour");
  if (asked && TOURS[asked]) {
    cameBack = asked === "remote" ? "/" : null;
    history.replaceState(null, "", location.pathname);
    setTimeout(() => {
      if (asked === "remote-panel") {
        document.getElementById("remoteBtn")?.click();
        setTimeout(() => startTour(asked), 400);
      } else {
        startTour(asked);
      }
    }, 900);
    return;
  }
  // Windows opening are pages for the tours too: the Remote control window's, the first time.
  new MutationObserver(() => setTimeout(forPage, 300)).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  if (params.get("id")) return;
  setTimeout(forPage, 1000);
}

/** Settings' Show me around: a button per tour. */
export function tourPickers(container, closeSettings) {
  container.innerHTML = Object.entries(TOURS)
    .map(([id, t]) => `<button class="btn" type="button" data-tour="${id}">${t.label}</button>`)
    .join("");
  container.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tour]");
    if (!btn) return;
    closeSettings();
    setTimeout(() => startTour(btn.dataset.tour), 300);
  });
}

