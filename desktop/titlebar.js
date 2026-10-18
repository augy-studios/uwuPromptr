// The title bar's buttons, and its colour following the site's.

const root = document.documentElement;
const mac = window.bar.platform === "darwin";
root.classList.add(`os-${window.bar.platform}`);

// The shortcuts in the names are the Mac's on a Mac.
if (mac) {
  document.getElementById("back").title = "Back (⌘[)";
  document.getElementById("reload").title = "Reload (⌘R)";
}

for (const button of document.querySelectorAll("[data-act]")) {
  button.addEventListener("click", () => window.bar.act(button.dataset.act));
}

/** Relative luminance of #rrggbb, 0 (black) to 1 (white). */
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const linear = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear((n >> 16) & 255) + 0.7152 * linear((n >> 8) & 255) + 0.0722 * linear(n & 255);
}

window.bar.onState((state) => {
  if (/^#[0-9a-f]{6}$/i.test(state.color)) {
    root.style.setProperty("--bg", state.color);
    root.classList.toggle("dark", luminance(state.color) < 0.4);
  }
  root.classList.toggle("full", state.fullScreen);
  root.classList.toggle("maximized", state.maximized);
  document.body.classList.toggle("loading", state.loading);

  document.getElementById("back").disabled = !state.canGoBack;
  document.getElementById("where").textContent = state.where ? ` · ${state.where}` : "";

  const max = document.getElementById("max");
  max.title = state.maximized ? "Restore" : "Maximise";
  max.setAttribute("aria-label", max.title);

  const update = document.getElementById("update");
  update.hidden = !state.update;
  if (state.update) {
    update.title = `Restart to update to ${state.update}`;
    update.setAttribute("aria-label", update.title);
  }
});
