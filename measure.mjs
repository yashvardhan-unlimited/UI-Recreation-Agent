import { chromium } from "playwright";
const url = "http://127.0.0.1:64789/";
const width = parseInt(process.argv[2] ?? "1440", 10);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: 900 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.evaluate(async () => {
  const h = document.body.scrollHeight;
  for (let y = 0; y <= h; y += 300) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(600);

const data = await page.evaluate(() => {
  const W = document.documentElement.clientWidth;
  const rect = (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
  const sections = [...document.querySelectorAll("main section")].map((s) => ({
    id: s.id || s.querySelector("h1,h2")?.textContent?.slice(0, 30) || "?",
    top: rect(s).top, bottom: rect(s).bottom,
  }));
  // gaps between consecutive sections
  const gaps = sections.slice(1).map((s, i) => ({ after: sections[i].id, before: s.id, gap: s.top - sections[i].bottom }));
  // text block alignment: pick representative blocks
  const blocks = [...document.querySelectorAll("h1, h2, h3, p, li, a.font-display, .font-display")].slice(0, 80).map((e) => {
    const r = rect(e);
    const tag = e.tagName + (e.id ? "#" + e.id : "");
    const txt = (e.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    return { tag, txt, left: Math.round(r.left), rightGapW: Math.round(W - r.right), width: Math.round(r.width), top: Math.round(r.top) };
  });
  // vertical spacing of direct children inside each section
  const vspaces = sections.map((s) => {
    const el = document.querySelector(`main section[id="${s.id ?? ""}"]`) || document.querySelector("main section");
    return s.id;
  });
  return { W, pageHeight: document.body.scrollHeight, sections, gaps, blocks };
});
console.log(JSON.stringify(data, null, 1).slice(0, 12000));
await browser.close();
