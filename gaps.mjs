import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: parseInt(process.argv[2] ?? "390", 10), height: 900 } });
await page.goto("http://127.0.0.1:64789/", { waitUntil: "networkidle" });
await page.evaluate(async () => {
  const h = document.body.scrollHeight;
  for (let y = 0; y <= h; y += 300) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(500);
const out = await page.evaluate(() => {
  const r = (e) => e.getBoundingClientRect();
  const report = [];
  document.querySelectorAll("main section").forEach((sec) => {
    const name = sec.id || sec.querySelector("h1, h2")?.textContent || "?";
    const sr = r(sec);
    const kids = [...sec.children].filter((c) => r(c).height > 0);
    const topPad = kids.length ? r(kids[0]).top - sr.top : 0;
    const botPad = kids.length ? sr.bottom - r(kids[kids.length - 1]).bottom : 0;
    const gaps = [];
    for (let i = 1; i < kids.length; i++) gaps.push(Math.round(r(kids[i]).top - r(kids[i - 1]).bottom));
    report.push({ section: name, topPad: Math.round(topPad), botPad: Math.round(botPad), kids: kids.length, gaps });
  });
  // also the cake panel internals
  const panel = document.querySelector("#cakes .rounded-card");
  if (panel) {
    const pr = r(panel);
    const cs = [...panel.children];
    console.log("PANEL kids", cs.length, "innerTop:", cs.length ? (cs[0] === cs[cs.length-1] ? 0 : "grid") : 0);
  }
  return report;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
