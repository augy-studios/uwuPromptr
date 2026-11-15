import { expect, test } from "@playwright/test";
import { button, fill, mockApi, noErrors, openApp, script, seed, stored } from "./helpers.js";

// The desktop apps' screens (lib/desktop/), drawn in the browser with ?desktop=1: the title bar,
// the command bar, its Scripts and Remote buttons, and the scripts beside the prompter.
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

test("no rail: the title bar's Scripts slides the scripts away and back, Remote goes there and back", async ({ page }) => {
  await mockApi(page);
  await seed(page);
  await openApp(page, "?desktop=1");
  // Nothing fixed beside the prompter but the scripts, which can go.
  await expect(page.getByRole("button", { name: /^(Prompter|Remote) Tab/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Scripts" })).toBeVisible();
  const play = button(page, "Play (Space)");
  const wide = (await play.boundingBox()).x;

  await button(page, "Hide the scripts").click();
  await expect(page.getByRole("heading", { name: "Scripts" })).toHaveCount(0);
  // Slid away (the slide itself is too quick for a browser in a test to catch), the prompter
  // given the room.
  await page.waitForTimeout(500);
  expect((await play.boundingBox()).x).toBeLessThan(wide - 300);
  expect(await stored(page, "app.scriptsPane")).toBe("0");

  await button(page, "Show the scripts").click();
  await expect(page.getByRole("heading", { name: "Scripts" })).toBeVisible();
  await page.waitForTimeout(500);
  expect((await play.boundingBox()).x).toBeCloseTo(wide, 0);

  // The remote, from the title bar, and back, keeping each page.
  await button(page, "Use this computer as the remote").click();
  await expect(page.getByText("Enter the remote ID shown on the prompter").last()).toBeVisible();
  await expect(button(page, "Show the scripts")).toHaveCount(0);
  await expect(button(page, "Hide the scripts")).toHaveCount(0);
  await fill(page, page.getByRole("textbox", { name: "Remote ID" }), "BCDF23");
  await button(page, "Back to the prompter").click();
  await expect(play).toBeVisible();
  await button(page, "Use this computer as the remote").click();
  // A browser refills its copy of a field once it's focused again.
  await page.getByRole("textbox", { name: "Remote ID" }).click();
  await expect(page.getByRole("textbox", { name: "Remote ID" })).toHaveValue("BCDF23");
  noErrors(page);
});
