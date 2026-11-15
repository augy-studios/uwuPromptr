import { expect, test } from "@playwright/test";

// The website itself (main-site/, served by site-serve.mjs): its Report a bug form
// (js/bug-report.js) and its tours (js/tour.js), which the apps match.

const SITE = "http://127.0.0.1:47392";

async function openSite(page, path = "/", { tours = false } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((tours) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    if (!tours) {
      localStorage.setItem("uwupromptr.tour.welcome", "done");
      localStorage.setItem("uwupromptr.tour.pages", JSON.stringify(["remote", "remote-panel"]));
    }
  }, tours);
  // Google's tag and font: not needed here.
  await page.route(/googletagmanager|fonts\.googleapis/, (r) => r.fulfill({ status: 204, body: "" }));
  await page.goto(`${SITE}${path}`);
  page.siteErrors = errors;
}

test("the site's Report a bug: what it adds, Screenshot a page, sent with its ID, no script words", async ({ page }) => {
  const reports = [];
  await page.route(`${SITE}/api/bug-report`, async (route) => {
    reports.push(JSON.parse(route.request().postData()));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "20261115-7K3Q" }) });
  });
  await openSite(page);
  await page.locator("#bugBtn").click();
  await expect(page.locator("#bugModal")).toBeVisible();
  await expect(page.locator("#bugDetails")).toContainText("Prompter");
  await page.locator("#bugSend").click();
  await expect(page.locator("#bugStatus")).toHaveText("Please say what went wrong first.");
  await page.locator("#bugText").fill("The font jumps two sizes.");
  await page.locator("#bugScreenshot").click();
  await expect(page.locator("#bugModal")).toBeHidden();
  await page.locator("#bugShotTake").click();
  await expect(page.locator("#bugModal")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".bug-shot img")).toHaveCount(1);
  await page.locator("#bugSend").click();
  await expect(page.locator("#bugStatus")).toHaveText("Sent as report 20261115-7K3Q. Thank you! Augy will look into it.");
  const sent = reports.at(-1);
  expect(sent.text).toBe("The font jumps two sizes.");
  expect(sent.platform).toBe("web");
  expect(sent.page).toBe("Prompter");
  expect(sent.images[0]).toMatch(/^data:image\/jpeg;base64,/);
  expect(JSON.stringify(sent)).not.toContain("Welcome to uwuPromptr");
  expect(page.siteErrors).toEqual([]);
});

test("the site's welcome tour: every step on screen, then seen", async ({ page }) => {
  for (const viewport of [{ width: 412, height: 892 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.context().clearCookies();
    await openSite(page, "/", { tours: true });
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator(".tourCard")).toBeVisible({ timeout: 10_000 });
    for (let i = 0; i < 10; i++) {
      const box = await page.locator(".tourCard").boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
      const label = await page.locator(".tourNext").textContent();
      await page.locator(".tourNext").click();
      await page.waitForTimeout(200);
      if (label === "Done") break;
    }
    await expect(page.locator(".tour")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("uwupromptr.tour.welcome"))).toBe("done");
  }
  expect(page.siteErrors).toEqual([]);
});

test("the site's Show me around replays the remote page's tour, and comes back", async ({ page }) => {
  await openSite(page);
  await page.locator("#settingsBtn").click();
  await page.locator('[data-tour="remote"]').click();
  await page.waitForURL(/\/remote/);
  await expect(page.locator(".tourText")).toHaveText(/^Type the remote ID/, { timeout: 10_000 });
  for (let i = 0; i < 10; i++) {
    const label = await page.locator(".tourNext").textContent();
    await page.locator(".tourNext").click();
    await page.waitForTimeout(200);
    if (label === "Done") break;
  }
  await page.waitForURL(`${SITE}/`);
  expect(page.siteErrors).toEqual([]);
});
