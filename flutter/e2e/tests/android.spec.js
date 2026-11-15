import { expect, test } from "@playwright/test";
import { button, calls, mockApi, noErrors, openApp, reveal, seed, stored } from "./helpers.js";

// What the Android app adds (lib/features/prompter/app_extras.dart), reached the right way: each
// asks its Android side (window.e2eCalls), under the site's own keys.

const last = async (page, method) => (await calls(page)).filter((c) => c.method === method).at(-1)?.options;

test("full brightness and the volume keys, kept under the site's keys and off on the remote", async ({ page }) => {
  await mockApi(page);
  await seed(page);
  await openApp(page, "?android=1");
  await page.getByRole("switch", { name: "Full brightness" }).click();
  await expect.poll(() => last(page, "brightness")).toEqual({ level: 1 });
  expect(await stored(page, "uwupromptr.fullBrightness")).toBe("1");

  await button(page, "Prompter settings (Ctrl+P)").click();
  await (await reveal(page, page.getByRole("switch", { name: "Volume keys start and stop" }))).click();
  await expect.poll(() => last(page, "keys")).toEqual({ on: true });
  expect(await stored(page, "uwupromptr.volumeKeys")).toBe("1");
  await page.keyboard.press("Escape");

  // A key from Android starts the script.
  await page.evaluate(() => window.e2eEmit("Cue", "key", JSON.stringify({ key: "volumeUp" })));
  await expect.poll(async () => (await page.getByRole("button", { name: /^Pause \(Space\)/ }).count()) + (await page.getByText(/Elapsed time 00:00:0[1-9]/).count())).toBeGreaterThan(0);

  // On the remote page none of it applies.
  await page.getByRole("button", { name: /^Remote control \(Alt\+R\)/ }).click();
  await (await reveal(page, button(page, "Enter a remote ID instead"))).click();
  await expect.poll(() => last(page, "keys")).toEqual({ on: false });
  await expect.poll(() => last(page, "brightness")).toEqual({ level: -1 });
  noErrors(page);
});

test("the offline remote: Let a nearby phone connect advertises a hash of the ID, never the ID", async ({ page }) => {
  await mockApi(page);
  await seed(page, { "uwupromptr.hostCode": "BCDF23" });
  await openApp(page, "?android=1&nearby=1");
  await page.getByRole("button", { name: /^Remote control \(Alt\+R\)/ }).click();
  await expect(page.getByRole("heading", { name: "Remote control" })).toBeVisible();
  await expect(page.getByText("No wifi? Connect phone to phone")).toBeVisible();
  await (await reveal(page, button(page, "Let a nearby phone connect"))).click();
  await expect.poll(() => last(page, "nearbyAdvertise")).toBeTruthy();
  const name = (await last(page, "nearbyAdvertise")).name;
  expect(name).toMatch(/^cue-[0-9a-f]{16}$/);
  expect(name).not.toContain("BCDF23");
  // Android says it's waiting, and the panel says so.
  await page.evaluate(() => window.e2eEmit("Cue", "nearby", JSON.stringify({ event: "status", status: "waiting" })));
  await expect(page.getByText("Waiting for a nearby phone. Bluetooth has to be on on both.").last()).toBeVisible();
  // A phone that connects but doesn't say the ID first is dropped.
  await page.evaluate(() => window.e2eEmit("Cue", "nearby", JSON.stringify({ event: "status", status: "connected" })));
  await page.evaluate(() => window.e2eEmit("Cue", "nearby", JSON.stringify({ event: "message", data: JSON.stringify({ type: "hello" }) })));
  await expect.poll(() => last(page, "nearbyDisconnect")).toBeTruthy();
  // One that does is in.
  await page.evaluate(() => window.e2eEmit("Cue", "nearby", JSON.stringify({ event: "status", status: "connected" })));
  await page.evaluate(() => window.e2eEmit("Cue", "nearby", JSON.stringify({ event: "message", data: JSON.stringify({ type: "auth", code: "BCDF23" }) })));
  await expect(page.getByText("A nearby phone is connected.").last()).toBeVisible();
  // And its commands drive the prompter.
  await page.evaluate(() => window.e2eEmit("Cue", "nearby", JSON.stringify({ event: "message", data: JSON.stringify({ type: "command", name: "nudge", setting: "fontSize", value: 1, coarse: true }) })));
  await page.keyboard.press("Escape");
  await expect(button(page, "Font 64, opens settings")).toBeVisible();
  noErrors(page);
});

test("the watch: a hello is answered with the prompter's summary; it may only play, pause and change speed", async ({ page }) => {
  await mockApi(page);
  await seed(page, { "uwupromptr.scripts": [{ id: "s1", name: "Keynote", body: "Hello there.", updated: 1 }], "uwupromptr.activeScript": "s1" });
  await openApp(page, "?android=1&watch=1");
  const watch = (m) => page.evaluate((m) => window.e2eEmit("Cue", "watch", JSON.stringify({ data: JSON.stringify(m) })), m);
  await watch({ type: "hello" });
  await expect.poll(async () => JSON.parse((await last(page, "watchSend"))?.data ?? "{}")).toMatchObject({ v: 1, live: true, role: "prompter", playing: false, speed: 12, name: "Keynote" });
  // Not allowed: anything but the speed.
  await watch({ type: "command", name: "set", setting: "fontSize", value: 150 });
  await watch({ type: "command", name: "nudge", setting: "speed", value: 5, coarse: false });
  await expect(button(page, "Speed 12.1, opens settings")).toBeVisible();
  await expect(button(page, "Font 60, opens settings")).toBeVisible();
  await watch({ type: "command", name: "toggle" });
  await expect.poll(async () => JSON.parse((await last(page, "watchSend"))?.data ?? "{}").playing).toBe(true);
  await expect(page.getByText("Your watch is connected").last()).toBeVisible();
  noErrors(page);
});
