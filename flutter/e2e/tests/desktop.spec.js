import { expect, test } from "@playwright/test";
import { button, fill, mockApi, noErrors, openApp, script, seed } from "./helpers.js";

// The desktop apps' screens (lib/desktop/), drawn in the browser with ?desktop=1: the title bar,
// the command bar, the navigation rail and the scripts beside the prompter.
test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

test("the title bar's command bar finds scripts by their words and runs commands", async ({ page }) => {
  await mockApi(page);
  await seed(page, {
    "uwupromptr.scripts": [script("s1", "Opening", "Good evening, everyone."), script("s2", "Closing", "Thank you and goodnight.")],
    "uwupromptr.activeScript": "s1",
  });
  await openApp(page, "?desktop=1");
  // The scripts beside the prompter.
  await expect(page.getByRole("heading", { name: "Scripts" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(500);
  // Ctrl+K gives the bar Flutter's focus; in a browser the page's own focus has to follow it there.
  await page.getByRole("textbox", { name: /^Search/ }).click();
  await page.keyboard.type("goodnight", { delay: 30 });
  await expect(page.getByText("Script · its words")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(button(page, "Scripts: Closing")).toBeVisible();
  // A remote ID typed in connects the remote.
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(500);
  // Ctrl+K gives the bar Flutter's focus; in a browser the page's own focus has to follow it there.
  await page.getByRole("textbox", { name: /^Search/ }).click();
  await page.keyboard.type("Prompter settings", { delay: 30 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Prompter" })).toBeVisible();
  noErrors(page);
});

test("the navigation rail switches to the remote and back, keeping each page", async ({ page }) => {
  await mockApi(page);
  await seed(page);
  await openApp(page, "?desktop=1");
  await page.getByRole("tab", { name: "Remote" }).or(page.getByRole("button", { name: "Remote" })).first().click();
  await expect(page.getByText("Enter the remote ID shown on the prompter").last()).toBeVisible();
  await fill(page, page.getByRole("textbox", { name: "Remote ID" }), "BCDF23");
  await page.getByRole("tab", { name: "Prompter" }).or(page.getByRole("button", { name: "Prompter" })).first().click();
  await expect(button(page, "Play (Space)")).toBeVisible();
  await page.getByRole("tab", { name: "Remote" }).or(page.getByRole("button", { name: "Remote" })).first().click();
  // A browser refills its copy of a field once it's focused again.
  await page.getByRole("textbox", { name: "Remote ID" }).click();
  await expect(page.getByRole("textbox", { name: "Remote ID" })).toHaveValue("BCDF23");
  noErrors(page);
});
