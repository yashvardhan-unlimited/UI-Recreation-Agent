import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:64789/", { waitUntil: "networkidle" });
// scroll each section fully into view and settle before measuring
const out = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const secs = [...document.querySelectorAll("main section")];
  for (const s of secs) { s.scrollIntoView({ block: "center" }); await sleep(1400); }
  window.scrollTo(0, 0);
  await sleep(400);
  const report = secs.map((sec) => {
    const sr = sec.getBoundingClientRect();
    const inner = sec.firstElementChild;
    const tr = getComputedStyle(inner).transform;
    const op = getComputedStyle(inner).opacity;
    const ir = inner.getBoundingClientRect();
    return {
      id: sec.id || "(hero)",
      topPad: Math.round(ir.top - sr.top),
      botPad: Math.round(sr.bottom - ir.bottom),
      transform: tr === "none" ? "none" : tr,
      opacity: op,
    };
  });
  return report;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
