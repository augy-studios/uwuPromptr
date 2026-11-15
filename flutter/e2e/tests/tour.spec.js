import { expect, test } from "@playwright/test";
import { button, mockApi, noErrors, openApp, reveal, seed, stored } from "./helpers.js";

// First-visit tours (lib/features/tour/tour.dart, docs/page-tour-spec.md). Every step's card stays
// on screen, and the thing it lights is scrolled into view, whatever the window's size.

/** The tour card: the box holding the step's words and Next or Done. */
async function cardBox(page) {
  const next = page.getByRole("button", { name: /^(Next|Done)$/ });
  await expect(next).toBeVisible();
  return next.boundingBox();
}

async function walk(page, viewport) {
  let steps = 0;
  for (;;) {
    const box = await cardBox(page);
    // The card (its Next button, at the card's foot) inside the window.
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    steps++;
    const done = await page.getByRole("button", { name: "Done" }).count();
    await page.getByRole("button", { name: /^(Next|Done)$/ }).click();
    await page.waitForTimeout(350);
    if (done) break;
    expect(steps).toBeLessThan(12);
  }
  return steps;
}

for (const viewport of [
  { width: 412, height: 892 },
  { width: 892, height: 412 },
  { width: 1440, height: 900 },
]) {
  test(`the welcome tour, on screen at every step, ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockApi(page);
    await seed(page, {}, { tours: true });
    await openApp(page);
    await expect(page.getByText("Your scripts. Switch to another one, or start a new one, here.").last()).toBeVisible({ timeout: 10_000 });
    const steps = await walk(page, viewport);
    expect(steps).toBeGreaterThanOrEqual(4);
    await expect(page.getByRole("button", { name: "Skip" })).toHaveCount(0);
    expect(await stored(page, "uwupromptr.tour.welcome")).toBe("done");
    noErrors(page);
  });
}

test("with the trays put away, the steps light their tabs; Skip ends it and it's not shown again", async ({ page }) => {
  await mockApi(page);
  await seed(page, { "uwupromptr.topTrayOpen": "0", "uwupromptr.bottomTrayOpen": "0" }, { tours: true });
  await openApp(page);
  await expect(page.getByText(/^Your scripts\./).last()).toBeVisible({ timeout: 10_000 });
  await button(page, "Skip").click();
  expect(await stored(page, "uwupromptr.tour.welcome")).toBe("done");
  await page.reload();
  await page.waitForTimeout(3000);
  await expect(button(page, "Skip")).toHaveCount(0);
  noErrors(page);
});

test("Show me around replays the remote's tour on the remote page, and comes back", async ({ page }) => {
  await mockApi(page);
  await seed(page);
  await openApp(page);
  await button(page, "Prompter settings (Ctrl+P)").click();
  await (await reveal(page, page.getByRole("button", { name: "Remote", exact: true }))).click();
  await expect(page.getByText(/^Type the remote ID the prompter shows/).last()).toBeVisible({ timeout: 10_000 });
  await walk(page, page.viewportSize());
  // Back on the prompter it began on.
  await expect(page.getByRole("button", { name: "Play (Space)" })).toBeVisible();
  noErrors(page);
});

test("the remote control window's tour, the first time it opens", async ({ page }) => {
  await mockApi(page);
  await seed(page, { "uwupromptr.tour.welcome": "done", "uwupromptr.tour.pages": ["remote"] }, { tours: true });
  await openApp(page);
  await page.getByRole("button", { name: /^Remote control \(Alt\+R\)/ }).click();
  await expect(page.getByText(/^Type this ID into the remote/).last()).toBeVisible({ timeout: 10_000 });
  await walk(page, page.viewportSize());
  expect(await stored(page, "uwupromptr.tour.pages")).toContain("remote-panel");
  noErrors(page);
});
