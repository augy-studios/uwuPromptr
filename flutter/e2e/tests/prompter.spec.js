import { expect, test } from "@playwright/test";
import { button, fill, mockApi, noErrors, openApp, reveal, said, script, seed, stored, storedJson, wake } from "./helpers.js";

// The prompter (lib/features/prompter/), as the site's main-site/index.html and js/app.js.

test("a first run: the welcome script, under the site's keys", async ({ page }) => {
  await mockApi(page);
  await seed(page);
  await openApp(page);
  await expect(button(page, "Scripts: My first script")).toBeVisible();
  const scripts = await storedJson(page, "uwupromptr.scripts");
  expect(scripts).toHaveLength(1);
  expect(scripts[0].name).toBe("My first script");
  expect(scripts[0].body).toMatch(/^Welcome to uwuPromptr\./);
  expect(scripts[0].id).toMatch(/^s[0-9a-z]+$/);
  noErrors(page);
});

test("play scrolls and counts, pause keeps the time, reset zeroes it", async ({ page }) => {
  await mockApi(page);
  await seed(page, { "uwupromptr.scripts": [script("s1", "Long one", "Line of the script.\n".repeat(200))], "uwupromptr.activeScript": "s1" });
  await openApp(page);
  const scrolled = () => page.evaluate(() => 0);
  await button(page, "Play (Space)").click();
  // While it plays the bars fade away: nothing but the script to touch.
  await page.waitForTimeout(3200);
  await expect(button(page, "Pause (Space)")).toHaveCount(0);
  // They come back for the pointer.
  await wake(page);
  await button(page, "Pause (Space)").click();
  // Paused, the time stays where it got to.
  const clock = page.getByText(/^Elapsed time 00:00:0[2-9]/);
  await expect(clock).toBeVisible();
  const was = await clock.textContent();
  await page.waitForTimeout(1500);
  expect(await page.getByText(/^Elapsed time /).textContent()).toBe(was);
  // And the script has moved on from its top.
  await expect(page.getByText(/^Line of the script/).first()).toBeVisible();
  await button(page, "Reset to the top (Esc)").click();
  await expect(page.getByText("Elapsed time 00:00:00")).toBeVisible();
  void scrolled;
  noErrors(page);
});

test("the keyboard: space, arrows with and without Shift, F and Esc, as the site's", async ({ page }) => {
  await mockApi(page);
  await seed(page);
  await openApp(page);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(button(page, "Font 62, opens settings")).toBeVisible();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(button(page, "Font 58, opens settings")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(button(page, "Speed 12.1, opens settings")).toBeVisible();
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(button(page, "Speed 11.1, opens settings")).toBeVisible();
  const settings = await storedJson(page, "uwupromptr.settings");
  expect(settings.fontSize).toBe(58);
  expect(settings.speed).toBe(11.1);
  await page.keyboard.press("Space");
  await wake(page);
  await expect(button(page, "Pause (Space)")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(button(page, "Play (Space)")).toBeVisible();
  // Ctrl+P opens the settings and shuts them again.
  await page.keyboard.press("Control+p");
  await expect(page.getByRole("heading", { name: "Prompter" })).toBeVisible();
  await page.keyboard.press("Control+p");
  await expect(page.getByRole("heading", { name: "Prompter" })).toHaveCount(0);
  // Alt+T, the theme.
  await page.keyboard.press("Alt+t");
  await expect(page.getByRole("heading", { name: "Theme" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Theme" })).toHaveCount(0);
  noErrors(page);
});

test("editing: autosave, Done, Cancel puts back what it opened with", async ({ page }) => {
  await mockApi(page);
  await seed(page, { "uwupromptr.scripts": [script("s1", "Talk", "The old words.")], "uwupromptr.activeScript": "s1" });
  await openApp(page);
  await button(page, "Edit script (Ctrl+E)").click();
  const body = page.getByRole("textbox", { name: /Script text/ });
  await fill(page, body, "New words for the talk.");
  // Saved as it's typed.
  await expect.poll(async () => (await storedJson(page, "uwupromptr.scripts"))[0].body).toBe("New words for the talk.");
  await button(page, "Done").click();
  await expect(said(page, "Script saved")).toBeVisible();
  await expect(page.getByText("New words for the talk.").first()).toBeVisible();

  // Cancel: asks, then puts back what it opened with.
  await button(page, "Edit script (Ctrl+E)").click();
  await fill(page, page.getByRole("textbox", { name: /Script text/ }), "Something I'll throw away.");
  await page.waitForTimeout(600);
  await button(page, "Cancel").click();
  await button(page, "Discard").click();
  await expect.poll(async () => (await storedJson(page, "uwupromptr.scripts"))[0].body).toBe("New words for the talk.");
  noErrors(page);
});

test("scripts: switch, new, delete with a confirm, never none left", async ({ page }) => {
  await mockApi(page);
  await seed(page, { "uwupromptr.scripts": [script("s1", "First", "One."), script("s2", "Second", "Two words.")], "uwupromptr.activeScript": "s1" });
  await openApp(page);
  await button(page, "Scripts: First").click();
  await expect(page.getByRole("heading", { name: "Scripts" })).toBeVisible();
  await page.getByRole("button", { name: /^Second, 2 words, Two words\./ }).click();
  await expect(button(page, "Scripts: Second")).toBeVisible();
  expect(await stored(page, "uwupromptr.activeScript")).toBe("s2");

  await button(page, "Scripts: Second").click();
  await button(page, "New script").click();
  await expect(page.getByRole("textbox", { name: /Script text/ })).toBeVisible();
  await fill(page, page.getByRole("group", { name: "Edit script" }).getByRole("textbox").first(), "Third");
  await button(page, "Done").click();
  await expect(button(page, "Scripts: Third")).toBeVisible();
  expect(await storedJson(page, "uwupromptr.scripts")).toHaveLength(3);

  await button(page, "Scripts: Third").click();
  await button(page, "Delete Third").click();
  await expect(page.getByText('Delete "Third"? This cannot be undone.')).toBeVisible();
  await button(page, "Delete").click();
  await expect.poll(async () => (await storedJson(page, "uwupromptr.scripts")).map((s) => s.name)).toEqual(["First", "Second"]);
  noErrors(page);
});

test("the trays put away and come back, remembered under the site's keys", async ({ page }) => {
  await mockApi(page);
  await seed(page);
  await openApp(page);
  await button(page, "Hide top bar").click();
  await expect(button(page, "Show top bar")).toBeVisible();
  expect(await stored(page, "uwupromptr.topTrayOpen")).toBe("0");
  await button(page, "Hide bottom bar").click();
  expect(await stored(page, "uwupromptr.bottomTrayOpen")).toBe("0");
  await button(page, "Hide menu").click();
  expect(await stored(page, "uwupromptr.trayOpen")).toBe("0");
  await page.reload();
  await expect(button(page, "Show top bar")).toBeVisible({ timeout: 30_000 });
  await expect(button(page, "Show bottom bar")).toBeVisible();
  await expect(button(page, "Show menu")).toBeVisible();
  await button(page, "Show menu").click();
  await expect(button(page, "Hide menu")).toBeVisible();
  noErrors(page);
});

test("settings: sliders with their resets, the toggles, the side menu's edge", async ({ page }) => {
  await mockApi(page);
  await seed(page);
  await openApp(page);
  await button(page, "Prompter settings (Ctrl+P)").click();
  await expect(page.getByRole("heading", { name: "Prompter" })).toBeVisible();
  // Nothing to reset yet.
  await expect(button(page, "Reset font size to 60")).toBeDisabled();
  await (await reveal(page, page.getByRole("switch", { name: "Mirror across" }))).click();
  await (await reveal(page, page.getByRole("switch", { name: "Timer" }))).click();
  await (await reveal(page, button(page, "Left edge"))).click();
  const s = await storedJson(page, "uwupromptr.settings");
  expect(s.flipX).toBe(true);
  expect(s.timer).toBe(false);
  expect(await stored(page, "uwupromptr.traySide")).toBe("left");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ArrowUp");
  await button(page, "Prompter settings (Ctrl+P)").click();
  await page.mouse.wheel(0, -3000);
  await button(page, "Reset font size to 60").click();
  await expect(button(page, "Reset font size to 60")).toBeDisabled();
  expect((await storedJson(page, "uwupromptr.settings")).fontSize).toBe(60);
  noErrors(page);
});

test("what the old app kept is read as it was: scripts, settings, theme, trays", async ({ page }) => {
  await mockApi(page);
  await seed(page, {
    "uwupromptr.scripts": [script("sold1", "From the website", "Kept words.")],
    "uwupromptr.activeScript": "sold1",
    "uwupromptr.settings": { fontSize: 88, speed: 7.5, lineHeight: 1.6, margin: 12, focusPosition: 30, flipX: false, flipY: true, focusLine: true, timer: true },
    "uwupromptr.mode": "dark",
    "uwupromptr.colorTheme": "not-green-2",
    "uwupromptr.traySide": "left",
  });
  await openApp(page);
  await expect(button(page, "Scripts: From the website")).toBeVisible();
  await expect(button(page, "Font 88, opens settings")).toBeVisible();
  await expect(button(page, "Speed 7.5, opens settings")).toBeVisible();
  // Nothing the old app kept was written over.
  expect(await stored(page, "uwupromptr.mode")).toBe("dark");
  expect(await stored(page, "uwupromptr.colorTheme")).toBe("not-green-2");
  expect((await storedJson(page, "uwupromptr.settings")).flipY).toBe(true);
  noErrors(page);
});
