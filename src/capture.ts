import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Page } from "playwright";
import { inPage, launch } from "./browser.js";

export type Box = { y: number; height: number };
export type Facts = { source: string; estimated: boolean; fonts: { family: string; share: number }[]; colors: { text: string[]; background: string[] };
  sizes: number[]; radii: string[]; headings: { tag: string; text: string; size: number; weight: number }[]; sections: Box[] };
/** A captured reference, cached as .ui/ref/ref.json. crops[i] is section i at 1440px (what the plan's `ref` indexes), mobile[i] at 390px. */
export type Reference = { facts: Facts; fold: string; crops: string[]; mobile: string[]; frames: string[][]; hover?: { section: number; before: string; after: string } };

// In the page: what computed styles say about the design, weighted by how much of the page uses each value.
function measure() {
  const hex = (c: string, n = c.match(/[\d.]+/g)?.map(Number) ?? []) => (n.length < 3 || n[3] === 0 ? undefined : `#${n.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`);
  const tally = new Map<string, Map<string, number>>();
  const add = (kind: string, key: string | undefined, weight: number) => key && tally.set(kind, (tally.get(kind) ?? new Map<string, number>()).set(key, (tally.get(kind)?.get(key) ?? 0) + weight));
  const top = (kind: string, n: number) => [...(tally.get(kind) ?? [])].sort((a, b) => b[1] - a[1]).slice(0, n);
  for (const el of [document.documentElement, document.body, ...document.body.querySelectorAll("*")]) {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    if (!r.width || !r.height || s.visibility === "hidden") continue;
    const chars = [...el.childNodes].reduce((n, c) => n + (c.nodeType === 3 ? (c.textContent ?? "").trim().length : 0), 0);
    if (chars) {
      add("font", s.fontFamily.split(",")[0]!.replace(/["']/g, "").trim(), chars);
      add("text", hex(s.color), chars);
      add("size", String(Math.round(parseFloat(s.fontSize))), chars);
    }
    add("bg", hex(s.backgroundColor), r.width * r.height);
    const radius = parseFloat(s.borderTopLeftRadius);
    if (radius > 0) add("radius", radius >= Math.min(r.width, r.height) / 2 ? "pill" : `${Math.round(radius)}px`, 1);
  }
  const total = top("font", 99).reduce((n, [, w]) => n + w, 0);
  const visible = (el: Element) => el.getBoundingClientRect().height > 0;
  // Descend through single-child wrappers (#root, main, …) to the element whose children are the page's sections.
  let root: Element = document.body;
  for (let kids = [...root.children].filter(visible); kids.length === 1; kids = [...root.children].filter(visible)) root = kids[0]!;
  const style = (h: Element) => getComputedStyle(h);
  return {
    fonts: top("font", 4).map(([family, w]) => ({ family, share: Math.round((w / total) * 100) / 100 })),
    colors: { text: top("text", 5).map(([c]) => c), background: top("bg", 5).map(([c]) => c) },
    sizes: top("size", 8).map(([px]) => Number(px)).sort((a, b) => b - a),
    radii: top("radius", 4).map(([r]) => r),
    headings: [...document.querySelectorAll("h1,h2,h3")].filter(visible).slice(0, 20)
      .map((h) => ({ tag: h.tagName.toLowerCase(), text: (h.textContent ?? "").trim().slice(0, 80), size: Math.round(parseFloat(style(h).fontSize)), weight: Number(style(h).fontWeight) })),
    sections: [...root.children].map((el) => el.getBoundingClientRect()).filter((r) => r.height >= 40).map((r) => ({ y: Math.round(r.top + scrollY), height: Math.round(r.height) })),
  };
}

// In the page: scroll down like a reader so lazy content loads and entrance animations fire, then return to the top.
async function readThrough() {
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 3) await pause(120).then(() => scrollTo(0, y));
  await pause(120).then(() => scrollTo(0, 0)).then(() => pause(400));
}

// In the page: the biggest filled button or link in the first screen.
function primaryCta() {
  const filled = [...document.querySelectorAll("a, button")].map((el) => ({ r: el.getBoundingClientRect(), bg: getComputedStyle(el).backgroundColor }))
    .filter(({ r, bg }) => r.width > 0 && r.bottom <= innerHeight && bg !== "transparent" && !/,\s*0\)$/.test(bg));
  return filled.sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0]?.r.toJSON() as { x: number; y: number; width: number; height: number } | undefined;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ENTERING = [0.85, 0.6, 0.35];
type Measured = ReturnType<typeof measure>;

async function shootSections(page: Page, boxes: Box[], path: (i: number) => string) {
  const width = page.viewportSize()!.width;
  // ponytail: very tall sections are cut at 3000px to bound vision tokens; split pinned stories if that hides content.
  for (const [i, b] of boxes.entries()) await page.screenshot({ path: path(i), fullPage: true, scale: "css", clip: { x: 0, y: b.y, width, height: Math.min(b.height, 3000) } });
  return boxes.map((_, i) => path(i));
}

/** Captures a live reference at 1440px and 390px: measured facts, fold, one crop per section, entrance motion frames and the primary CTA's hover. Cached per URL. */
export async function capture(url: string, dir: string): Promise<Reference> {
  const cached = await readFile(join(dir, "ref.json"), "utf8").then((t) => JSON.parse(t) as Reference, () => undefined);
  if (cached?.facts.source === url) return cached;
  await mkdir(dir, { recursive: true });
  const png = (name: string) => join(dir, `${name}.png`);
  const browser = await launch();
  const open = async (width: number, height: number) => {
    const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    return page;
  };
  try {
    const page = await open(1440, 900);
    // Motion frames come first, on a fresh load, so entrance animations are caught in the act.
    const frames: string[][] = [];
    for (const [i, box] of ((await page.evaluate(inPage(measure))) as Measured).sections.entries()) {
      // Section top at 85%, 60% and 35% of the viewport height: entering, arriving, settled.
      frames.push(ENTERING.map((_, k) => png(`motion-${i}-${k}`)));
      for (const [k, at] of ENTERING.entries()) {
        await page.evaluate(`scrollTo(0, ${Math.max(0, box.y - 900 * at)})`).then(() => wait(300));
        await page.screenshot({ path: frames[i]![k]!, scale: "css" });
      }
    }
    await page.evaluate(inPage(readThrough));
    const facts: Facts = { source: url, estimated: false, ...((await page.evaluate(inPage(measure))) as Measured) };
    await page.screenshot({ path: png("fold"), scale: "css" });
    const cta = (await page.evaluate(inPage(primaryCta))) as ReturnType<typeof primaryCta>;
    let hover: Reference["hover"];
    if (cta) {
      const clip = { x: Math.max(0, cta.x - 24), y: Math.max(0, cta.y - 24), width: cta.width + 48, height: cta.height + 48 };
      await page.screenshot({ path: png("hover-before"), clip, scale: "css" });
      await page.mouse.move(cta.x + cta.width / 2, cta.y + cta.height / 2).then(() => wait(500));
      await page.screenshot({ path: png("hover-after"), clip, scale: "css" });
      hover = { section: Math.max(0, facts.sections.findIndex((b) => cta.y >= b.y && cta.y < b.y + b.height)), before: png("hover-before"), after: png("hover-after") };
    }
    const crops = await shootSections(page, facts.sections, (i) => png(`section-${i}`));
    const phone = await open(390, 844);
    await phone.evaluate(inPage(readThrough));
    const mobile = await shootSections(phone, ((await phone.evaluate(inPage(measure))) as Measured).sections, (i) => png(`mobile-${i}`));
    const ref: Reference = { facts, fold: png("fold"), crops, mobile, frames, ...(hover && { hover }) };
    await writeFile(join(dir, "ref.json"), JSON.stringify(ref, null, 2));
    return ref;
  } finally {
    await browser.close();
  }
}

/** Screenshot-only reference: crops the image into bands (fractions of its height, from the analyst), rendered at most 1440px wide. */
export async function cropImage(image: string, bands: { top: number; bottom: number }[], dir: string) {
  await mkdir(dir, { recursive: true });
  const type = { ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp" }[extname(image).toLowerCase()] ?? "png";
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.setContent(`<body style="margin:0"><img id="ref" style="display:block;max-width:1440px" src="data:image/${type};base64,${(await readFile(image)).toString("base64")}">`);
    const size = (await page.evaluate(`document.getElementById("ref").decode().then(() => document.getElementById("ref").getBoundingClientRect().toJSON())`)) as { width: number; height: number };
    await page.setViewportSize({ width: Math.max(1, Math.round(size.width)), height: 900 });
    const boxes = bands.map((b) => ({ y: Math.round(b.top * size.height), height: Math.max(1, Math.round((b.bottom - b.top) * size.height)) }));
    return { size, crops: await shootSections(page, boxes, (i) => join(dir, `section-${i}.png`)) };
  } finally {
    await browser.close();
  }
}
