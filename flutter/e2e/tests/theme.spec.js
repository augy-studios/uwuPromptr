import { expect, test } from "@playwright/test";
import { button, mockApi, noErrors, openApp, seed, stored } from "./helpers.js";

test("off Android, the site's look: light, dark and the brand colours, under the site's keys", async ({ page }) => {
  await mockApi(page);
  await seed(page);
  await openApp(page);
  await button(page, "Theme (Alt+T)").click();
  await expect(page.getByRole("heading", { name: "Theme" })).toBeVisible();
  await button(page, "Dark").click();
  await expect.poll(() => stored(page, "uwupromptr.mode")).toBe("dark");
  await button(page, "Not green 2").click();
  await expect.poll(() => stored(page, "uwupromptr.colorTheme")).toBe("not-green-2");
  await button(page, "Time-based").click();
  await expect(page.getByText(/Following the clock\. Currently (light|dark)\./)).toBeVisible();
  noErrors(page);
});

test("on Android with wallpaper colours, Material You is the default, and the UwU Apps look a switch away", async ({ page }) => {
  await mockApi(page);
  await seed(page);
  await openApp(page, "?android=1&wallpaper=1");
  await button(page, "Theme (Alt+T)").click();
  await expect(page.getByText("Colours and fonts from your device.")).toBeVisible();
  // Material You has no brand swatches.
  await expect(button(page, "Classic")).toHaveCount(0);
  await button(page, "UwU Apps").click();
  await expect.poll(() => stored(page, "app.look")).toBe("uwuapps");
  await expect(button(page, "Classic")).toBeVisible();
  await button(page, "Material You").click();
  await expect.poll(() => stored(page, "app.look")).toBe("material");
  noErrors(page);
});

test("on the desktop, the system's glass in place of Material You, and the UwU Apps look a switch away", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockApi(page);
  await seed(page);
  await openApp(page, "?desktop=1&glass=fluent");
  await button(page, "Theme (Alt+T)").click();
  await expect(page.getByText(/^Fluent 2: Mica behind the window/)).toBeVisible();
  await expect(button(page, "Material You")).toHaveCount(0);
  // The system's accent stands in for the brand colours.
  await expect(button(page, "Classic")).toHaveCount(0);
  await button(page, "UwU Apps").click();
  await expect.poll(() => stored(page, "app.look")).toBe("uwuapps");
  await expect(button(page, "Classic")).toBeVisible();
  await button(page, "Fluent 2").click();
  await expect.poll(() => stored(page, "app.look")).toBe("glass");
  noErrors(page);
});
