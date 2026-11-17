// A quick look at the app: opens the Flutter build that serve.mjs is serving, waits for it to
// settle, saves a screenshot, and prints any errors the page reported.
// Usage: node peek.mjs <screenshot.png> [query] [width] [height]
import { chromium } from "@playwright/test";
const [, , outputPath, query = "", width = "412", height = "892"] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (error) => {
  errors.push(String(error));
});
page.on("console", (message) => {
  if (message.type() === "error") {
    errors.push(message.text());
  }
});
await page.goto("http://127.0.0.1:47391/" + query);
await page.waitForTimeout(4500);
await page.screenshot({ path: outputPath });
let report = errors.join("\n");
if (!report) {
  report = "no errors";
}
console.log(report);
await browser.close();
