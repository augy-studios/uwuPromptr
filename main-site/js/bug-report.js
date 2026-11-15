// Report a bug, from the side tray (the prompter) and the top bar (the remote): a small form for
// what went wrong, and a way to be reached if they'd like an answer, sent to Augy on Telegram by
// api/bug-report.js. The same form as SG Bus Timings' and uwuBoard's, and the apps'
// (flutter/lib/features/bug/bug_report.dart). BUG-REPORT-SETUP.md sets up the bot.
//
// The form adds what helps find the bug, and says so under the box before it's sent: which app
// and its version (the site's, from sw.js), the device as the browser describes it, and the page
// on show (the prompter or the remote, and which window is open: never a script's name or its
// words). Nothing else goes.
//
// What's typed stays while the page is open, closed or not, until it's sent. Offline it waits for
// the connection. If the site can't send it (not set up, or Telegram's down), it offers email
// instead, with the same words filled in.
//
// Pictures, up to MAX_SHOTS: picked from the device (any image), or Screenshot a page. That puts
// the form away and leaves you on the page, to go where the bug is (open a window, start the
// script), with a bar floating at the bottom: its Screenshot this page draws the page as it is
// (vendor/html-to-image, loaded the first time it's used) and brings you back to the form. The
// bar is left out of the picture. Each picture is made a JPEG of at most SHOT_SIDE pixels a side
// and about SHOT_BYTES before it's sent.
//
// Once it's sent, the form says the report's ID (api/bug-report.js, reportId), to quote.

import { openModal, closeModal, hydrateIcons } from "./ui.js";

const $ = (sel) => document.querySelector(sel);
const ID = "bugModal";
const EMAIL = "augy@augystudios.com";
const MIN_TEXT = 5;
const VERSION_MS = 1500;
const MAX_SHOTS = 3;
const SHOT_SIDE = 1600;
const SHOT_BYTES = 900 * 1024;
const CAPTURE_LIB = "/vendor/html-to-image-1.11.13/html-to-image.js";

let siteVersion = null;
let details = null;
let sending = false;
let shots = [];

/* The site's version, from the service worker serving it ("v32"), or null without one. */
function askVersion() {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), VERSION_MS);
    channel.port1.onmessage = ({ data }) => {
      clearTimeout(timer);
      const v = typeof data === "string" ? data : data?.version;
      resolve(v == null ? null : `v${v}`);
    };
    sw.postMessage({ type: "version" }, [channel.port2]);
  });
}

/* Which app this is: the site installed, or the site in a browser. The apps send their own. */
function platform() {
  if (window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone) return "pwa";
  return "web";
}
const PLATFORM_NAMES = { web: "Web", pwa: "Web, installed" };

const version = () => (siteVersion ? `site ${siteVersion}` : "");

const SYSTEMS = [[/Android ([\d.]+)/, "Android"], [/(?:iPhone|iPad|iPod).*? OS (\d+)/, "iOS"], [/Windows NT/, "Windows"],
  [/CrOS/, "ChromeOS"], [/Mac OS X/, "macOS"], [/Linux/, "Linux"]];
const BROWSERS = [[/SamsungBrowser\/(\d+)/, "Samsung Internet"], [/Edg\/(\d+)/, "Edge"], [/Firefox\/(\d+)/, "Firefox"],
  [/(?:Chrome|CriOS)\/(\d+)/, "Chrome"], [/Version\/(\d+).*Safari/, "Safari"]];
function first(list, ua, none) {
  for (const [re, name] of list) {
    const m = re.exec(ua);
    if (m) return m[1] ? `${name} ${m[1]}` : name;
  }
  return none;
}

/* "Android 14 · Chrome 130 · 412×915". */
function device() {
  const ua = navigator.userAgent || "";
  return `${first(SYSTEMS, ua, "Unknown system")} · ${first(BROWSERS, ua, "Unknown browser")} · ${window.innerWidth}×${window.innerHeight}`;
}

/* The windows that can be open over the page, by what they're called. */
const WINDOWS = {
  scriptsModal: "Scripts",
  settingsModal: "Prompter settings",
  remoteModal: "Remote control",
  themeModal: "Theme",
};
const shown = (el) => el && !el.classList.contains("hidden") && !el.hidden;

/* The page on show, and the window open over it: never a script's name or its words. */
function page() {
  const remote = document.body.classList.contains("page-remote");
  const parts = [remote ? `Remote, ${shown($("#controls")) ? "connected" : "not connected"}` : "Prompter"];
  if (!remote && shown($("#editor"))) parts.push("editor");
  for (const [id, name] of Object.entries(WINDOWS)) if (shown(document.getElementById(id))) parts.push(name);
  return parts.join(", ");
}

function collect() {
  const p = platform();
  return { version: version(), platform: p, device: device(), page: page(), platformName: PLATFORM_NAMES[p] };
}

const detailsText = () => [details.platformName, details.version, details.device, details.page].filter(Boolean).join(" · ");

function say(text, { email = false } = {}) {
  const el = $("#bugStatus");
  el.hidden = !text;
  el.textContent = text || "";
  if (email) {
    const body = `${$("#bugText").value.trim()}\n\n${detailsText()}`;
    const a = document.createElement("a");
    a.href = `mailto:${EMAIL}?subject=${encodeURIComponent("uwuPromptr bug report")}&body=${encodeURIComponent(body)}`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Email it instead.";
    el.append(" ", a);
  }
}

function renderDetails() {
  $("#bugDetails").textContent = `${detailsText()}.`;
}

/* `keepStatus`: back from a screenshot, whose outcome is on show. */
export async function openBugReport({ keepStatus = false } = {}) {
  // Its own page's state, before the form covers it.
  details = collect();
  renderDetails();
  if (!keepStatus) say("");
  document.querySelectorAll(".modal-backdrop:not(.hidden)").forEach((m) => { if (m.id !== ID) closeModal(m.id); });
  openModal(ID);
  setTimeout(() => $("#bugText").focus(), 50);
  if (!siteVersion) {
    siteVersion = await askVersion();
    if (siteVersion && details) {
      details.version = version();
      renderDetails();
    }
  }
}

/* ---- pictures ---- */

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("not an image"));
    i.src = url;
  });
}

/* An image (a File, or a data URL) as a JPEG data URL, at most SHOT_SIDE a side and about
   SHOT_BYTES, smaller and rougher till it is. */
async function shrink(src) {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  try {
    const img = await loadImage(url);
    let side = SHOT_SIDE;
    for (let tries = 0; tries < 6; tries++) {
      const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const out = canvas.toDataURL("image/jpeg", tries < 2 ? 0.82 : 0.7);
      if (out.length * 0.75 <= SHOT_BYTES || tries === 5) return out;
      side = Math.round(side * 0.8);
    }
  } finally {
    if (typeof src !== "string") URL.revokeObjectURL(url);
  }
  return null;
}

function renderShots() {
  const box = $("#bugShots");
  box.innerHTML = shots
    .map((s, i) => `<span class="bug-shot"><img src="${s}" alt="Picture ${i + 1}"><button type="button" class="bug-shot-x" data-bug-shot="${i}" aria-label="Remove picture ${i + 1}">×</button></span>`)
    .join("");
  box.hidden = !shots.length;
  const full = shots.length >= MAX_SHOTS;
  $("#bugAddPic").disabled = full;
  $("#bugScreenshot").disabled = full;
}

async function addShot(src) {
  if (shots.length >= MAX_SHOTS) return;
  try {
    const jpeg = await shrink(src);
    if (jpeg) shots.push(jpeg);
  } catch {
    say("Couldn't add that picture.");
  }
  renderShots();
}

let lib = null;
function captureLib() {
  if (window.htmlToImage) return Promise.resolve(window.htmlToImage);
  lib ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = CAPTURE_LIB;
    s.onload = () => (window.htmlToImage ? resolve(window.htmlToImage) : reject(new Error("no htmlToImage")));
    s.onerror = () => {
      lib = null;
      reject(new Error("could not load"));
    };
    document.head.appendChild(s);
  });
  return lib;
}

/* ---- Screenshot a page ---- */

function screenshotAPage() {
  if (shots.length >= MAX_SHOTS) return;
  captureLib().catch(() => {}); // fetched while they find the page
  closeModal(ID);
  const bar = $("#bugShotBar");
  bar.hidden = false;
  $("#bugShotTake").disabled = false;
  $("#bugShotTakeLabel").textContent = "Screenshot this page";
  setTimeout(() => $("#bugShotTake").focus(), 50);
}

function backToForm(status) {
  $("#bugShotBar").hidden = true;
  say(status || "");
  openBugReport({ keepStatus: true });
}

async function settled() {
  const moving = () => document.getAnimations?.().filter((x) => x.playState === "running" && x.effect?.getComputedTiming().iterations !== Infinity) || [];
  const until = Date.now() + 1000;
  while (moving().length && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
}

async function takeScreenshot() {
  if (shots.length >= MAX_SHOTS) return backToForm();
  $("#bugShotTake").disabled = true;
  $("#bugShotTakeLabel").textContent = "Taking a screenshot…";
  let status = "";
  try {
    const h2i = await captureLib();
    await settled();
    const bg = getComputedStyle(document.body).backgroundColor;
    const url = await h2i.toJpeg(document.body, {
      quality: 0.85,
      pixelRatio: Math.min(2, window.devicePixelRatio || 1),
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: bg && bg !== "rgba(0, 0, 0, 0)" ? bg : "#ffffff",
      cacheBust: false,
      imagePlaceholder: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
      // What isn't the page: this bar, the form and the toast.
      filter: (node) => !(node.id === "bugShotBar" || node.id === ID || node.classList?.contains("toast")) && node.tagName !== "VIDEO",
    });
    await addShot(url);
  } catch (err) {
    console.warn("couldn't take the screenshot:", err);
    status = "Couldn't take a screenshot here. Take one with your device and add it instead.";
  } finally {
    renderShots();
    backToForm(status);
  }
}

/* ---- sending ---- */

async function send(e) {
  e.preventDefault();
  if (sending) return;
  const text = $("#bugText").value.trim();
  if (text.length < MIN_TEXT) {
    say("Please say what went wrong first.");
    $("#bugText").focus();
    return;
  }
  if (navigator.onLine === false) {
    say("You're offline. It's kept here: send it once you're back online.");
    return;
  }
  sending = true;
  $("#bugSend").disabled = true;
  say("Sending…");
  try {
    const { platformName, ...sent } = details;
    const r = await fetch("/api/bug-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...sent, text, contact: $("#bugContact").value.trim(), website: $("#bugWebsite").value, images: shots, full: [] }),
    });
    if (r.ok) {
      $("#bugText").value = "";
      $("#bugContact").value = "";
      shots = [];
      renderShots();
      const id = await r.json().then((d) => (typeof d?.id === "string" ? d.id : null)).catch(() => null);
      say(id ? `Sent as report ${id}. Thank you! Augy will look into it.` : "Sent. Thank you! Augy will look into it.");
      return;
    }
    const err = await r.json().then((d) => d?.error).catch(() => null);
    // Something about what was typed, or too many at once: said as it is. Otherwise, email.
    if (r.status === 400 || r.status === 413 || r.status === 429) say(err || "Couldn't send it right now.");
    else say(r.status === 503 ? "Bug reports can't be sent from the app yet." : "Couldn't send it right now.", { email: true });
  } catch {
    say("Couldn't send it right now.", { email: true });
  } finally {
    sending = false;
    $("#bugSend").disabled = false;
  }
}

export function initBugReport() {
  if (!document.getElementById(ID)) return;
  hydrateIcons(document.getElementById(ID));
  hydrateIcons($("#bugShotBar"));
  $("#bugForm").addEventListener("submit", send);
  $("#bugAddPic").addEventListener("click", () => $("#bugPicFile").click());
  $("#bugPicFile").addEventListener("change", async (e) => {
    const files = [...(e.target.files || [])].slice(0, MAX_SHOTS - shots.length);
    e.target.value = "";
    for (const f of files) await addShot(f);
  });
  $("#bugScreenshot").addEventListener("click", screenshotAPage);
  $("#bugShotTake").addEventListener("click", takeScreenshot);
  $("#bugShotCancel").addEventListener("click", () => backToForm());
  $("#bugShots").addEventListener("click", (e) => {
    const x = e.target.closest("[data-bug-shot]");
    if (!x) return;
    shots.splice(Number(x.dataset.bugShot), 1);
    renderShots();
  });
  document.querySelectorAll("[data-bug-open]").forEach((b) => b.addEventListener("click", () => openBugReport()));
  renderShots();
}
