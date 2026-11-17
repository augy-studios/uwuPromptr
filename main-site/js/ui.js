// Small helpers shared by every page: drawing icons into the markup, opening
// and closing modals, escaping text for HTML, and the short "toast" message.

import { icon } from "./icons.js";

// Fills every element that has a data-icon attribute with that icon's SVG.
// Safe to call repeatedly; re-renders when data-icon changes.
export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((element) => {
    const name = element.dataset.icon;
    if (element.dataset.iconRendered === name) {
      return;
    }
    element.innerHTML = icon(name);
    element.dataset.iconRendered = name;
  });
}

// Shows the modal with this id, and marks the page as having a modal open.
export function openModal(id) {
  document.getElementById(id).classList.remove("hidden");
  document.body.classList.add("modal-open");
}

// Hides the modal with this id. The page only stops being "modal open" once
// no other modal is still showing.
export function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
  if (!document.querySelector(".modal-backdrop:not(.hidden)")) {
    document.body.classList.remove("modal-open");
  }
}

// Turns any value into text that is safe to put inside HTML, by replacing the
// five characters HTML treats specially with their escaped forms.
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
  });
}

// A short-lived line of feedback, for things like "Copied" that do not
// deserve a modal. One toast at a time; a second call replaces the first.
let toastTimer = null;
export function toast(message) {
  let element = document.querySelector(".toast");
  if (!element) {
    element = document.createElement("div");
    element.className = "toast";
    element.setAttribute("role", "status");
    document.body.appendChild(element);
  }
  element.textContent = message;
  element.classList.remove("hidden");

  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    element.classList.add("hidden");
    toastTimer = null;
  }, 2000);
}
