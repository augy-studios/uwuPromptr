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
  getStoredHostCode,
  setActiveScriptId,
  setStoredHostCode,
  updateScript,
} from "./storage.js";
import { RemoteHost, generateCode, isValidCode } from "./remote.js";
import { qrToSvg } from "./qr.js";
import { initUpdateBar } from "./sw-update.js";

let prompter = null;
let host = null;
let hostCode = null;
// Stopped with the Stop button rather than never started. Reopening the panel
// then leaves it stopped, because somebody who switched it off did not switch
// it back on by looking at it.
let stoppedByHand = false;

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
  // Rewound but not reset: the clock only goes back to zero from the reset
  // button, never because the script was switched or edited.
  prompter?.stop();
  broadcastScript();
}

/* Switching to a different script, deleting one, or creating one all change
   what the remote is looking at. The counter moves so that an edit already on
   its way, answering the previous script, is refused rather than written over
   whichever script is open now. */
function switchActiveScript(id) {
  setActiveScriptId(id);
  scriptRev += 1;
  loadActiveScript();
}

function wireScripts() {
  el("scriptSwitch").addEventListener("click", () => {
    renderScriptMenu();
    openModal("scriptsModal");
  });

  el("scriptList").addEventListener("click", (e) => {
    const select = e.target.closest("[data-select]");
    if (select) {
      switchActiveScript(select.dataset.select);
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
      scriptRev += 1;
      loadActiveScript();
    }
  });

  el("newScriptBtn").addEventListener("click", () => {
    const script = createScript();
    switchActiveScript(script.id);
    closeModal("scriptsModal");
    openEditor();
  });
}

/* ---- editor ---- */

/* What the script said when the editor opened, and which script that was.
   Cancelling puts this back.

   It has to be captured rather than re-read on the way out, because autosave
   has been writing to storage every 400ms since the first keystroke: by the
   time somebody cancels, what is stored is already their edit. Without a
   snapshot there is nothing left to go back to, and "cancel" can only mean
   "skip the last save", which is not what the word promises. */
let editorSnapshot = null;

/* The pending autosave, at module scope so closing the editor can call it off.

   A keystroke schedules a write 400ms out. Cancelling inside that window used
   to restore the snapshot and then let the timer fire, putting the discarded
   text straight back and undoing the undo. */
let autosaveTimer = null;

function cancelPendingAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
}

function openEditor() {
  const script = getActiveScript();
  editorSnapshot = { id: script.id, name: script.name, body: script.body };
  el("editorName").value = script.name;
  el("editorBody").value = script.body;
  el("editor").classList.remove("hidden");
  prompter.pause();
  el("editorBody").focus();
  // The remote locks itself while this is open. Two people typing into one
  // script is a fight the rev counter can only settle after the fact, by
  // throwing one of them away; this stops it starting.
  broadcastEditing(true);
}

// Whether the fields differ from what the editor opened with. The name is
// compared after the same trimming and fallback that a save applies, so
// trailing whitespace alone is not treated as an edit worth warning about.
function editorHasChanges() {
  if (!editorSnapshot) return false;
  const name = el("editorName").value.trim() || "Untitled script";
  return name !== editorSnapshot.name || el("editorBody").value !== editorSnapshot.body;
}

function closeEditor({ save = true } = {}) {
  // Before either branch writes. Whichever way this editor is closing, the
  // value it decides on is the final one and a queued keystroke must not land
  // on top of it.
  cancelPendingAutosave();

  if (save) {
    const id = getActiveScriptId();
    const name = el("editorName").value.trim() || "Untitled script";
    updateScript(id, { name, body: el("editorBody").value });
    // Anything the remote is part way through editing is now answering an
    // older script than this one.
    scriptRev += 1;
  } else if (editorSnapshot) {
    // Put back what the editor opened with, undoing every autosave it made.
    // Written against the snapshot's own id rather than the active one, so a
    // script that was switched away from underneath is not overwritten with
    // another script's text.
    updateScript(editorSnapshot.id, {
      name: editorSnapshot.name,
      body: editorSnapshot.body,
    });
    scriptRev += 1;
  }

  editorSnapshot = null;
  el("editor").classList.add("hidden");
  broadcastEditing(false);
  loadActiveScript();
}

/**
 * Close without saving, asking first if there is anything to lose.
 *
 * The confirm is skipped when nothing was typed, because an editor opened and
 * closed again should not interrogate somebody about work they did not do.
 */
function cancelEditor() {
  if (editorHasChanges() && !confirm("Discard your changes to this script?")) return;
  closeEditor({ save: false });
}

function wireEditor() {
  el("editBtn").addEventListener("click", openEditor);
  el("editorDone").addEventListener("click", () => closeEditor({ save: true }));
  el("editorCancel").addEventListener("click", cancelEditor);

  // Ctrl+S saves and closes, the same as Done, and Escape cancels. Bound on
  // the editor rather than the document so they only ever mean this while it
  // is open, and so the global handler never sees them.
  //
  // Ctrl+S has to be taken from the browser, whose own Save Page As is not a
  // useful thing to offer somebody writing a script. Escape is left to bubble
  // when the editor is closed, where wireKeyboard resets the prompter with it.
  el("editor").addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      closeEditor({ save: true });
      toast("Script saved");
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      // Stops the global handler seeing this one too, which would reset the
      // prompter behind the editor that just closed.
      e.stopPropagation();
      cancelEditor();
    }
  });

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
  const autosave = () => {
    cancelPendingAutosave();
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      updateScript(getActiveScriptId(), {
        name: el("editorName").value.trim() || "Untitled script",
        body: el("editorBody").value,
      });
      // Each autosave is a new revision, and the remote is shown the text as
      // it stands, so somebody holding the phone watches it being typed.
      bumpScriptRev();
    }, 400);
  };
  el("editorBody").addEventListener("input", autosave);
  el("editorName").addEventListener("input", autosave);
}

/* ---- transport and settings ---- */

function syncToolbar(state) {
  const playIcon = document.querySelector("#playBtn [data-icon]");
  playIcon.setAttribute("data-icon", state.playing ? "pause" : "play");
  // The shortcut stays on the end of the name as the verb flips, so the
  // button does not quietly lose its hint the first time it is pressed.
  const playName = `${state.playing ? "Pause" : "Play"} (Space)`;
  el("playBtn").setAttribute("aria-label", playName);
  el("playBtn").setAttribute("title", playName);
  hydrateIcons(el("playBtn"));

  el("fontValue").innerHTML = `Font <span>${state.fontSize}</span>`;
  el("speedValue").innerHTML = `Speed <span>${state.speed.toFixed(1)}</span>`;

  el("timer").classList.toggle("hidden", !state.timer);
  document.body.classList.toggle("chrome-hidden", state.playing && !chromeWake);

  syncSettingsModal(state);
  broadcastState(state);
}

// How many decimals a setting shows. Speed reads as 12.0 and line height as
// 1.40; everything else is a whole number. One definition, so the readout
// above a slider and the label on its reset button cannot disagree.
function formatSetting(name, value) {
  if (name === "speed") return Number(value).toFixed(1);
  if (name === "lineHeight") return Number(value).toFixed(2);
  return String(value);
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
    if (output) output.textContent = formatSetting(name, state[name]);
  }

  // A reset button with nothing to undo is disabled rather than hidden.
  document.querySelectorAll("[data-reset]").forEach((btn) => {
    btn.disabled = prompter.isDefault(btn.dataset.reset);
  });

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

  // The labels name the value they restore, which means they have to come
  // from SETTING_RANGES rather than the markup: a default changed in one
  // place and not the other is a button that lies about what it does.
  document.querySelectorAll("[data-reset]").forEach((btn) => {
    const name = btn.dataset.reset;
    const range = SETTING_RANGES[name];
    if (range) {
      const label = document.querySelector(`label[for="${name}Range"]`);
      const what = label ? label.firstChild.textContent.trim().toLowerCase() : name;
      const value = formatSetting(name, range.default);
      btn.setAttribute("aria-label", `Reset ${what} to ${value}`);
      btn.setAttribute("title", `Reset to ${value}`);
    }
  });

  document.querySelectorAll("[data-reset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.reset;
      prompter.resetSetting(name);
      // The slider keeps focus after a click in some browsers, and
      // syncSettingsModal deliberately leaves the focused control alone so it
      // does not fight a drag. Write it back here so the thumb actually moves.
      const range = document.querySelector(`[data-range="${name}"]`);
      if (range) range.value = prompter.get(name);
      syncSettingsModal(prompter.state());
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

/**
 * Which modal shortcut a keypress is, if any.
 *
 * Ctrl+E and Ctrl+P take keys the browser also wants (print, in Chrome's
 * case), which is the trade being made deliberately: somebody in a prompter
 * reaching for Ctrl+P wants the settings, not a paper copy of their script.
 * Alt carries the two where that trade would be a bad one.
 */
function modalShortcut(e) {
  const key = e.key.toLowerCase();

  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    if (key === "e") return "editor";
    if (key === "p") return "settingsModal";
    return null;
  }

  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    if (key === "r") return "remoteModal";
    if (key === "t") return "themeModal";
  }

  return null;
}

/**
 * Open what the shortcut names, or close it if it is already open.
 *
 * Pressing the same combination twice putting the panel away is what a single
 * key for a panel is expected to do, and it means every one of these has a way
 * out that does not need the mouse or a second shortcut.
 */
function toggleModalShortcut(target) {
  // The editor is not a modal: it is a section of the stage with its own
  // open and close, and its Escape already cancels.
  if (target === "editor") {
    if (el("editor").classList.contains("hidden")) openEditor();
    else closeEditor({ save: true });
    return;
  }

  if (!document.getElementById(target).classList.contains("hidden")) {
    closeModal(target);
    return;
  }

  // Anything else open first, so two panels never stack.
  document.querySelectorAll(".modal-backdrop:not(.hidden)").forEach((m) => closeModal(m.id));

  // The remote panel starts the host when it opens, exactly as the button
  // does. Going straight to openModal would show a dead panel with no code.
  if (target === "remoteModal") {
    openRemotePanel();
    return;
  }

  openModal(target);
}

function wireKeyboard() {
  document.addEventListener("keydown", (e) => {
    // Never steal a key from the editor or a text field. The editor binds its
    // own Ctrl+S and Escape and stops them here, so this handler does not have
    // to know about it; any other field keeps every key it is sent.
    const tag = e.target.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT") return;

    // The modal shortcuts, which carry a modifier so they cannot collide with
    // the single letters below. Ctrl and Meta are both accepted so the same
    // keys work on a Mac without a second set of hints to explain which.
    //
    // Alt is used for the two that Ctrl cannot have: Ctrl+R is reload and
    // Ctrl+T is a new tab, and taking either from the browser is a worse
    // trade than the shortcut is worth.
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const combo = modalShortcut(e);
      if (!combo) return;
      e.preventDefault();
      toggleModalShortcut(combo);
      wakeChrome();
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
        // Whatever is open, or the scroll position when nothing is. Only the
        // position: the script itself is untouched, so there is nothing here
        // that would need an undo.
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
  if (!dot || !text) {
    // The panel is not in this document, but the button on the bar may still
    // be, and the light on it is the part that shows while the panel is shut.
    syncRemoteBadge(status, message || "");
    return;
  }

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

  syncRemoteBadge(status, text.textContent);
}

/**
 * The light on the corner of the topbar's remote button.
 *
 * Grey for not running, yellow for running but unpaired, green for a remote
 * connected. It is the one piece of the remote panel worth seeing while the
 * panel is shut, because "is the phone still holding this" is the question
 * somebody has mid-read, when opening a modal over the script is the last
 * thing they want to do.
 *
 * The sentence the panel would have shown goes on the button's name too. A
 * colour on its own is not readable by everybody, and it is the only thing
 * this dot is.
 */
function syncRemoteBadge(status, description) {
  const badge = el("remoteBtnDot");
  if (!badge) return;

  const state =
    status === "connected" ? "connected"
    : status === "waiting" || status === "connecting" ? "waiting"
    : status === "error" ? "error"
    : "";

  badge.className = `btn-status-dot${state ? ` ${state}` : ""}`;

  const label = `Remote control (Alt+R). ${description}`;
  el("remoteBtn").setAttribute("aria-label", label);
  el("remoteBtn").setAttribute("title", label);
}

async function startRemote() {
  if (host) return;

  // The same code this prompter published last time, so a remote that was
  // paired before can come back on the id it was given. A fresh one is minted
  // only when there is nothing to reuse, or when the last one was retired.
  const stored = getStoredHostCode();
  hostCode = isValidCode(stored) ? stored : generateCode();
  setStoredHostCode(hostCode);

  el("remoteCode").textContent = hostCode;
  el("remoteUrl").textContent = remoteUrl(hostCode);
  el("qrHolder").innerHTML = qrToSvg(remoteUrl(hostCode));

  host = new RemoteHost();
  host.addEventListener("status", (e) => {
    const { status, message, taken } = e.detail;

    // The stored code is spoken for, so it is not this prompter's to publish.
    // Swapping to a fresh one is better than showing an error about a code
    // nobody chose; the remote is told the new one the usual way, by being
    // read off the screen.
    if (taken) {
      recoverFromTakenCode();
      return;
    }

    setRemoteStatus(status, message);
    if (status === "connected") {
      broadcastScript();
      broadcastState(prompter.state());
    }
  });
  host.addEventListener("message", (e) => handleRemoteMessage(e.detail));

  setRemoteStatus("connecting");
  syncRemoteControls();

  try {
    await host.start(hostCode);
  } catch (cause) {
    host = null;
    setRemoteStatus("error", "Could not load the remote control library. Check your connection.");
    console.warn("remote host failed to start:", cause);
  }

  // After either outcome, since a failed start leaves nothing running and the
  // panel should offer Start rather than Stop.
  syncRemoteControls();
}

function stopRemote() {
  host?.close();
  host = null;
  hostCode = null;
  setRemoteStatus("idle");
  el("remoteCode").textContent = "------";
  el("remoteUrl").textContent = "";
  el("qrHolder").innerHTML = "";
  syncRemoteControls();
}

/**
 * Which of the remote panel's controls apply right now.
 *
 * Stopped, the only thing on offer is Start; running, everything else is. The
 * alternative is a Stop button that leaves the panel dead with no way back
 * short of reloading the page, which is what this used to do.
 */
function syncRemoteControls() {
  const running = Boolean(host);
  el("remoteStart").hidden = running;
  el("remoteStop").hidden = !running;
  el("remoteCopy").disabled = !running;
  el("remoteNewCode").disabled = !running;
}

/**
 * Give up the current code and publish a new one.
 *
 * For when a code has been shown to a room, or somebody unwanted has it: the
 * old one stops working immediately, because the peer holding it is destroyed.
 * Any connected remote is dropped, which is the point.
 */
async function regenerateRemoteCode() {
  host?.close();
  host = null;
  hostCode = null;
  // Cleared, or startRemote would reuse the very code being given up.
  setStoredHostCode("");
  await startRemote();
  toast("New remote ID");
}

/* Guards the teardown below against itself. Closing a peer makes it report a
   status, and the drop that started all this is still being handled when it
   does, so without this a single disconnect would start two replacements and
   the second would publish a code nothing had been told about. */
let retiringRemoteCode = false;

/**
 * The stored code is already in use, so publish a different one.
 *
 * Only ever once per start. A second collision is not another stale code from
 * a previous session, it is something systematically wrong, and retrying in a
 * loop would hammer the broker while showing nothing useful; the error the
 * panel would otherwise have shown is the right outcome then.
 */
let recoveringTakenCode = false;

async function recoverFromTakenCode() {
  if (recoveringTakenCode) {
    setRemoteStatus("error", "That code is already in use. Generate a new one.");
    return;
  }
  recoveringTakenCode = true;

  host?.close();
  host = null;
  hostCode = null;
  setStoredHostCode("");

  try {
    await startRemote();
  } finally {
    recoveringTakenCode = false;
  }
}

/**
 * A remote said it was finished, so the code it used is spent.
 *
 * Leaving it live would mean the code shown to a room during one session still
 * reaches this prompter during the next one: anybody who noted it down keeps
 * control of the script long after they left. A code that dies when its remote
 * signs off is one somebody has to be handed again.
 *
 * Only a `bye` gets here. This used to fire on any dropped channel, which read
 * as the same event but is not: a remote whose page was reloaded, whose phone
 * locked, or that went to the home page and came back had its code retired
 * underneath it and could not return on the ID it was given.
 */
async function retireRemoteCode() {
  if (retiringRemoteCode || !host) return;
  retiringRemoteCode = true;

  try {
    host.close();
    host = null;
    hostCode = null;
    // As in regenerateRemoteCode: the stored code is the thing being retired,
    // so it has to go before a new one is published.
    setStoredHostCode("");
    await startRemote();
    toast("Remote disconnected. New ID.");
  } finally {
    retiringRemoteCode = false;
  }
}

function handleRemoteMessage(message) {
  // The remote is finished, rather than merely gone. Only this retires the
  // code; a channel that simply closed is left alone, because the remote may
  // be coming back and the code is how it gets here.
  if (message.type === "bye") {
    retireRemoteCode();
    return;
  }

  if (message.type === "hello") {
    broadcastScript();
    broadcastState(prompter.state());
    // A remote that connects while the editor is open has to arrive locked,
    // not find out at the next keystroke.
    host?.send({ type: "editing", open: editingHere });
    return;
  }

  if (message.type === "edit") {
    applyRemoteEdit(message);
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
  if (!host) return;
  // The colours this screen is in, so the remote's copy of it matches this
  // device rather than whatever theme the phone happens to be set to.
  const theme = COLOR_THEMES.find((t) => t.id === getStoredColorTheme()) || COLOR_THEMES[0];
  const look = {
    mode: document.documentElement.getAttribute("data-mode") === "dark" ? "dark" : "light",
    brand: theme.hex,
  };
  host.send({ type: "state", payload: { ...state, look } });
}

/* The revision counter behind the `edit` message. It counts changes made on
   this prompter for as long as the page is open, which is all it has to do:
   the remote only ever compares it against the number it was last sent, so it
   needs to be unequal after a change rather than meaningful on its own. It is
   deliberately not stored, because a counter that survives a reload would have
   to agree with one on a device that reloaded separately. */
let scriptRev = 0;

function bumpScriptRev() {
  scriptRev += 1;
  broadcastScript();
}

function broadcastScript() {
  const script = getActiveScript();
  host?.send({ type: "script", name: script.name, body: script.body, rev: scriptRev });
}

/* Whether the editor is open on this device. The remote covers itself while it
   is, so the two ends cannot be typing into one script at once. Tracked rather
   than read from the DOM at send time, because a remote that connects midway
   through an edit has to be told on arrival. */
let editingHere = false;

function broadcastEditing(open) {
  editingHere = open;
  host?.send({ type: "editing", open });
}

/**
 * A script rewritten on the remote.
 *
 * Refused when it is answering a version of the script that has since changed
 * here, which is the case where applying it would silently throw away whatever
 * was typed on the prompter in the meantime. The remote is sent what the script
 * actually says now, and redraws.
 */
function applyRemoteEdit(message) {
  // The editor is open here. The remote is covered while that is true, so this
  // is an edit that was already in flight when it opened; applying it would
  // overwrite a script somebody is looking at mid-sentence.
  // The script goes first in both refusals below, so the remote has the current
  // text and revision before it is told the edit bounced. The other order has
  // it reopen its editor on the revision it just failed against, and the next
  // send is refused for the same reason.
  if (editingHere) {
    broadcastScript();
    host?.send({ type: "edit-refused", reason: "editing" });
    host?.send({ type: "editing", open: true });
    return;
  }

  if (Number(message.rev) !== scriptRev) {
    // Answering a script that has since changed. Applying it would throw away
    // whatever was typed here in the meantime, so it is refused and the remote
    // is told what the script actually says now.
    broadcastScript();
    host?.send({ type: "edit-refused", reason: "stale" });
    return;
  }

  const name = String(message.name ?? "").trim() || "Untitled script";
  const body = String(message.body ?? "");

  updateScript(getActiveScriptId(), { name, body });
  scriptRev += 1;

  // The editor is open on this device and holds the same script. Leaving it
  // alone would mean closing it writes the old text back over the edit.
  if (!el("editor").classList.contains("hidden")) {
    el("editorName").value = name;
    el("editorBody").value = body;
  }

  // loadActiveScript rewinds the prompter to the top, which is right: the text
  // under the reader just changed, so the position they were at no longer
  // refers to the same words.
  loadActiveScript();
}

/* Opening the remote panel, from the button or the shortcut. Starts the host
   unless it was deliberately stopped: reopening the panel is not a request to
   undo that, and the Start button is right there. */
function openRemotePanel() {
  openModal("remoteModal");
  if (!stoppedByHand) startRemote();
  syncRemoteControls();
}

function wireRemote() {
  el("remoteBtn").addEventListener("click", openRemotePanel);

  el("remoteStop").addEventListener("click", () => {
    stoppedByHand = true;
    stopRemote();
  });

  el("remoteStart").addEventListener("click", () => {
    stoppedByHand = false;
    startRemote();
  });

  el("remoteNewCode").addEventListener("click", regenerateRemoteCode);
  // The code itself, rather than the link the button beside it copies. Typing
  // six characters into another device is the common case, and reading them
  // off a screen to do it is where they get mistyped.
  el("remoteCode").addEventListener("click", async () => {
    if (!hostCode) return;
    try {
      await navigator.clipboard.writeText(hostCode);
      toast("Remote ID copied");
    } catch {
      toast("Could not copy. The ID is on screen to type.");
    }
  });

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
  // The resting state, so the button's name matches its grey light from the
  // start rather than only after the remote has been opened once.
  setRemoteStatus("idle");

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
