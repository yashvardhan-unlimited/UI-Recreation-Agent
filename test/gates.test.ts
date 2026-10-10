import { access, cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { audit } from "../src/browser.js";
import { gates, node, type Issue } from "../src/gates.js";
import { copyProject, removeProject } from "../src/store.js";

const kit = fileURLToPath(new URL("../kit", import.meta.url));
const fixtures = fileURLToPath(new URL("./fixtures/sections", import.meta.url));

// Each fixture plants exactly one problem; the pattern is what its fix message must say.
const expected: Record<string, [Issue["source"], RegExp]> = {
  BadType: ["type", /TS2322/],
  RawHex: ["lint", /token classes/],
  FramerImport: ["lint", /Import only from/],
  AnimatedWidth: ["lint", /transform and opacity/],
  HScreen: ["lint", /min-h-svh/],
  Overflow: ["runtime", /past the viewport edge/],
  HiddenText: ["runtime", /never became visible/],
  Throws: ["runtime", /Runtime error/],
  ImgNoSize: ["lint", /alt, width and height/],
  MissingImage: ["lint", /hero-screenshot\.png doesn't exist/],
  EagerThree: ["lint", /Scene3D load=/],
};

describe("gates + browser audit", () => {
  let tmp = "", stage = "", ids: string[] = [], mounted: string[] = [], issues: Issue[] = [];

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "ui-gates-"));
    stage = join(tmp, "stage");
    await copyProject(kit, stage);
    const sections = join(stage, "src", "sections");
    await rm(sections, { recursive: true });
    await cp(fixtures, sections, { recursive: true });
    ids = (await readdir(sections)).map((f) => f.replace(".tsx", "")).sort();
    const gate = await gates(stage, ids);
    mounted = gate.mounted;
    issues = [...gate.issues, ...(await audit(stage, { sections: mounted, shots: join(tmp, "shots") }))];
    console.log(issues.map((i) => `${i.section} [${i.source}/${i.severity}] ${i.fix.split("\n")[0]}`).join("\n"));
  }, 240_000);

  afterAll(() => removeProject(tmp));

  it.each(Object.entries(expected))("reports %s with a fix", (id, [source, fix]) => {
    expect(issues.filter((i) => i.section === id && i.source === source).map((i) => i.fix)).toContainEqual(expect.stringMatching(fix));
  });

  it("finds nothing wrong with the clean section and screenshots it", async () => {
    expect(issues.filter((i) => i.section === "Clean")).toEqual([]);
    // A PNG stores its width at byte 16; crops are CSS-pixel sized, so never wider than their viewport.
    const width = async (w: string) => (await readFile(join(tmp, "shots", w, "Clean.png"))).readUInt32BE(16);
    expect(await width("390")).toBeLessThanOrEqual(390);
    expect(await width("1440")).toBeLessThanOrEqual(1440);
  });

  it("flags three.js in the entry chunk as a page-level build issue", () => {
    expect(issues).toContainEqual(expect.objectContaining({ section: "_app", source: "build", fix: expect.stringMatching(/entry chunk/) }));
  });

  it("runs the stage's tools from a relative project path too", async () => {
    // The eval passes relative folders; a doubled path once made every build fail instantly.
    const run = await node("kit", "typescript/bin/tsc", "--version");
    expect(run, run.out).toMatchObject({ ok: true, out: expect.stringMatching(/Version \d/) });
  });

  it("builds the page with the type-error section left out", async () => {
    expect(mounted).toEqual(ids.filter((id) => id !== "BadType"));
    await access(join(stage, "dist", "index.html"));
    expect(await readFile(join(stage, "src", "sections", "index.ts"), "utf8")).not.toContain("BadType");
  });
});
