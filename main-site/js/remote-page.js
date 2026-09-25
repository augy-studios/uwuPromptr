// The remote end. Connects to a prompter by its code and drives it, and
// mirrors back what the prompter is showing so somebody holding the phone
// can see the script and the clock without looking at the screen.

import {
  COLOR_THEMES,
  applyColorTheme,
  applyMode,
  getStoredColorTheme,
  getStoredMode,
  getModePreference,
  initTheme,
} from "./theme.js";
import { hydrateIcons, openModal, closeModal } from "./ui.js";
import { formatElapsed, pixelsPerSecond } from "./prompter.js";
import { RemoteClient, isValidCode, normaliseCode, CODE_LENGTH } from "./remote.js";
import { initUpdateBar } from "./sw-update.js";

const el = (id) => document.getElementById(id);

let client = null;
let lastState = null;

/* ---- theme modal, the same wiring as the prompter page ---- */

function buildThemeModal() {
  const grid = el("swatchGrid");
  grid.innerHTML = COLOR_THEMES.map(
    (t) => `
      <button class="swatch" data-theme-id="${t.id}" style="--swatch-color:${t.hex}" type="button" aria-label="${t.label}">
        <span class="swatch-dot"></span>
        <span class="swatch-label">${t.label}</span>
      </button>`
  ).join("");

  syncThemeModalState();

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme-id]");
    if (!btn) return;
    applyColorTheme(btn.dataset.themeId);
    syncThemeModalState();
  });

  el("modeToggle").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mode]");
    if (!btn) return;
    applyMode(btn.dataset.mode);
    syncThemeModalState();
  });

  document.addEventListener("uwu:modechange", syncThemeModalState);
}

function syncThemeModalState() {
  const activeTheme = getStoredColorTheme();
  const activePreference = getModePreference();
  const resolvedMode = getStoredMode();

  document.querySelectorAll("#swatchGrid .swatch").forEach((element) => {
    element.classList.toggle("active", element.dataset.themeId === activeTheme);
  });
  document.querySelectorAll("#modeToggle .mode-btn").forEach((element) => {
    const isActive = element.dataset.mode === activePreference;
    element.classList.toggle("active", isActive);
    element.setAttribute("aria-pressed", String(isActive));
  });

  const note = el("modeNote");
  if (note) {
    note.hidden = activePreference !== "time";
    if (activePreference === "time") {
      note.textContent = `Following the clock. Currently ${resolvedMode}.`;
    }
  }

  updateThemeButtonIcon();
}

function updateThemeButtonIcon() {
  const span = document.querySelector("#themeBtn [data-icon]");
  if (!span) return;
  span.setAttribute("data-icon", getStoredMode() === "dark" ? "moon" : "sun");
  hydrateIcons(el("themeBtn"));
}

function wireModals() {
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeModal(backdrop.id);
    });
  });

  // Escape closes whatever is open. On a phone there is no Escape key, which
  // is why the backdrop and the X matter more here, but somebody driving the
  // remote from a laptop expects it.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = document.querySelector(".modal-backdrop:not(.hidden)");
    if (open) closeModal(open.id);
  });

  el("themeBtn").addEventListener("click", () => openModal("themeModal"));
}

/**
 * Put away anything covering the controls.
 *
 * Called when the connection goes live: somebody who opened the theme panel
 * while waiting to pair is now looking at a prompter they can drive, and the
 * panel sitting over it is in the way of the thing they came for.
 */
function closeOpenModals() {
  document.querySelectorAll(".modal-backdrop:not(.hidden)").forEach((backdrop) => {
    closeModal(backdrop.id);
  });
}

/* ---- connection ---- */

// What setStatus last reported, so the transition into a live connection can
// be told apart from the repeats that follow it.
let wasLive = false;

function setStatus(status, message) {
  const dot = el("statusDot");
  const text = el("statusText");
  dot.className = "status-dot";

  // The "you were last connected to this ID" note describes the moment the
  // page opened. Once anything has been attempted the status line below says
  // what is actually happening, and the two together would contradict.
  if (status !== "idle") el("connectStatus").hidden = true;

  switch (status) {
    case "connected":
      dot.classList.add("ok");
      text.textContent = "Connected.";
      break;
    case "connecting":
      text.textContent = "Connecting.";
      break;
    // Connected once, then went away. This one really is about the other end:
    // the tab was closed, the panel was stopped, or the connection dropped.
    case "dropped":
      dot.classList.add("warn");
      text.textContent = "Disconnected from the prompter. Connect again to carry on.";
      break;
    // Never opened. Saying the prompter closed the connection here would be a
    // claim about somebody else's device that is very likely untrue.
    case "unreachable":
      dot.classList.add("error");
      // The same-network rule first, because it is the usual reason and the
      // one somebody can act on. Suggesting mobile data here would be advice
      // that makes it worse: two different networks is the failing case.
      text.textContent =
        "Could not reach the prompter. Both devices have to be on the same network, " +
        "so share a mobile hotspot from one to the other if there is no shared wifi. " +
        "Check too that the code is still the one on screen.";
      break;
    case "waiting":
      dot.classList.add("warn");
      text.textContent = "Waiting for the prompter.";
      break;
    case "error":
      dot.classList.add("error");
      text.textContent = message || "The connection failed.";
      break;
    default:
      text.textContent = "Not connected.";
  }

  const live = status === "connected";
  el("controls").hidden = !live;
  el("connectForm").hidden = live;

  // Only on the edge into a live connection, not on every state message: a
  // connected remote that reopens the theme panel should keep it open.
  if (live && !wasLive) {
    closeOpenModals();
    // The form is about to be hidden, but it comes back on any later
    // disconnect and "Reconnect" would then be describing a session that has
    // already been and gone.
    el("connectBtn").textContent = "Connect";
  }
  wasLive = live;
}

async function connect(code) {
  if (!isValidCode(code)) {
    setStatus("error", `A remote ID is ${CODE_LENGTH} characters.`);
    return;
  }

  client?.close();
  client = new RemoteClient();

  client.addEventListener("status", (e) => {
    const { status, message } = e.detail;
    // Anything other than a live connection clears the cover. It describes the
    // far end's editor being open, and a connection that has dropped cannot
    // tell us it closed, so holding the cover would strand this page behind it.
    if (status !== "connected") {
      applyEditingLock(false);
      // The last state may say it was playing, and a copy still scrolling
      // after the connection went would be describing nothing.
      stopMirror();
      stopHold();
    }
    setStatus(status, message);
  });
  client.addEventListener("message", (e) => {
    const message = e.detail;
    if (message.type === "state") applyState(message.payload);
    if (message.type === "script") applyScript(message);
    if (message.type === "editing") applyEditingLock(Boolean(message.open));
    if (message.type === "edit-refused") applyEditRefused(message.reason);
  });

  setStatus("connecting");
  try {
    await client.connect(code);
    // Somebody who connected once should not have to retype the code the
    // next time they pick the phone up.
    localStorage.setItem("uwupromptr.lastRemoteId", code);
  } catch (cause) {
    setStatus("error", "Could not load the remote control library. Check your connection.");
    console.warn("remote client failed:", cause);
  }
}

function send(message) {
  client?.send(message);
}

/* ---- mirroring what the prompter shows ---- */

// When lastState arrived. The prompter sends state twice a second, and a copy
// of its screen that only moved then would step rather than scroll, so the
// scroll and the clock are carried forward from this between updates.
let lastStateAt = 0;

function applyState(state) {
  lastState = state;
  lastStateAt = performance.now();

  const playIcon = document.querySelector("#playBtn [data-icon]");
  playIcon.setAttribute("data-icon", state.playing ? "pause" : "play");
  el("playLabel").textContent = state.playing ? "Pause" : "Play";
  hydrateIcons(el("playBtn"));

  el("fontValue").textContent = state.fontSize;
  el("speedValue").textContent = Number(state.speed).toFixed(1);

  const scrub = el("scrub");
  if (document.activeElement !== scrub) scrub.value = state.progress;

  layoutMirror(state);
  stopMirror();
  drawMirror();
}

/* ---- the prompter's screen, in miniature ----

   Laid out at the prompter's own size and settings, then scaled down whole,
   so it wraps on the same words and the focus arrows point at the same line.
   Scaling only the font would reflow the text into a narrower box and break
   every line somewhere else. */

// How much of this page's height the copy may take. A prompter in portrait
// would otherwise push the controls off the bottom of a phone.
const MIRROR_MAX_HEIGHT = 0.45;

let mirrorFrame = null;

function layoutMirror(state) {
  const view = state?.view;
  const room = el("previewBlock").clientWidth;
  // No geometry from an older prompter, or the block is hidden behind the
  // editor and has no width to fit to. It is laid out again when it returns.
  if (!view?.width || !view?.height || !room) return;

  const scale = Math.min(
    room / view.width,
    (window.innerHeight * MIRROR_MAX_HEIGHT) / view.height
  );

  const mirror = el("preview");
  mirror.style.width = `${view.width * scale}px`;
  mirror.style.height = `${view.height * scale}px`;
  mirror.style.setProperty("--mirror-scale", String(scale));
  mirror.style.setProperty("--focus-position", `${state.focusPosition}%`);
  mirror.classList.toggle("show-focus", Boolean(state.focusLine));
  if (state.look) {
    mirror.dataset.mode = state.look.mode;
    mirror.style.setProperty("--mirror-brand", state.look.brand);
  }

  const screen = el("mirrorScreen").style;
  screen.width = `${view.width}px`;
  screen.height = `${view.height}px`;
  screen.transform = `scale(${scale})`;

  // The same rules Prompter.apply writes onto the real text.
  const text = el("mirrorText").style;
  text.fontSize = `${state.fontSize}px`;
  text.lineHeight = String(state.lineHeight);
  text.paddingLeft = `${state.margin}%`;
  text.paddingRight = `${state.margin}%`;
  text.paddingTop = `${view.padTop}px`;
  text.paddingBottom = `${view.padBottom}px`;
  const scaleX = state.flipX ? -1 : 1;
  const scaleY = state.flipY ? -1 : 1;
  text.transform = scaleX === 1 && scaleY === 1 ? "" : `scale(${scaleX}, ${scaleY})`;

  el("mirrorTimer").classList.toggle("hidden", !state.timer);
}

function relayoutMirror() {
  if (lastState) layoutMirror(lastState);
}

function drawMirror() {
  mirrorFrame = null;
  const state = lastState;
  if (!state) return;

  const since = state.playing ? performance.now() - lastStateAt : 0;

  const view = state.view;
  if (view) {
    // Carried forward at the prompter's own rate, and stopped where it stops:
    // the end of the script.
    const max = Math.max(0, view.scrollHeight - view.height);
    const top = Math.min(max, view.scrollTop + (pixelsPerSecond(state) * since) / 1000);
    el("mirrorScroll").style.transform = `translateY(${-top}px)`;
  }

  const clock = formatElapsed(state.elapsed + since);
  if (el("timer").textContent !== clock) {
    el("timer").textContent = clock;
    el("mirrorTimer").textContent = clock;
  }

  if (state.playing) mirrorFrame = requestAnimationFrame(drawMirror);
}

function stopMirror() {
  if (mirrorFrame) cancelAnimationFrame(mirrorFrame);
  mirrorFrame = null;
}

/* What the prompter last told us the script is, and which revision that was.
   The rev goes back with an edit so the prompter can refuse one that is
   answering a script that has since changed under it. */
let scriptRev = 0;
let editing = false;
// The revision the editor opened on. An edit answers the script it was started
// from, not whatever has arrived since, so this is what goes back on the wire.
// Tracking only `scriptRev` made the check useless: an update landing while
// somebody typed moved the number, and their stale edit then carried a current
// rev and was applied over the newer text.
let editingRev = 0;
// Set when the editor asked to reload: it closed so the answer would not be
// held back, and reopens on the script that comes back.
let reopenOnNextScript = false;

function applyScript(message) {
  scriptRev = Number(message.rev) || 0;
  el("scriptName").textContent = message.name;
  // Always, even mid-edit: it is a copy of the prompter's screen, and the
  // screen has changed whether or not anybody here is typing.
  el("mirrorText").textContent = message.body;

  // Somebody is typing here. Overwriting the field would delete the sentence
  // they are half way through, which is exactly what the rev check exists to
  // prevent in the other direction. The banner says the prompter moved on, and
  // they choose: keep typing, or reload what it actually says.
  //
  // editingRev deliberately stays where it was, so what goes back still
  // answers the script they started from and is refused rather than applied.
  if (editing) {
    el("editStale").hidden = false;
    return;
  }

  el("editName").value = message.name;
  el("editBody").value = message.body;
  el("editStale").hidden = true;

  if (reopenOnNextScript) {
    reopenOnNextScript = false;
    openRemoteEditor();
  }
}

/**
 * The prompter's own editor opened or closed.
 *
 * While it is open this page is covered and takes no input at all. Two people
 * typing into one script is a fight the revision counter can only settle after
 * the fact, by throwing one side's work away; covering the remote stops it
 * starting. The cover is not dismissible, because the condition it describes is
 * not something this end can clear.
 *
 * Anything being typed here when it appears is kept, not discarded: the panel
 * is hidden behind the cover rather than closed, and comes back with the text
 * still in it. Whether it is still worth sending is then a question the rev
 * check answers.
 */
function applyEditingLock(open) {
  el("editingLock").classList.toggle("hidden", !open);
  document.body.classList.toggle("locked", open);
  // A finger already holding + when the cover arrives would keep stepping
  // underneath it.
  if (open) stopHold();

  if (open && editing) {
    // Held rather than sent. Sending on their behalf would be deciding for
    // them which of two people's edits survives.
    el("editStale").hidden = false;
  }
}

function openRemoteEditor({ keepNotice = false } = {}) {
  editing = true;
  editingRev = scriptRev;
  el("editStale").hidden = true;
  if (!keepNotice) el("editRefused").hidden = true;
  el("editPanel").hidden = false;
  // The preview and the field would otherwise sit one above the other showing
  // the same words. It comes back when the editor closes, and stays visible
  // after a refusal, where the two genuinely differ and the difference is the
  // point.
  el("previewBlock").hidden = !keepNotice;
  relayoutMirror();
  el("editBody").focus();
}

function closeRemoteEditor() {
  editing = false;
  el("editStale").hidden = true;
  el("editRefused").hidden = true;
  el("editPanel").hidden = true;
  el("previewBlock").hidden = false;
  relayoutMirror();
}

/* What was sent, kept until the prompter either applies it or refuses it. A
   refusal that dropped the text would lose somebody's work to a race they
   could not see coming. */
let sentEdit = null;

function sendEdit() {
  sentEdit = {
    name: el("editName").value.trim() || "Untitled script",
    body: el("editBody").value,
  };
  send({ type: "edit", ...sentEdit, rev: editingRev });
  closeRemoteEditor();
}

/**
 * The prompter would not take the edit.
 *
 * Either it was answering a script that has since changed, or the editor is
 * open over there. Both mean the same thing here: the text is not lost, the
 * editor comes back with it still in it, and the banner says why. Whether to
 * send it again over whatever the script says now is their call, not ours.
 */
function applyEditRefused(reason) {
  if (!sentEdit) return;

  el("editName").value = sentEdit.name;
  el("editBody").value = sentEdit.body;
  sentEdit = null;

  el("editRefused").textContent =
    reason === "editing"
      ? "Not sent: the script is open in the editor on the prompter. Your text is still here."
      : "Not sent: the script changed on the prompter first. Your text is still here, and the preview above shows what it says now.";
  el("editRefused").hidden = false;

  // Reopened on the revision the script is at now, so sending again is a
  // deliberate overwrite rather than another refusal.
  openRemoteEditor({ keepNotice: true });
}

/* ---- the + and - buttons ----

   A tap is one fine step. Holding is what Shift with an arrow key is on the
   prompter: coarse steps, repeating for as long as the finger stays down,
   the way a held key repeats. There is no Shift on a phone, and a hold is the
   gesture that already means "more of this". */

// Long enough that an ordinary tap never becomes a hold, short enough that a
// hold does not feel ignored.
const HOLD_DELAY_MS = 400;
// Slow enough to stop on the value wanted, since each step is a coarse one.
const HOLD_REPEAT_MS = 200;

let holdTimer = null;

function stopHold() {
  clearTimeout(holdTimer);
  clearInterval(holdTimer);
  holdTimer = null;
}

function wireNudge(btn) {
  const [setting, value] = btn.dataset.nudge.split(":");
  const nudge = (coarse) =>
    send({ type: "command", name: "nudge", setting, value: Number(value), coarse });

  // Set once a hold has stepped, so the click that follows the release does
  // not add a fine step on top.
  let held = false;

  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    held = false;
    stopHold();
    // Kept on this button while the finger is down, so drifting a few pixels
    // off its edge does not end the hold.
    btn.setPointerCapture?.(e.pointerId);
    holdTimer = setTimeout(() => {
      held = true;
      nudge(true);
      holdTimer = setInterval(() => nudge(true), HOLD_REPEAT_MS);
    }, HOLD_DELAY_MS);
  });

  ["pointerup", "pointercancel", "lostpointercapture"].forEach((type) => {
    btn.addEventListener(type, stopHold);
  });

  // Taps, and Enter or Space on a focused button, both arrive here.
  // A keyboard click has detail 0 and is never the end of a hold, even if a
  // hold that ended off the button left the flag set.
  btn.addEventListener("click", (e) => {
    if (held && e.detail !== 0) {
      held = false;
      return;
    }
    nudge(false);
  });

  // A long press on a phone otherwise opens the context menu or a callout
  // over the button, which also cancels the pointer and ends the hold.
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
}

/* ---- wiring ---- */

function wireControls() {
  el("connectBtn").addEventListener("click", () => {
    connect(normaliseCode(el("codeInput").value));
  });

  el("codeInput").addEventListener("input", (e) => {
    e.target.value = normaliseCode(e.target.value);
  });
  el("codeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") el("connectBtn").click();
  });

  // Going to the prompter page is a full navigation: this document, its peer
  // and the data channel all go with it, and coming back lands on a new page
  // with nothing connected. Worth a word first, because the link looks like a
  // tab and behaves like hanging up.
  //
  // The connection is deliberately not closed on the way out. Leaving it to
  // die with the page means no `bye` is sent, so the prompter keeps the code
  // live and the Reconnect button on the way back actually works.
  el("homeLink").addEventListener("click", (e) => {
    if (!wasLive) return;
    if (!confirm("Leave the remote? This disconnects it from the prompter.")) {
      e.preventDefault();
    }
  });

  el("playBtn").addEventListener("click", () => send({ type: "command", name: "toggle" }));
  el("resetBtn").addEventListener("click", () => send({ type: "command", name: "reset" }));
  el("disconnectBtn").addEventListener("click", () => {
    // Before the close, while the channel is still open to carry it. This is
    // what tells the prompter to retire the code: leaving without it means
    // the code stays live, which is right for a reload and wrong for this.
    send({ type: "bye" });
    // Forgotten too, so returning to this page does not offer to reconnect on
    // an id that is about to stop existing.
    localStorage.removeItem("uwupromptr.lastRemoteId");

    client?.close();
    client = null;
    closeRemoteEditor();
    applyEditingLock(false);
    reopenOnNextScript = false;
    setStatus("idle");
  });

  document.querySelectorAll("[data-nudge]").forEach(wireNudge);

  el("scrub").addEventListener("input", (e) => {
    send({ type: "command", name: "seek", value: Number(e.target.value) });
  });

  el("editBtn").addEventListener("click", openRemoteEditor);
  el("editCancel").addEventListener("click", () => {
    closeRemoteEditor();
    // Put back whatever the prompter last sent, including anything that
    // arrived while the editor was open and was held back.
    send({ type: "hello" });
  });
  el("editSend").addEventListener("click", sendEdit);

  // Reload what the prompter actually says now, abandoning what is in the
  // field. Only offered once the banner says the two have diverged.
  //
  // `editing` has to be false when the answer lands or applyScript holds it
  // back as it does any other update, so the editor is reopened when the
  // script arrives rather than straight away.
  el("editReload").addEventListener("click", () => {
    closeRemoteEditor();
    reopenOnNextScript = true;
    send({ type: "hello" });
  });
}

/* ---- boot ---- */

function boot() {
  initTheme();
  hydrateIcons();
  updateThemeButtonIcon();
  buildThemeModal();
  wireModals();
  wireControls();
  setStatus("idle");
  // Turning the phone round changes the room the copy of the screen has.
  window.addEventListener("resize", relayoutMirror);

  // A code in the link, the way the QR on the prompter hands it over, means
  // the phone connects without anybody typing anything.
  const fromUrl = normaliseCode(new URLSearchParams(location.search).get("id") || "");
  const remembered = normaliseCode(localStorage.getItem("uwupromptr.lastRemoteId") || "");
  const code = fromUrl || remembered;

  if (code) el("codeInput").value = code;

  if (fromUrl) {
    connect(fromUrl);
  } else if (isValidCode(remembered)) {
    // Somebody who was connected a moment ago and came back: the page is new,
    // so the old channel went with it, but the code is still theirs. The
    // prompter keeps publishing the same id until it is deliberately retired,
    // so this usually still reaches it.
    //
    // One tap rather than automatic, so a page opened from a bookmark days
    // later does not reach for a prompter that is not running and greet
    // somebody with an error they did not ask for.
    el("connectBtn").textContent = "Reconnect";
    el("connectStatus").textContent = "You were last connected to this ID.";
    el("connectStatus").hidden = false;
    el("connectBtn").focus();
  }

  initUpdateBar();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}

/* Restored from the back/forward cache.
 *
 * The page comes back exactly as it was left, which is the problem: boot never
 * runs again, so a connection that died while the page was frozen is still
 * being described as live. The controls would sit there taking taps that go
 * nowhere. Putting the form back, with the code still in it, makes the state
 * on screen true and the way back one tap. */
window.addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  if (client?.status === "connected") return;

  client?.close();
  client = null;
  setStatus("idle");
  el("connectBtn").textContent = "Reconnect";
  el("connectStatus").textContent = "The connection ended while you were away.";
  el("connectStatus").hidden = false;
});
