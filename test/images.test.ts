import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launch } from "../src/browser.js";
import { resolveImages, userPhotos, type Photo } from "../src/images.js";
import { paths, type Event, type Plan, type SectionSpec } from "../src/store.js";

let dir = "", origin = "", server: Server, jpeg: Buffer;
const queries: string[] = [], events: Omit<Event, "t">[] = [];
const log = async (e: Omit<Event, "t">) => void events.push(e);

beforeAll(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 2000, height: 1000 } });
  await page.setContent(`<body style="margin:0;background:#c33">`);
  const wide = await page.screenshot();
  await page.setViewportSize({ width: 800, height: 600 });
  jpeg = await page.screenshot({ type: "jpeg" });
  await browser.close();
  dir = await mkdtemp(join(tmpdir(), "ui-images-"));
  await mkdir(join(dir, "images"));
  await writeFile(join(dir, "images", "Shop Front.PNG"), wide);
  await writeFile(join(dir, "images", "broken.jpg"), "not an image");
  await writeFile(join(dir, "images", "notes.txt"), "not a photo");
  // Openverse stand-in: "ramen bowl" finds one photo, anything else finds nothing.
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "", "http://x");
    if (url.pathname === "/photo.jpg") return void res.writeHead(200, { "content-type": "image/jpeg" }).end(jpeg);
    queries.push(url.search);
    const results = url.searchParams.get("q") === "ramen bowl" ? [{ url: `${origin}/photo.jpg`, foreign_landing_url: "https://example.org/ramen" }] : [];
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ results }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.UI_STOCK_URL = `${origin}/v1`;
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

it("re-encodes the user's photos at most 1600px wide, describes each once and says how to fix unreadable ones", async () => {
  const described: string[] = [];
  const describe = async (file: string) => (described.push(file), "a red shop front, empty wall across the top");
  const photos = await userPhotos(dir, describe, log);
  expect(photos).toEqual([{ src: expect.stringMatching(/^\/images\/\w{12}\.png$/), width: 1600, height: 800, about: "a red shop front, empty wall across the top" }]);
  // A PNG stores its width at byte 16.
  for (const root of [paths(dir).site, paths(dir).stage]) expect((await readFile(join(root, "public", photos[0]!.src))).readUInt32BE(16)).toBe(1600);
  expect(events).toContainEqual(expect.objectContaining({ step: "photo", ok: false, note: expect.stringMatching(/images\/broken\.jpg could not be read.*JPEG, PNG or WebP/) }));
  expect(await userPhotos(dir, describe, log)).toEqual(photos);
  expect(described).toHaveLength(1);
}, 60_000);

it("resolves planned images to the user's photo, a CC0 stock photo or the placeholder, each with its size", async () => {
  const section = (id: string, images: NonNullable<SectionSpec["images"]>): SectionSpec => ({ id, goal: "g", layout: { desktop: "d", mobile: "m" }, copy: "c", motion: [], images });
  const plan = { pages: [{ path: "/", sections: [
    section("Shop", [{ src: "/images/own.jpg", alt: "The shop" }, { src: "stock:ramen bowl", alt: "Ramen" }]),
    section("Menu", [{ src: "stock:unicorn", alt: "" }, { src: "/images/made-up.jpg", alt: "ramen bowl" }, { src: "stock:ramen bowl steam closeup", alt: "Steam" }]),
  ] }] } as Plan;
  const photos: Photo[] = [{ src: "/images/own.jpg", width: 1600, height: 900, about: "a shop front" }];
  await resolveImages(dir, plan, photos, log);
  const [shop, menu] = plan.pages[0]!.sections;
  const stock = { src: expect.stringMatching(/^\/images\/stock-\w{12}\.jpg$/), width: 800, height: 600 };
  expect(shop!.images).toEqual([{ src: "/images/own.jpg", alt: "The shop", width: 1600, height: 900 }, { ...stock, alt: "Ramen" }]);
  // No stock result means the placeholder; a made-up path is searched by its alt text, which here reuses the cached photo;
  // a query too long to match is retried with its first 3, then 2 words.
  expect(menu!.images).toEqual([{ src: "/demo/photo.svg", alt: "", width: 1200, height: 800 }, { ...stock, alt: "ramen bowl" }, { ...stock, alt: "Steam" }]);
  await access(join(paths(dir).stage, "public", shop!.images![1]!.src));
  expect(queries.map((q) => new URLSearchParams(q).get("q"))).toEqual(["ramen bowl", "unicorn", "ramen bowl steam closeup", "ramen bowl steam", "ramen bowl"]);
  expect(queries.every((q) => q.includes("license=cc0,pdm"))).toBe(true);
  expect(JSON.parse(await readFile(join(dir, ".ui", "images.json"), "utf8"))).toMatchObject({ [shop!.images![1]!.src.slice(8)]: { source: "https://example.org/ramen" } });
  expect(events).toContainEqual(expect.objectContaining({ step: "stock", ok: false, note: expect.stringContaining("add your own to images/") }));
}, 60_000);
