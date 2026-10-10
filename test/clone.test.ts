import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { capture, type Reference } from "../src/capture.js";
import { analyze, clone } from "../src/flows.js";
import type { Report } from "../src/loop.js";
import { loadPlan, paths, removeProject, type Event, type Plan } from "../src/store.js";
import { mockLlm } from "./mock-llm.js";

// A PNG stores width and height at bytes 16 and 20.
const pngSize = async (file: string) => ((b) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) }))(await readFile(file));
const images = (body: string) => body.match(/data:image\/png;base64,/g)?.length ?? 0;
const description = JSON.stringify({ role: "hero", layout: "single column, left aligned", hierarchy: "headline then button", typography: "64px serif headline", spacing: "96px vertical padding", motion: "fade up on enter (est.)", components: ["pill button"] });

let server: Server, url = "";
beforeAll(async () => {
  const page = await readFile(new URL("./fixtures/reference/index.html", import.meta.url));
  server = createServer((_, res) => res.writeHead(200, { "content-type": "text/html" }).end(page));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("capture", () => {
  let dir = "", ref: Reference;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ui-ref-"));
    ref = await capture(url, dir);
  }, 120_000);
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("measures facts from computed styles, finding sections through single-child wrappers", () => {
    const { facts } = ref;
    expect(facts.sections).toHaveLength(4);
    expect(facts.sections.map((s) => s.y)).toEqual([...facts.sections.map((s) => s.y)].sort((a, b) => a - b));
    expect(facts.fonts.map((f) => f.family)).toEqual(expect.arrayContaining(["Arial", "Georgia"]));
    expect(facts.colors.background).toEqual(expect.arrayContaining(["#1d3557", "#a8dadc", "#111111"]));
    expect(facts.sizes).toEqual(expect.arrayContaining([64, 40, 18]));
    expect(facts.radii).toEqual(expect.arrayContaining(["pill", "12px"]));
    expect(facts.headings[0]).toEqual({ tag: "h1", text: "Northwind beans, roasted at dawn", size: 64, weight: 700 });
    expect(facts.estimated).toBe(false);
  });

  it("saves the fold, one crop per section at 1440 and 390px, and 3 entrance frames per section", async () => {
    expect(await pngSize(ref.fold)).toEqual({ width: 1440, height: 900 });
    expect(ref.crops).toHaveLength(4);
    for (const [i, crop] of ref.crops.entries()) expect(await pngSize(crop)).toEqual({ width: 1440, height: ref.facts.sections[i]!.height });
    expect(ref.mobile).toHaveLength(4);
    for (const crop of ref.mobile) expect((await pngSize(crop)).width).toBe(390);
    expect(ref.frames.map((f) => f.length)).toEqual([3, 3, 3, 3]);
    for (const frame of ref.frames.flat()) await stat(frame);
  });

  it("captures the primary CTA before and after hover", async () => {
    expect(ref.hover?.section).toBe(0);
    expect((await readFile(ref.hover!.before)).equals(await readFile(ref.hover!.after))).toBe(false);
  });

  it("caches per URL", async () => {
    const before = (await stat(join(dir, "ref.json"))).mtimeMs;
    expect(await capture(url, dir)).toEqual(ref);
    expect((await stat(join(dir, "ref.json"))).mtimeMs).toBe(before);
  });
});

describe("clone flow", () => {
  const ids = ["Opening", "Reasons", "Voices", "Signup"];
  const section = (id: string, ref: number) => ({ id, goal: `Recreate reference section ${ref}`, layout: { desktop: "as reference", mobile: "stacked" }, copy: `${id} copy for Halden.`, motion: ["Reveal"], ref });
  const plan = (refs: number[]) => JSON.stringify({
    name: "Halden",
    direction: { theme: "deep navy and coral", typePairing: "Fraunces with Work Sans", hero: "statement on navy", rhythm: "dark, light, tint, dark", signature: ["pill button", "tinted quote band", "white cards"], motionEnergy: "calm" },
    design: "# Halden\n## Theme\nNavy hero, coral pill button.",
    tokens: { colors: { bg: "#fafafa", fg: "#1d3557", muted: "#4a5568", surface: "#a8dadc", accent: "#b42318", line: "#d6d6d6" }, fonts: { display: "Fraunces", body: "Work Sans" }, radius: "12px" },
    pages: [{ path: "/", sections: ids.map((id, i) => section(id, refs[i]!)) }],
  });
  const builder = (id: string) => `\`\`\`tsx\nimport { Reveal } from "../kit/motion";\n\nexport default function ${id}() {\n  return <section className="px-5 py-16"><Reveal><h2 className="font-display text-3xl">${id}</h2><p className="text-muted">Plain words about ${id}.</p></Reveal></section>;\n}\n\`\`\``;
  let dir = "", report: Report, saved: Plan, events: Event[] = [];
  let mock: Awaited<ReturnType<typeof mockLlm>>;

  beforeAll(async () => {
    mock = await mockLlm(
      {
        analyst: { _: [description] },
        director: { _: [plan([0, 1, 7, 3]), plan([0, 1, 2, 3])] },
        builder: Object.fromEntries(ids.map((id) => [id, [builder(id)]])),
        critic: Object.fromEntries(ids.map((id) => [id, [JSON.stringify({ score: 8, slop: [], issues: [] })]])),
      },
      { Fraunces: "weights", "Work Sans": "weights" },
    );
    Object.assign(process.env, { UI_LLM_URL: mock.url, UI_FONTS_URL: mock.origin, UI_MODEL_ANALYST: "mock-analyst", UI_MODEL_DIRECTOR: "mock-director", UI_MODEL_BUILDER: "mock-builder", UI_MODEL_CRITIC: "mock-critic", UI_PARALLEL: "4" });
    dir = await mkdtemp(join(tmpdir(), "ui-clone-"));
    const logged: Event[] = [];
    report = await clone(dir, url, "Recreate this design for Halden, a small coffee roaster.", { log: async (e) => void logged.push({ t: 0, ...e }) });
    events = logged;
    saved = (await loadPlan(dir))!;
  }, 300_000);

  afterAll(async () => {
    await mock.close();
    await removeProject(paths(dir).site);
    await removeProject(paths(dir).stage);
    await rm(dir, { recursive: true, force: true });
  });

  it("analyses each reference section from its crops and frames, the CTA's section also from its hover", () => {
    const calls = mock.requests.filter((r) => r.role === "analyst").map((r) => r.body);
    expect(calls).toHaveLength(4);
    expect(calls.map(images).sort()).toEqual([5, 5, 5, 7]);
    expect(events.filter((e) => e.role === "analyst").map((e) => e.section).sort()).toEqual(["ref-0", "ref-1", "ref-2", "ref-3"]);
  });

  it("gives the director facts and descriptions but none of the reference's copy or brand", () => {
    const [first, retry] = mock.requests.filter((r) => r.role === "director").map((r) => r.body);
    expect(first).toContain("## Reference");
    expect(first).toContain("#1d3557");
    expect(first).toContain("3: {");
    expect(first).not.toMatch(/Northwind/);
    expect(retry).toContain("the reference sections are numbered 0 to 3");
  });

  it("plans one section per reference section with the right crop index", () => {
    expect(saved.pages[0]!.sections.map((s) => [s.id, s.ref])).toEqual(ids.map((id, i) => [id, i]));
    expect(Object.values(report.sections).map((s) => s.status)).toEqual(ids.map(() => "pass"));
  });

  it("shows the critic each section's own reference crop", async () => {
    const crop = (await readFile(join(paths(dir).ref, "section-2.png"))).toString("base64");
    const review = mock.requests.find((r) => r.role === "critic" && r.key === "Voices")!.body;
    expect(images(review)).toBe(3);
    expect(review).toContain(crop);
  });
});

describe("screenshot-only reference", () => {
  let dir = "", mock: Awaited<ReturnType<typeof mockLlm>>;
  const band = (top: number, bottom: number) => ({ top, bottom, ...(JSON.parse(description) as object) });
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ui-shot-"));
    mock = await mockLlm({ analyst: { _: [JSON.stringify({ sections: [band(0, 0.6), band(0.5, 1)], palette: ["#1d3557"], fonts: ["serif"] }), JSON.stringify({ sections: [band(0, 0.5), band(0.5, 1)], palette: ["#1d3557"], fonts: ["serif"] })] } });
    Object.assign(process.env, { UI_LLM_URL: mock.url, UI_MODEL_ANALYST: "mock-analyst" });
  });
  afterAll(async () => {
    await mock.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("asks the analyst for ordered bands, crops them in code and marks the facts as estimates", async () => {
    const shot = join(dir, "page.png");
    await capture(url, join(dir, "source")).then((r) => readFile(r.fold)).then((png) => import("node:fs/promises").then((fs) => fs.writeFile(shot, png)));
    const { ref, descriptions } = await analyze(dir, shot, async () => {});
    expect(mock.requests.filter((r) => r.role === "analyst")[1]!.body).toContain("without overlapping");
    expect(ref.facts.estimated).toBe(true);
    expect(ref.facts.sections).toEqual([{ y: 0, height: 450 }, { y: 450, height: 450 }]);
    for (const crop of ref.crops) expect(await pngSize(crop)).toEqual({ width: 1440, height: 450 });
    expect(descriptions).toHaveLength(2);
  }, 120_000);
});
