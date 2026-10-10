import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Page } from "playwright";
import Type from "typebox";
import { prompt } from "./agents.js";
import { inPage, launch } from "./browser.js";
import { ask } from "./llm.js";
import { pool } from "./loop.js";
import { paths, type Event, type Plan } from "./store.js";

export type Photo = { src: string; width: number; height: number; about: string };
type Log = (event: Omit<Event, "t">) => Promise<void>;
type Saved = Record<string, { width: number; height: number; about?: string; source?: string }>;

const MAX_WIDTH = 1600;
const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".avif": "image/avif" };
const PLACEHOLDER = { src: "/demo/photo.svg", width: 1200, height: 800 };
const hash = (data: string | Buffer) => createHash("sha1").update(data).digest("hex").slice(0, 12);
const siteFile = (dir: string, name: string) => join(paths(dir).site, "public", "images", name);
const manifest = (dir: string) => join(dir, ".ui", "images.json");
const load = (dir: string): Promise<Saved> => readFile(manifest(dir), "utf8").then((t) => JSON.parse(t) as Saved).catch(() => ({}));
const store = (dir: string, saved: Saved) => mkdir(join(dir, ".ui"), { recursive: true }).then(() => writeFile(manifest(dir), JSON.stringify(saved, null, 2)));

async function withPage<T>(fn: (page: Page) => Promise<T>) {
  const browser = await launch();
  try {
    return await fn(await browser.newPage({ viewport: { width: MAX_WIDTH, height: 900 } }));
  } finally {
    await browser.close();
  }
}

function fit(max: number) {
  const img = document.querySelector("img")!;
  return img.decode().then(() => {
    const width = Math.min(img.naturalWidth, max), height = Math.round((img.naturalHeight * width) / img.naturalWidth);
    Object.assign(img.style, { display: "block", width: `${width}px`, height: `${height}px` });
    return { width, height };
  });
}

// At most 1600px wide so a phone photo can't fail the LCP gate; PNGs stay PNG to keep transparency. Written to stage too, which was synced before this ran.
async function save(dir: string, page: Page, bytes: Buffer, type: string, name: string) {
  await page.setContent(`<body style="margin:0"><img src="data:${type};base64,${bytes.toString("base64")}">`);
  const size = (await page.evaluate(inPage(fit, MAX_WIDTH))) as { width: number; height: number };
  const image = await page.locator("img").screenshot({ scale: "css", ...(name.endsWith(".png") ? { type: "png", omitBackground: true } : { type: "jpeg", quality: 82 }) });
  for (const root of [paths(dir).site, paths(dir).stage]) {
    await mkdir(join(root, "public", "images"), { recursive: true });
    await writeFile(join(root, "public", "images", name), image);
  }
  return size;
}

export const describePhoto = async (image: string) =>
  ask<{ about: string }>("analyst", { system: await prompt("photo"), user: [{ image }], schema: Type.Object({ about: Type.String({ minLength: 1, maxLength: 400 }) }) });

/** The user's photos from <dir>/images, re-encoded into public/images and described once by the vision model (cached by content in .ui/images.json). */
export async function userPhotos(dir: string, describe: (file: string) => Promise<string>, log: Log): Promise<Photo[]> {
  const folder = join(dir, "images");
  const files = (await readdir(folder).catch(() => [] as string[])).filter((f) => extname(f).toLowerCase() in TYPES);
  if (!files.length) return [];
  const saved = await load(dir), photos: (Photo & { name: string; file: string })[] = [];
  await withPage(async (page) => {
    for (const file of files) {
      const bytes = await readFile(join(folder, file)), ext = extname(file).toLowerCase(), name = `${hash(bytes)}${ext === ".png" ? ".png" : ".jpg"}`;
      try {
        if (!saved[name] || !(await access(siteFile(dir, name)).then(() => true, () => false))) saved[name] = await save(dir, page, bytes, TYPES[ext]!, name);
        photos.push({ name, file, src: `/images/${name}`, width: saved[name].width, height: saved[name].height, about: saved[name].about ?? "" });
      } catch (e) {
        await log({ step: "photo", ms: 0, ok: false, note: `images/${file} could not be read (${(e as Error).message.split("\n")[0]}); save it as JPEG, PNG or WebP.` });
      }
    }
  });
  // A failed description falls back to the file name and is not cached, so the next run tries again.
  await pool(photos.filter((p) => !p.about), Number(process.env.UI_PARALLEL ?? 3), async (p) => {
    const about = await describe(siteFile(dir, p.name)).catch(() => undefined);
    if (about) saved[p.name]!.about = about;
    p.about = about ?? `a photo named ${p.file}`;
  });
  await store(dir, saved);
  return photos.map(({ src, width, height, about }) => ({ src, width, height, about }));
}

// CC0/public-domain only, so the site needs no credit line (the source page goes into .ui/images.json). Openverse needs every word to match, so a long query is retried with its first 3, 2 and 1 words.
async function stock(query: string) {
  const api = process.env.UI_STOCK_URL ?? "https://api.openverse.org/v1", words = query.split(/\s+/);
  for (const q of new Set([query, ...[3, 2, 1].map((n) => words.slice(0, n).join(" "))])) {
    const res = await fetch(`${api}/images/?q=${encodeURIComponent(q)}&license=cc0,pdm&category=photograph&mature=false&page_size=5`, { signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
    if (!res?.ok) return undefined;
    const { results } = (await res.json().catch(() => ({}))) as { results?: { url?: unknown; foreign_landing_url?: unknown }[] };
    for (const r of Array.isArray(results) ? results : []) {
      const img = typeof r.url === "string" ? await fetch(r.url, { signal: AbortSignal.timeout(20_000) }).catch(() => undefined) : undefined;
      const type = img?.headers.get("content-type") ?? "";
      if (img?.ok && /^image\/(jpeg|png|webp|avif)/.test(type) && Number(img.headers.get("content-length") ?? 0) < 20 << 20)
        return { bytes: Buffer.from(await img.arrayBuffer()), type, source: String(r.foreign_landing_url ?? r.url) };
    }
  }
  return undefined;
}

/** Gives every planned image a real file and size: the user's photo it names, else a stock photo for its search words (or alt), else the placeholder. */
export async function resolveImages(dir: string, plan: Plan, photos: Photo[], log: Log) {
  const own = new Map(photos.map((p) => [p.src, p]));
  const images = plan.pages.flatMap((p) => p.sections).flatMap((s) => s.images ?? []);
  for (const image of images.filter((i) => own.has(i.src))) Object.assign(image, { width: own.get(image.src)!.width, height: own.get(image.src)!.height });
  const wanted = images.filter((i) => !own.has(i.src));
  if (!wanted.length) return;
  const saved = await load(dir);
  await withPage(async (page) => {
    for (const image of wanted) {
      const t = Date.now(), query = (image.src.startsWith("stock:") ? image.src.slice(6) : image.alt).trim(), name = `stock-${hash(query)}.jpg`;
      if (query && (!saved[name] || !(await access(siteFile(dir, name)).then(() => true, () => false)))) {
        const hit = await stock(query);
        const size = hit && (await save(dir, page, hit.bytes, hit.type, name).catch(() => undefined));
        if (hit && size) saved[name] = { ...size, source: hit.source };
        else delete saved[name];
      }
      const found = saved[name] ? { src: `/images/${name}`, width: saved[name].width, height: saved[name].height } : PLACEHOLDER;
      Object.assign(image, found);
      await log({ step: "stock", ms: Date.now() - t, ok: found !== PLACEHOLDER, note: `"${query}" → ${found.src}${found === PLACEHOLDER ? " (no CC0 photo found; add your own to images/)" : ""}` });
    }
  });
  await store(dir, saved);
}
