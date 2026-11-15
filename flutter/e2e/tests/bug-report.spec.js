import { expect, test } from "@playwright/test";
import { button, fill, mockApi, noErrors, openApp, said, script, seed, stored } from "./helpers.js";

// Report a bug (lib/features/bug/bug_report.dart), as the site's form (main-site/js/bug-report.js).
test("Report a bug: what it adds, Screenshot a page, sent with its ID, a script's words never sent", async ({ page }) => {
  const db = await mockApi(page);
  await seed(page, { "uwupromptr.scripts": [script("s1", "Secret keynote", "Private words.\n".repeat(80))], "uwupromptr.activeScript": "s1" });
  await openApp(page, "?android=1");
  await button(page, "Report a bug").click();
  await expect(page.getByRole("heading", { name: "Report a bug" })).toBeVisible();
  const details = page.getByText(/^Sent with it, to help find the bug:/);
  await expect(details).toContainText("Android app");
  await expect(details).toContainText("Prompter");
  await expect(details).not.toContainText("Secret keynote");

  // Nothing typed: asks first, sends nothing.
  await button(page, "Send").click();
  await expect(said(page, "Please say what went wrong first.")).toBeVisible();
  expect(db.bugReports ?? []).toHaveLength(0);

  await fill(page, page.getByRole("textbox", { name: /What went wrong/ }), "The speed jumps when I press plus.");
  await expect.poll(async () => JSON.parse((await stored(page, "uwupromptr.bugDraft")) ?? "{}").text).toBe("The speed jumps when I press plus.");

  // Screenshot a page: the report goes, the bar comes, and the prompter's whole script is taken.
  await button(page, "Screenshot a page").click();
  await expect(page.getByRole("heading", { name: "Report a bug" })).toHaveCount(0);
  await button(page, "Screenshot this page").click();
  await expect(page.getByRole("heading", { name: "Report a bug" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("img", { name: "Picture 1" })).toBeVisible({ timeout: 20_000 });
  // A browser refills its copy of a field once it's focused again.
  await page.getByRole("textbox", { name: /What went wrong/ }).click();
  await expect(page.getByRole("textbox", { name: /What went wrong/ })).toHaveValue("The speed jumps when I press plus.");

  await button(page, "Send").click();
  await expect(said(page, "Sent as report 20261115-7K3Q. Thank you! Augy will look into it.")).toBeVisible();
  const sent = db.bugReports.at(-1);
  expect(sent.text).toBe("The speed jumps when I press plus.");
  expect(sent.platform).toBe("android");
  expect(sent.page).toBe("Prompter");
  expect(sent.images).toHaveLength(1);
  expect(sent.images[0]).toMatch(/^data:image\/jpeg;base64,/);
  // The whole script, taller than the screen, also goes as a file, and it's the script drawn: the
  // page's own colour, not a blank picture.
  expect(sent.full).toEqual([0]);
  const look = await page.evaluate(async (src) => {
    const i = new Image();
    i.src = src;
    await i.decode();
    const c = document.createElement("canvas");
    c.width = i.naturalWidth;
    c.height = i.naturalHeight;
    const x = c.getContext("2d");
    x.drawImage(i, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let k = 0; k < d.length; k += 16) if (d[k] + d[k + 1] + d[k + 2] < 200) dark++;
    return { w: i.naturalWidth, h: i.naturalHeight, corner: [d[0], d[1], d[2]], dark };
  }, sent.images[0]);
  expect(look.h).toBeGreaterThan(892);
  expect(look.corner).not.toEqual([255, 255, 255]);
  expect(look.dark).toBeGreaterThan(100);
  expect(Object.keys(sent).sort()).toEqual(["contact", "device", "full", "images", "page", "platform", "text", "version", "website"]);
  expect(JSON.stringify(sent)).not.toContain("Secret keynote");
  expect(JSON.stringify(sent)).not.toContain("Private words");
  await expect(page.getByRole("img", { name: "Picture 1" })).toHaveCount(0);
  expect(await stored(page, "uwupromptr.bugDraft")).toBeNull();
  noErrors(page);
});

test("Report a bug: not set up on the site offers email, and what's typed stays", async ({ page }) => {
  const db = await mockApi(page, { bugStatus: 503 });
  await seed(page);
  await openApp(page);
  await button(page, "Report a bug").click();
  await fill(page, page.getByRole("textbox", { name: /What went wrong/ }), "Nothing scrolls.");
  await button(page, "Send").click();
  await expect(said(page, "Bug reports can’t be sent from the app yet.")).toBeVisible();
  await expect(button(page, "Email it instead.")).toBeVisible();
  expect(db.bugReports.at(-1).platform).toBe("web");
  await expect(page.getByRole("textbox", { name: /What went wrong/ })).toHaveValue("Nothing scrolls.");
  noErrors(page);
});
