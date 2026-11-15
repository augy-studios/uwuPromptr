import { expect } from "@playwright/test";

export const API = "https://cue.uwuapps.org/api";

/**
 * The site's API, answered here: the release check, the TURN credentials (none, so pairing uses
 * STUN as it does without a relay) and Report a bug. Every request is kept in `db.requests`.
 */
export async function mockApi(page, db = {}) {
  db.requests = [];
  db.release ??= { version: null, history: [] };
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api/, "");
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    db.requests.push({ method: req.method(), path, body });
    const json = (status, data) =>
      route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(data) });
    if (req.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    }
    switch (path) {
      case "/app-release":
        return json(200, db.release);
      case "/turn-credentials":
        return json(200, { ok: true, data: { iceServers: [], relay: false } });
      // Report a bug (main-site/api/bug-report.js): kept in db.bugReports; db.bugStatus sets the answer.
      case "/bug-report":
        (db.bugReports ??= []).push(body);
        if (db.bugStatus && db.bugStatus !== 200) return json(db.bugStatus, { error: "Bug reports can't be sent from the app yet." });
        return json(200, { id: "20261115-7K3Q" });
      default:
        return json(404, { error: "Not found" });
    }
  });
  return db;
}

/**
 * Values put in the app's store before it opens, under the site's keys (store.dart's "ls."
 * prefix, as shared_preferences keeps them in a browser). Tours are marked seen unless `tours`.
 */
export async function seed(page, values = {}, { tours = false } = {}) {
  await page.addInitScript(
    ([values, tours]) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      const put = (k, v) => localStorage.setItem(`flutter.ls.${k}`, JSON.stringify(typeof v === "string" ? v : JSON.stringify(v)));
      if (!tours) {
        put("uwupromptr.tour.welcome", "done");
        put("uwupromptr.tour.pages", ["remote", "remote-panel"]);
      }
      for (const [k, v] of Object.entries(values)) put(k, v);
    },
    [values, tours],
  );
}

/** A script as the site keeps one. */
export const script = (id, name, body) => ({ id, name, body, updated: 1 });

/**
 * In a browser, each slider leaves an empty, nameless layer over the whole window (where its value
 * bubble would show), and Playwright takes it for something in the way of every click. Clicks go
 * through such layers here, as they do for a finger.
 */
export async function passThroughEmptyLayers(page) {
  await page.addInitScript(() => {
    const add = () => {
      const style = document.createElement("style");
      style.textContent = "flt-semantics:empty:not([role]):not([aria-label]) { pointer-events: none !important; }";
      document.head.appendChild(style);
    };
    if (document.head) add();
    else document.addEventListener("DOMContentLoaded", add);
  });
}

/** The app, up, with the errors it logs collected. `query` like "?android=1". */
export async function openApp(page, query = "") {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Failed to load resource|peerjs|WebSocket/i.test(m.text())) errors.push(m.text());
  });
  await passThroughEmptyLayers(page);
  await page.goto(`/${query}`);
  page.appErrors = errors;
  await expect(page.getByRole("button", { name: /^Play \(Space\)|^Pause \(Space\)|^Open the prompter|^Show bottom bar/ }).first()).toBeVisible({ timeout: 30_000 });
  return errors;
}

export const button = (page, name, exact = true) => page.getByRole("button", { name, exact });

/** What the app keeps, as shared_preferences has it in the browser. */
export const stored = (page, key) =>
  page.evaluate((k) => {
    const v = localStorage.getItem(`flutter.ls.${k}`);
    return v === null ? null : JSON.parse(v);
  }, key);

export const storedJson = async (page, key) => {
  const v = await stored(page, key);
  return v == null ? null : JSON.parse(v);
};

/** What the app asked of its Android side. */
export const calls = (page) => page.evaluate(() => Array.from(window.e2eCalls || []).map((c) => JSON.parse(c)));

/** Types into a text field. */
export async function fill(page, locator, text) {
  await locator.click();
  await page.waitForTimeout(200);
  await page.keyboard.press("Control+A");
  await page.keyboard.type(text);
}

/** A tour on screen goes. */
export async function skipTour(page) {
  const skip = button(page, "Skip");
  try {
    await skip.waitFor({ timeout: 3500 });
    await skip.click();
  } catch {
    // None this time.
  }
}

export function noErrors(page) {
  expect(page.appErrors.filter((e) => !/WebSocket|peerjs|broker|turn-credentials/i.test(e))).toEqual([]);
}

/** A toast or note: said once to a screen reader and once on screen, so the one on screen. */
export const said = (page, text) => page.getByText(text).last();

/**
 * Brings something in a scrolling window into view: Flutter draws a long window's lower part only
 * once it's scrolled to, so it's scrolled with the mouse wheel over the window till it's there.
 */
export async function reveal(page, locator) {
  const size = page.viewportSize();
  await page.mouse.move(size.width / 2, size.height * 0.7);
  for (let i = 0; i < 30; i++) {
    if ((await locator.count()) && (await locator.first().isVisible())) {
      const box = await locator.first().boundingBox();
      if (box && box.y >= 0 && box.y + box.height <= size.height) return locator.first();
    }
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(120);
  }
  return locator.first();
}

/** Moves the pointer over the app, which brings the bars back while the script plays. */
export async function wake(page) {
  await page.mouse.move(200, 300);
  await page.mouse.move(210, 310);
}
