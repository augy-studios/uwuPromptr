// Takes the pictures the store screenshots are made from (compose.mjs frames them): the app's real
// screens, from the browser build (../README.md), with the same seeded scripts each time.
//
//     node shots/capture.mjs            with serve.mjs running; pictures land in shots/raw/
//     node shots/capture.mjs phone      one set only: phone, tablet7, tablet10 or desktop
//
// The remote's pictures pair two windows through PeerJS's public broker, so they need the internet.
//
// Four sets: phone (412 × 892 at 3×), 7-inch tablet (600 × 1000 at 2.7×), 10-inch tablet
// (1280 × 800 at 2×) and desktop (1440 × 900 at 2×, with the desktop's title bar).
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { passThroughEmptyLayers } from "../tests/helpers.js";

const BASE = "http://127.0.0.1:47391";
const OUT = new URL("./raw/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
mkdirSync(OUT, { recursive: true });

// ---- the scripts ----

const script = (id, name, body) => ({ id, name, body, updated: 1 });

function scripts() {
  return [
    script("s1", "Product launch keynote", [
      "Good evening, everyone, and thank you for being here.",
      "A year ago we asked a simple question: what if reading your lines felt as easy as talking to a friend?",
      "Tonight, we're going to show you the answer.",
      "It starts with the words you've written, big and clear, rolling at exactly your pace.",
      "Your phone becomes the remote. Your watch can pause it. Nothing needs signing in.",
      "And every word stays on your own device.",
      "So let's get started.",
    ].join("\n\n")),
    script("s2", "Wedding toast", "To the happy couple: may your days be long, your arguments short, and your coffee always hot.\n\nI've known Sam since we were six..."),
    script("s3", "Morning news read", "Good morning. Here are today's top stories.\n\nThe city council has approved a new cycle lane along the river..."),
    script("s4", "Podcast intro", "Welcome back to Small Steps, the show about little changes that add up."),
    script("s5", "Class presentation", "Today I'll talk about how bees find their way home."),
  ];
}

const notes = (v) => readFileSync(new URL(`../../../announcements/release-notes-${v}.md`, import.meta.url), "utf8");
const release = {
  version: "2.0.0",
  size: 41000000,
  sha256: null,
  apk: "https://github.com/augy-studios/uwuPromptr/releases/download/android-v2.0.0/uwupromptr-2.0.0.apk",
  page: "https://github.com/augy-studios/uwuPromptr/releases/tag/android-v2.0.0",
  date: "2026-11-15T10:00:00Z",
  history: [
    { version: "2.0.0", date: "2026-11-15T10:00:00Z", notes: notes("2.0.0"), page: "https://github.com/augy-studios/uwuPromptr/releases/tag/android-v2.0.0" },
    { version: "1.0.0", date: "2026-10-18T10:00:00Z", notes: notes("1.0.0"), page: "https://github.com/augy-studios/uwuPromptr/releases/tag/android-v1.0.0" },
  ],
};

// ---- driving the app ----

async function open(browser, { viewport, scale, query = "", seed = {}, tours = false }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, hasTouch: viewport.width < 1000, isMobile: viewport.width < 1000 });
  const page = await context.newPage();
  await page.route("https://cue.uwuapps.org/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith("/app-release")
      ? release
      : path.endsWith("/turn-credentials")
        ? { ok: true, data: { iceServers: [], relay: false } }
        : { ok: true };
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  });
  await page.addInitScript(
    ([list, extra, tours]) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      // As store.dart keeps them in a browser (tests/helpers.js).
      const put = (k, v) => localStorage.setItem(`flutter.ls.${k}`, JSON.stringify(typeof v === "string" ? v : JSON.stringify(v)));
      put("uwupromptr.scripts", list);
      put("uwupromptr.activeScript", "s1");
      put("uwupromptr.trayOpen", "1");
      if (!tours) {
        put("uwupromptr.tour.welcome", "done");
        put("uwupromptr.tour.pages", ["remote", "remote-panel"]);
      }
      for (const [k, v] of Object.entries(extra)) put(k, v);
    },
    [scripts(), seed, tours],
  );
  await passThroughEmptyLayers(page);
  await page.goto(`${BASE}/${query}`);
  await page.getByRole("button", { name: /^Play \(Space\)|^Open the prompter|^Get started/ }).first().waitFor({ timeout: 30000 });
  return { context, page };
}

const btn = (page, name, exact = true) => page.getByRole("button", { name, exact });

async function shot(page, file) {
  // The pointer off anything with a tooltip.
  await page.mouse.move(page.viewportSize().width / 2, 2);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}${file}.png` });
  console.log(file);
}

// The remote control window, with its ID and QR code. Returns the ID.
async function remotePanel(page) {
  await page.getByRole("button", { name: /^Remote control \(Alt\+R\)/ }).click();
  const id = page.getByRole("button", { name: /^Remote ID [A-Z0-9]{6}, tap to copy/ });
  await id.waitFor({ timeout: 30000 });
  await page.getByText("Waiting for a remote to connect.").last().waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  const name = await id.evaluate((e) => e.getAttribute("aria-label") || e.textContent);
  return name.match(/Remote ID ([A-Z0-9]{6})/)[1];
}

// The remote, connected to a prompter in another window, through PeerJS's broker.
async function liveRemote(browser, { viewport, scale, query, seed }) {
  const host = await open(browser, { viewport: { width: 1280, height: 800 }, scale: 1 });
  const code = await remotePanel(host.page);
  await host.page.keyboard.press("Escape");
  const { context, page } = await open(browser, { viewport, scale, query: `${query}&page=remote&id=${code}`, seed });
  await btn(page, "Disconnect").waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
  return { context, page, host };
}

// The eight screens, in the order the store shows them.
async function screens(browser, set, viewport, scale) {
  const q = (s) => `?android=1${s}`;
  const uwu = { "app.look": "uwuapps" };
  let { context, page } = await open(browser, { viewport, scale, query: q(""), seed: uwu });
  await shot(page, `${set}-01-prompter`);

  await remotePanel(page);
  await shot(page, `${set}-02-remote-panel`);
  await context.close();

  let live;
  try {
    live = await liveRemote(browser, { viewport, scale, query: q(""), seed: uwu });
    await shot(live.page, `${set}-03-remote`);
  } finally {
    await live?.context.close();
    await live?.host.context.close();
  }

  ({ context, page } = await open(browser, { viewport, scale, query: q("&wallpaper=1"), seed: { "app.look": "material" } }));
  await shot(page, `${set}-04-material-you`);
  await context.close();

  ({ context, page } = await open(browser, { viewport, scale, query: q(""), seed: { ...uwu, "uwupromptr.colorTheme": "not-green-4" } }));
  await btn(page, "Theme (Alt+T)").click();
  await page.getByRole("heading", { name: "Theme" }).waitFor();
  await shot(page, `${set}-05-theme`);
  await context.close();

  ({ context, page } = await open(browser, { viewport, scale, query: q(""), seed: uwu }));
  await btn(page, "Prompter settings (Ctrl+P)").click();
  await page.getByRole("heading", { name: "Prompter" }).waitFor();
  await shot(page, `${set}-06-settings`);
  await context.close();

  ({ context, page } = await open(browser, { viewport, scale, query: q("&wallpaper=1"), seed: { "app.look": "material" } }));
  await btn(page, "Check for updates").click();
  await page.getByText("Every version").waitFor();
  await shot(page, `${set}-07-updates`);
  await context.close();

  ({ context, page } = await open(browser, { viewport, scale, query: q(""), seed: { ...uwu, "uwupromptr.mode": "dark" }, tours: true }));
  await btn(page, "Skip").waitFor({ timeout: 10000 });
  await btn(page, "Next").click();
  await page.waitForTimeout(600);
  await shot(page, `${set}-08-dark-tour`);
  await context.close();
}

async function desktop(browser) {
  const viewport = { width: 1440, height: 900 };
  const scale = 2;
  const q = "?desktop=1";
  const uwu = { "app.look": "uwuapps" };
  let { context, page } = await open(browser, { viewport, scale, query: q, seed: uwu });
  await shot(page, "desktop-01-prompter");

  // The command bar, in the middle of the title bar.
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(400);
  await page.getByRole("textbox", { name: /^Search/ }).click();
  await page.keyboard.type("s", { delay: 40 });
  await page.waitForTimeout(500);
  await shot(page, "desktop-02-command");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await btn(page, "Edit script (Ctrl+E)").click();
  await page.waitForTimeout(600);
  await shot(page, "desktop-03-editor");
  await context.close();

  ({ context, page } = await open(browser, { viewport, scale, query: q, seed: uwu }));
  await remotePanel(page);
  await shot(page, "desktop-04-remote-panel");
  await context.close();

  let live;
  try {
    live = await liveRemote(browser, { viewport, scale, query: q, seed: uwu });
    await shot(live.page, "desktop-05-remote");
  } finally {
    await live?.context.close();
    await live?.host.context.close();
  }

  ({ context, page } = await open(browser, { viewport: { width: 940, height: 660 }, scale, query: "?welcome=1", seed: { "uwupromptr.colorTheme": "classic" } }));
  await page.getByText("Get started").waitFor();
  await shot(page, "desktop-06-welcome");
  await context.close();

  ({ context, page } = await open(browser, { viewport, scale, query: q, seed: { ...uwu, "uwupromptr.mode": "dark", "uwupromptr.colorTheme": "not-green-2" } }));
  await shot(page, "desktop-07-dark");
  await context.close();

  ({ context, page } = await open(browser, { viewport, scale, query: q, seed: uwu }));
  await btn(page, "Prompter settings (Ctrl+P)").click();
  await page.getByRole("heading", { name: "Prompter" }).waitFor();
  await shot(page, "desktop-08-settings");
  await context.close();
}

const browser = await chromium.launch();
const only = process.argv[2];
try {
  if (!only || only === "phone") await screens(browser, "phone", { width: 412, height: 892 }, 3);
  if (!only || only === "tablet7") await screens(browser, "tablet7", { width: 600, height: 1000 }, 2.7);
  if (!only || only === "tablet10") await screens(browser, "tablet10", { width: 1280, height: 800 }, 2);
  if (!only || only === "desktop") await desktop(browser);
} finally {
  await browser.close();
}
