import { expect, test } from "@playwright/test";
import { button, mockApi, noErrors, openApp, script, seed } from "./helpers.js";

// The remote, for real (lib/remote/), against the website's own (main-site/js/remote.js, PeerJS
// 1.5.4) through PeerJS's public broker, as two people would use them: an ID shown by one, typed
// into the other. Needs the internet. The site is served by site-serve.mjs.

const SITE = "http://127.0.0.1:47392";
test.setTimeout(120_000);

/** The remote ID the remote control window shows, from its "Remote ID ABC123, tap to copy". */
async function shownCode(page) {
  const id = page.getByRole("button", { name: /^Remote ID [A-Z0-9]{6}, tap to copy/ });
  await expect(id).toBeVisible({ timeout: 20_000 });
  const name = await id.evaluate((e) => e.getAttribute("aria-label") || e.textContent);
  return name.match(/Remote ID ([A-Z0-9]{6})/)[1];
}

test("the app's prompter, driven by the website's remote: state, commands, the script, bye", async ({ page, context }) => {
  await mockApi(page);
  await seed(page, { "uwupromptr.scripts": [script("s1", "Pairing test", "Words on the prompter.\n".repeat(40))], "uwupromptr.activeScript": "s1" });
  await openApp(page);
  await page.getByRole("button", { name: /^Remote control \(Alt\+R\)/ }).click();
  const code = await shownCode(page);
  await expect(page.getByText("Waiting for a remote to connect.").last()).toBeVisible({ timeout: 30_000 });

  const remote = await context.newPage();
  await remote.goto(`${SITE}/remote?id=${code}`);
  await expect(remote.locator("#controls")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("A remote is connected.").last()).toBeVisible();
  // The site's remote shows the app's script and draws its screen.
  await expect(remote.locator("#scriptName")).toHaveText("Pairing test");
  await expect(remote.locator("#mirrorText")).toContainText("Words on the prompter.");
  await expect(remote.locator("#fontValue")).toHaveText("60");

  // Its commands drive the app.
  await remote.locator('[data-nudge="fontSize:1"]:not([data-coarse])').click();
  await expect(remote.locator("#fontValue")).toHaveText("61");
  await page.keyboard.press("Escape");
  await expect(button(page, "Font 61, opens settings")).toBeVisible();
  await remote.locator('[data-nudge="speed:1"][data-coarse]').click();
  await expect(button(page, "Speed 13.0, opens settings")).toBeVisible();
  await remote.locator("#playBtn").click();
  await expect(remote.locator("#playLabel")).toHaveText("Pause");
  await remote.locator("#playBtn").click();
  await expect(remote.locator("#playLabel")).toHaveText("Play");

  // An edit from the site's remote, accepted against the current revision.
  await remote.locator("#editBtn").click();
  await remote.locator("#editBody").fill("Rewritten on the remote.");
  await remote.locator("#editSend").click();
  await expect(page.getByText("Rewritten on the remote.").first()).toBeVisible();

  // Disconnect says bye, and the app retires the code for a new one.
  await remote.locator("#disconnectBtn").click();
  await expect(page.getByText("Remote disconnected. New ID.").last()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /^Remote control \(Alt\+R\)/ }).click();
  await expect.poll(() => shownCode(page), { timeout: 20_000 }).not.toBe(code);
  noErrors(page);
});

test("the website's prompter, driven by the app's remote", async ({ page, context }) => {
  const prompter = await context.newPage();
  await prompter.goto(`${SITE}/`);
  await prompter.evaluate(() => {
    localStorage.setItem("uwupromptr.tour.welcome", "done");
    localStorage.setItem("uwupromptr.tour.pages", JSON.stringify(["remote", "remote-panel"]));
  });
  await prompter.reload();
  await prompter.locator("#remoteBtn").click();
  await expect(prompter.locator("#remoteStatusText")).toHaveText("Waiting for a remote to connect.", { timeout: 30_000 });
  const code = (await prompter.locator("#remoteCode").textContent()).trim();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  await prompter.locator('[data-close-modal="remoteModal"]').click();

  await mockApi(page);
  await seed(page);
  await openApp(page, `?page=remote&id=${code}`);
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible({ timeout: 45_000 });
  await expect(prompter.locator("#remoteBtn")).toHaveAttribute("aria-label", /A remote is connected\./);
  // The site's script, in the app.
  await expect(page.getByText("My first script").last()).toBeVisible();
  // And a copy of its screen, drawn from the state it sends.
  await expect(page.getByText("A copy of the prompter’s screen").last()).toBeVisible();

  await page.getByRole("button", { name: "Font larger", exact: true }).click();
  await expect(prompter.locator("#fontValue")).toContainText("61");
  await page.getByRole("button", { name: "Speed up by 1" }).click();
  await expect(prompter.locator("#speedValue")).toContainText("13.0");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(prompter.locator("#playBtn")).toHaveAttribute("aria-label", "Pause (Space)");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(prompter.locator("#playBtn")).toHaveAttribute("aria-label", "Play (Space)");

  // The prompter's editor open there covers this remote.
  await prompter.locator("#editBtn").click();
  await expect(page.getByText("Being edited on the prompter").last()).toBeVisible();
  await prompter.locator("#editorDone").click();
  await expect(page.getByText("Being edited on the prompter")).toHaveCount(0);

  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("Enter the remote ID shown on the prompter").last()).toBeVisible();
  noErrors(page);
});
