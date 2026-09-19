import {
  COLOR_THEMES,
  applyColorTheme,
  applyMode,
  getStoredColorTheme,
  getStoredMode,
  getModePreference,
  initTheme,
} from "./theme.js";
import { hydrateIcons, openModal, closeModal, escapeHtml, toast } from "./ui.js";
import { Prompter, formatElapsed, cleanPastedText } from "./prompter.js";
import {
  SETTING_RANGES,
  createScript,
  deleteScript,
  getActiveScript,
  getActiveScriptId,
  getScripts,
  setActiveScriptId,
  updateScript,
} from "./storage.js";
import { RemoteHost, generateCode } from "./remote.js";
import { qrToSvg } from "./qr.js";
import { initUpdateBar } from "./sw-update.js";

let prompter = null;
let host = null;
let hostCode = null;

const el = (id) => document.getElementById(id);

/* ---- theme modal (uwuapps-theme.md section 6) ---- */

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

  // A tab left open across 09:00 or 18:00 re-resolves itself; redraw the
  // modal so the note and pressed state stay in step with the change.
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

/* ---- scripts ---- */

function renderScriptMenu() {
  const scripts = getScripts();
  const activeId = getActiveScriptId();

  el("scriptList").innerHTML = scripts
    .map((script) => {
      const preview = script.body.trim().split("\n")[0] || "Empty";
      const words = script.body.trim() ? script.body.trim().split(/\s+/).length : 0;
      return `
        <div class="script-row ${script.id === activeId ? "active" : ""}">
          <button class="row-main" type="button" data-select="${script.id}">
            <span class="row-title">${escapeHtml(script.name)}</span>
            <span class="row-meta">${words} words, ${escapeHtml(preview.slice(0, 40))}</span>
          </button>
          <button class="icon-btn small" type="button" data-delete="${script.id}" aria-label="Delete ${escapeHtml(script.name)}">
            <span data-icon="trash"></span>
          </button>
        </div>`;
    })
    .join("");

  hydrateIcons(el("scriptList"));
}

function loadActiveScript() {
  const script = getActiveScript();
  el("scriptText").textContent = script.body;
  el("currentScriptName").textContent = script.name;
  prompter?.reset();
  broadcastScript();
}

function wireScripts() {
  el("scriptSwitch").addEventListener("click", () => {
    renderScriptMenu();
    openModal("scriptsModal");
  });

  el("scriptList").addEventListener("click", (e) => {
    const select = e.target.closest("[data-select]");
    if (select) {
      setActiveScriptId(select.dataset.select);
      loadActiveScript();
      closeModal("scriptsModal");
      return;
    }

    const remove = e.target.closest("[data-delete]");
    if (remove) {
      const script = getScripts().find((s) => s.id === remove.dataset.delete);
      // Deleting a script is not undoable, so it asks. Everything else in
      // this app is recoverable by retyping; this is not.
      if (!confirm(`Delete "${script?.name ?? "this script"}"? This cannot be undone.`)) return;
      deleteScript(remove.dataset.delete);
      renderScriptMenu();
      loadActiveScript();
    }
  });

  el("newScriptBtn").addEventListener("click", () => {
    const script = createScript();
    setActiveScriptId(script.id);
    loadActiveScript();
    closeModal("scriptsModal");
    openEditor();
  });
}

/* ---- editor ---- */

function openEditor() {
  const script = getActiveScript();
  el("editorName").value = script.name;
  el("editorBody").value = script.body;
  el("editor").classList.remove("hidden");
  prompter.pause();
  el("editorBody").focus();
}

function closeEditor({ save = true } = {}) {
  if (save) {
    const id = getActiveScriptId();
    const name = el("editorName").value.trim() || "Untitled script";
    updateScript(id, { name, body: el("editorBody").value });
  }
  el("editor").classList.add("hidden");
  loadActiveScript();
}

function wireEditor() {
  el("editBtn").addEventListener("click", openEditor);
  el("editorDone").addEventListener("click", () => closeEditor({ save: true }));
  el("editorCancel").addEventListener("click", () => closeEditor({ save: false }));

  // Text out of a word processor arrives with smart quotes and hard breaks
  // mid-sentence, which read badly at 60px.
  el("editorBody").addEventListener("paste", (e) => {
    const raw = e.clipboardData?.getData("text/plain");
    if (!raw) return;
    e.preventDefault();
    const field = el("editorBody");
    const clean = cleanPastedText(raw);
    const { selectionStart: start, selectionEnd: end, value } = field;
    field.value = value.slice(0, start) + clean + value.slice(end);
    field.selectionStart = field.selectionEnd = start + clean.length;
  });

  // Saved as they type, so closing the tab mid-sentence loses nothing.
  let saveTimer = null;
  const autosave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      updateScript(getActiveScriptId(), {
        name: el("editorName").value.trim() || "Untitled script",
        body: el("editorBody").value,
      });
    }, 400);
  };
  el("editorBody").addEventListener("input", autosave);
  el("editorName").addEventListener("input", autosave);
}

/* ---- transport and settings ---- */

function syncToolbar(state) {
  const playIcon = document.querySelector("#playBtn [data-icon]");
  playIcon.setAttribute("data-icon", state.playing ? "pause" : "play");
  el("playBtn").setAttribute("aria-label", state.playing ? "Pause" : "Play");
  hydrateIcons(el("playBtn"));

  el("fontValue").innerHTML = `Font <span>${state.fontSize}</span>`;
  el("speedValue").innerHTML = `Speed <span>${state.speed.toFixed(1)}</span>`;

  el("timer").classList.toggle("hidden", !state.timer);
  document.body.classList.toggle("chrome-hidden", state.playing && !chromeWake);

  syncSettingsModal(state);
  broadcastState(state);
}

function syncSettingsModal(state) {
  const pairs = {
    fontSizeRange: "fontSize",
    speedRange: "speed",
    lineHeightRange: "lineHeight",
    marginRange: "margin",
    focusPositionRange: "focusPosition",
  };

  for (const [rangeId, name] of Object.entries(pairs)) {
    const range = el(rangeId);
    if (!range) continue;
    // Do not fight the slider the person is currently dragging.
    if (document.activeElement !== range) range.value = state[name];
    const output = el(`${rangeId}Out`);
    if (output) {
      output.textContent =
        name === "speed" || name === "lineHeight"
          ? Number(state[name]).toFixed(name === "speed" ? 1 : 2)
          : state[name];
    }
  }

  for (const name of ["flipX", "flipY", "focusLine", "timer"]) {
    const btn = document.querySelector(`[data-toggle="${name}"]`);
    if (!btn) continue;
    btn.classList.toggle("active", Boolean(state[name]));
    btn.setAttribute("aria-pressed", String(Boolean(state[name])));
  }
}

function wireTransport() {
  el("playBtn").addEventListener("click", () => prompter.toggle());
  el("resetBtn").addEventListener("click", () => prompter.reset());

  document.querySelectorAll("[data-nudge]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [name, direction] = btn.dataset.nudge.split(":");
      prompter.nudge(name, Number(direction), false);
    });
  });

  el("settingsBtn").addEventListener("click", () => {
    syncSettingsModal(prompter.state());
    openModal("settingsModal");
  });
  el("fontValue").addEventListener("click", () => el("settingsBtn").click());
  el("speedValue").addEventListener("click", () => el("settingsBtn").click());

  document.querySelectorAll("[data-range]").forEach((range) => {
    range.addEventListener("input", () => {
      prompter.set(range.dataset.range, Number(range.value));
    });
  });

  document.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.toggle;
      prompter.set(name, !prompter.get(name));
    });
  });

  el("fullscreenBtn").addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", () => {
    const span = document.querySelector("#fullscreenBtn [data-icon]");
    span.setAttribute("data-icon", document.fullscreenElement ? "exitFullscreen" : "fullscreen");
    hydrateIcons(el("fullscreenBtn"));
  });
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    // Refused, or unsupported on this browser. Not worth a message: the
    // prompter is unchanged either way.
    document.documentElement.requestFullscreen?.().catch(() => {});
  }
}

/* ---- chrome hiding ---- */

// The bars get out of the way while the script is moving, and come back on
// any pointer movement or key press.
let chromeWake = false;
let chromeTimer = null;

function wakeChrome() {
  chromeWake = true;
  document.body.classList.remove("chrome-hidden");
  if (chromeTimer) clearTimeout(chromeTimer);
  chromeTimer = setTimeout(() => {
    chromeWake = false;
    if (prompter?.playing && !document.querySelector(".modal-backdrop:not(.hidden)")) {
      document.body.classList.add("chrome-hidden");
    }
  }, 2500);
}

/* ---- keyboard ---- */

function wireKeyboard() {
  document.addEventListener("keydown", (e) => {
    // Never steal a key from the editor or a text field.
    const tag = e.target.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT") {
      if (e.key === "Escape") closeEditor({ save: true });
      return;
    }

    const coarse = e.shiftKey;

    switch (e.key) {
      case " ":
      case "b":
      case "B":
      case ".":
        e.preventDefault();
        prompter.toggle();
        break;
      case "ArrowUp":
        e.preventDefault();
        prompter.nudge("fontSize", 1, coarse);
        break;
      case "ArrowDown":
        e.preventDefault();
        prompter.nudge("fontSize", -1, coarse);
        break;
      case "ArrowRight":
      case "PageDown":
        e.preventDefault();
        prompter.nudge("speed", 1, coarse);
        break;
      case "ArrowLeft":
      case "PageUp":
        e.preventDefault();
        prompter.nudge("speed", -1, coarse);
        break;
      case "Escape":
        e.preventDefault();
        if (document.querySelector(".modal-backdrop:not(.hidden)")) {
          document.querySelectorAll(".modal-backdrop:not(.hidden)").forEach((m) => closeModal(m.id));
        } else {
          prompter.reset();
        }
        break;
      case "f":
      case "F":
        toggleFullscreen();
        break;
      default:
        return;
    }

    wakeChrome();
  });

  document.addEventListener("mousemove", wakeChrome, { passive: true });
  document.addEventListener("touchstart", wakeChrome, { passive: true });
}

/* ---- remote ---- */

function remoteUrl(code) {
  return `${location.origin}/remote?id=${code}`;
}

function setRemoteStatus(status, message) {
  const dot = el("remoteDot");
  const text = el("remoteStatusText");
  if (!dot || !text) return;

  dot.className = "status-dot";
  switch (status) {
    case "connected":
      dot.classList.add("ok");
      text.textContent = "A remote is connected.";
      break;
    case "waiting":
      dot.classList.add("warn");
      text.textContent = "Waiting for a remote to connect.";
      break;
    case "connecting":
      text.textContent = "Opening the pairing channel.";
      break;
    case "error":
      dot.classList.add("error");
      text.textContent = message || "The remote connection failed.";
      break;
    default:
      text.textContent = "The remote is not running.";
  }
}

async function startRemote() {
  if (host) return;

  hostCode = generateCode();
  el("remoteCode").textContent = hostCode;
  el("remoteUrl").textContent = remoteUrl(hostCode);
  el("qrHolder").innerHTML = qrToSvg(remoteUrl(hostCode));

  host = new RemoteHost();
  host.addEventListener("status", (e) => {
    const { status, message } = e.detail;
    setRemoteStatus(status, message);
    if (status === "connected") {
      broadcastScript();
      broadcastState(prompter.state());
    }
  });
  host.addEventListener("message", (e) => handleRemoteMessage(e.detail));

  setRemoteStatus("connecting");
  try {
    await host.start(hostCode);
  } catch (cause) {
    host = null;
    setRemoteStatus("error", "Could not load the remote control library. Check your connection.");
    console.warn("remote host failed to start:", cause);
  }
}

function stopRemote() {
  host?.close();
  host = null;
  hostCode = null;
  setRemoteStatus("idle");
  el("remoteCode").textContent = "------";
  el("remoteUrl").textContent = "";
  el("qrHolder").innerHTML = "";
}

function handleRemoteMessage(message) {
  if (message.type === "hello") {
    broadcastScript();
    broadcastState(prompter.state());
    return;
  }

  if (message.type !== "command") return;

  switch (message.name) {
    case "play": prompter.play(); break;
    case "pause": prompter.pause(); break;
    case "toggle": prompter.toggle(); break;
    case "reset": prompter.reset(); break;
    case "seek": prompter.seek(Number(message.value)); break;
    case "set":
      if (message.setting in SETTING_RANGES || typeof message.value === "boolean") {
        prompter.set(message.setting, message.value);
      }
      break;
    case "nudge":
      prompter.nudge(message.setting, Number(message.value), Boolean(message.coarse));
      break;
    default:
      break;
  }
}

function broadcastState(state) {
  host?.send({ type: "state", payload: state });
}

function broadcastScript() {
  const script = getActiveScript();
  host?.send({ type: "script", name: script.name, body: script.body });
}

function wireRemote() {
  el("remoteBtn").addEventListener("click", () => {
    openModal("remoteModal");
    startRemote();
  });
  el("remoteStop").addEventListener("click", stopRemote);
  el("remoteCopy").addEventListener("click", async () => {
    if (!hostCode) return;
    try {
      await navigator.clipboard.writeText(remoteUrl(hostCode));
      toast("Link copied");
    } catch {
      toast("Could not copy. The link is on screen to type.");
    }
  });
}

/* ---- boot ---- */

function boot() {
  initTheme();
  hydrateIcons();
  updateThemeButtonIcon();
  buildThemeModal();
  wireModals();

  prompter = new Prompter({
    viewport: el("viewport"),
    text: el("scriptText"),
    stage: document.querySelector(".stage"),
    onChange: syncToolbar,
  });

  wireScripts();
  wireEditor();
  wireTransport();
  wireKeyboard();
  wireRemote();

  loadActiveScript();
  syncToolbar(prompter.state());

  // The clock, and the progress the remote shows. One interval rather than
  // a repaint per animation frame: the timer only changes once a second.
  setInterval(() => {
    const state = prompter.state();
    el("timer").textContent = formatElapsed(state.elapsed);
    if (host) broadcastState(state);
  }, 500);

  initUpdateBar();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
