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
import { formatElapsed } from "./prompter.js";
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
  el("themeBtn").addEventListener("click", () => openModal("themeModal"));
}

/* ---- connection ---- */

function setStatus(status, message) {
  const dot = el("statusDot");
  const text = el("statusText");
  dot.className = "status-dot";

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
      text.textContent =
        "Could not reach the prompter. Check the code is still the one on screen, " +
        "and that both devices have internet. Some networks block the direct " +
        "connection this needs, so trying one of them on mobile data often works.";
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
    if (status !== "connected") applyEditingLock(false);
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

function applyState(state) {
  lastState = state;

  const playIcon = document.querySelector("#playBtn [data-icon]");
  playIcon.setAttribute("data-icon", state.playing ? "pause" : "play");
  el("playLabel").textContent = state.playing ? "Pause" : "Play";
  hydrateIcons(el("playBtn"));

  el("timer").textContent = formatElapsed(state.elapsed);
  el("fontValue").textContent = state.fontSize;
  el("speedValue").textContent = Number(state.speed).toFixed(1);

  const scrub = el("scrub");
  if (document.activeElement !== scrub) scrub.value = state.progress;
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
  el("preview").textContent = message.body;
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
  el("editBody").focus();
}

function closeRemoteEditor() {
  editing = false;
  el("editStale").hidden = true;
  el("editRefused").hidden = true;
  el("editPanel").hidden = true;
  el("previewBlock").hidden = false;
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

  el("playBtn").addEventListener("click", () => send({ type: "command", name: "toggle" }));
  el("resetBtn").addEventListener("click", () => send({ type: "command", name: "reset" }));
  el("disconnectBtn").addEventListener("click", () => {
    client?.close();
    client = null;
    closeRemoteEditor();
    applyEditingLock(false);
    reopenOnNextScript = false;
    setStatus("idle");
  });

  document.querySelectorAll("[data-nudge]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [setting, value] = btn.dataset.nudge.split(":");
      send({ type: "command", name: "nudge", setting, value: Number(value) });
    });
  });

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

  // A code in the link, the way the QR on the prompter hands it over, means
  // the phone connects without anybody typing anything.
  const fromUrl = normaliseCode(new URLSearchParams(location.search).get("id") || "");
  const remembered = normaliseCode(localStorage.getItem("uwupromptr.lastRemoteId") || "");
  const code = fromUrl || remembered;

  if (code) el("codeInput").value = code;
  if (fromUrl) connect(fromUrl);

  initUpdateBar();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
