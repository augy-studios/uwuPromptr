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
    case "waiting":
      dot.classList.add("warn");
      text.textContent = "The prompter closed the connection.";
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
    setStatus(status, message);
  });
  client.addEventListener("message", (e) => {
    const message = e.detail;
    if (message.type === "state") applyState(message.payload);
    if (message.type === "script") applyScript(message);
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

function applyScript(message) {
  el("scriptName").textContent = message.name;
  el("preview").textContent = message.body;
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
