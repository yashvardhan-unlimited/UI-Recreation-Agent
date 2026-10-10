import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:64789/";
const out = process.argv[3] ?? "./shot";
const width = parseInt(process.argv[4] ?? "1440", 10);
const height = parseInt(process.argv[5] ?? "900", 10);
const full = process.argv[6] !== "viewport";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
await page.goto(url, { waitUntil: "networkidle" });
// Trigger all scroll reveals by scrolling through the page.
await page.evaluate(async () => {
  const h = document.body.scrollHeight;
  for (let y = 0; y <= h; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}-w${width}${full ? "-full" : ""}.png`, fullPage: full });
await browser.close();
console.log("saved", out);
