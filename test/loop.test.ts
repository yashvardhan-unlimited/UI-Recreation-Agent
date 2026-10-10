import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { node, SECTIONS, writeRegistry } from "../src/gates.js";
import { loop, type Report } from "../src/loop.js";
import { copyProject, paths, removeProject, runLog, savePlan, syncStage, type Event, type Plan, type SectionSpec } from "../src/store.js";
import { mockLlm } from "./mock-llm.js";

const kit = fileURLToPath(new URL("../kit", import.meta.url));
const verdict = (score: number, issues: { severity: string; fix: string }[] = []) => JSON.stringify({ score, slop: [], issues });
const HEADLINE_FIX = "h2 is text-3xl at 1440px and reads as body copy; use text-4xl md:text-6xl";
const fixture = async (name: string) => "```tsx\n" + (await readFile(new URL(`./fixtures/builder/${name}.tsx`, import.meta.url), "utf8")).trim() + "\n```";
const spec = (id: string): SectionSpec => ({ id, goal: "Show one fact about the roastery", layout: { desktop: "single column", mobile: "single column" }, copy: "Roasted on Tuesday.", motion: ["Reveal"] });
const plan: Plan = {
  name: "Halden",
  direction: { theme: "warm paper", typePairing: "serif display, sans body", hero: "big statement", rhythm: "airy", signature: ["roast dates"], motionEnergy: "calm" },
  tokens: { colors: { bg: "#f6f3ee", fg: "#1b1a17", muted: "#625d55", surface: "#ebe5db", accent: "#b4400f", line: "#d6cec1" }, fonts: { display: "Georgia", body: "system-ui" }, radius: "1rem" },
  pages: [{ path: "/", sections: ["Good", "TypeFix", "OverflowFix", "Broken"].map(spec) }],
};

describe("loop with a mock builder and critic", () => {
  let dir = "", report: Omit<Report, "previewUrl">, events: Event[] = [];
  const siteBuilds: { after: string; ok: boolean; out: string }[] = [];
  let mock: Awaited<ReturnType<typeof mockLlm>>;

  beforeAll(async () => {
    mock = await mockLlm({
      builder: {
        Good: [await fixture("Good"), await fixture("Good.2")],
        TypeFix: [await fixture("TypeFix.1"), await fixture("TypeFix.2")],
        OverflowFix: [await fixture("OverflowFix.1"), await fixture("OverflowFix.2"), await fixture("OverflowFix.3")],
        // The two prose replies are one call and its retry, so that fix fails as a model error.
        Broken: [await fixture("Broken.1"), "Sorry, I cannot help with that.", "I still cannot.", await fixture("Broken.2")],
      },
      // Good fails its first review with a high-severity issue and passes once the builder applies the fix.
      critic: { Good: [verdict(8, [{ severity: "high", fix: HEADLINE_FIX }]), verdict(8)], TypeFix: [verdict(8)], OverflowFix: [verdict(7)], Broken: [verdict(9)] },
    });
    Object.assign(process.env, { UI_LLM_URL: mock.url, UI_MODEL_BUILDER: "mock-builder", UI_MODEL_CRITIC: "mock-critic", UI_PARALLEL: "2", UI_ROUNDS: "3", UI_PASS_SCORE: "7" });

    dir = await mkdtemp(join(tmpdir(), "ui-loop-"));
    const { site } = paths(dir);
    await copyProject(kit, site);
    await rm(join(site, SECTIONS), { recursive: true });
    await mkdir(join(site, SECTIONS));
    await writeRegistry(site, []);
    await syncStage(dir);
    await savePlan(dir, plan);
    await writeFile(paths(dir).design, "# Halden\nWarm paper background, serif headings, calm motion.\n");

    const buildSite = async (after: string) => siteBuilds.push({ after, ...(await node(site, "vite/bin/vite.js", "build", "--logLevel", "error")) });
    await buildSite("start");
    const base = runLog(dir);
    report = await loop(dir, async (e) => {
      await base(e);
      if (e.step === "promote") await buildSite(`promote round ${e.round}`);
    });
    const [log] = await readdir(paths(dir).runs);
    events = (await readFile(join(paths(dir).runs, log!), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as Event);
  }, 300_000);

  afterAll(async () => {
    await mock.close();
    await removeProject(paths(dir).site);
    await removeProject(paths(dir).stage);
    await rm(dir, { recursive: true, force: true });
  });

  it("ends with three green sections and the always-broken one excluded", () => {
    expect(Object.fromEntries(Object.entries(report.sections).map(([id, s]) => [id, s.status]))).toEqual({ Good: "fixed", TypeFix: "fixed", OverflowFix: "fixed", Broken: "excluded" });
    expect(Object.fromEntries(Object.entries(report.sections).map(([id, s]) => [id, s.score]))).toEqual({ Good: 8, TypeFix: 8, OverflowFix: 7, Broken: undefined });
    expect(report.sections.Broken!.open.join("\n")).toMatch(/Runtime error/);
  });

  it("promotes exactly the green sections, in plan order, as their fixed versions", async () => {
    const { site } = paths(dir);
    const registry = await readFile(join(site, SECTIONS, "index.ts"), "utf8");
    expect([...registry.matchAll(/id: "(\w+)"/g)].map((m) => m[1])).toEqual(["Good", "TypeFix", "OverflowFix"]);
    expect(await readFile(join(site, SECTIONS, "TypeFix.tsx"), "utf8")).not.toContain(": number");
    expect(await readFile(join(site, SECTIONS, "OverflowFix.tsx"), "utf8")).toContain("max-w-full");
  });

  it("keeps site/ building at every point", () => {
    expect(siteBuilds.map((b) => b.after)).toEqual(["start", "promote round 0", "promote round 1", "promote round 2", "promote round 3"]);
    for (const b of siteBuilds) expect(b, b.out).toMatchObject({ ok: true });
  });

  it("logs one event per model call with token counts", () => {
    const calls = events.filter((e) => e.role === "builder");
    const perSection = Object.fromEntries(["Good", "TypeFix", "OverflowFix", "Broken"].map((id) => [id, calls.filter((e) => e.section === id).length]));
    expect(perSection).toEqual({ Good: 2, TypeFix: 2, OverflowFix: 3, Broken: 4 });
    expect(calls.filter((e) => !e.ok).map((e) => e.section)).toEqual(["Broken"]);
    for (const e of events.filter((e) => e.role)) expect(e.tokensIn! > 0 && e.tokensOut! > 0, JSON.stringify(e)).toBe(true);
    expect(mock.requests.filter((r) => r.role === "builder")).toHaveLength(12);
    expect(report.usage.calls).toBe(11 + 4);
  });

  it("judges only sections that passed gates and changed since they last passed", () => {
    const judged = (round: number) => events.filter((e) => e.role === "critic" && e.round === round).map((e) => e.section).sort();
    // Round 0: only Good passes gates and is rejected. Round 1: Good's fix and TypeFix's fix. Round 2: OverflowFix's fix. Round 3: nothing changed.
    expect([0, 1, 2, 3].map(judged)).toEqual([["Good"], ["Good", "TypeFix"], ["OverflowFix"], []]);
    expect(events.find((e) => e.role === "critic" && e.round === 0)!.note).toBe("score 8, fail");
  });

  it("feeds a failing verdict's issues to the builder and sends the critic both crops", () => {
    expect(mock.requests.find((r) => r.role === "builder" && r.key === "Good" && r.n === 1)!.body).toContain(HEADLINE_FIX);
    const review = mock.requests.find((r) => r.role === "critic")!.body;
    expect(review.match(/data:image\/png;base64,/g)).toHaveLength(2);
    expect(review.indexOf("## Direction card")).toBeLessThan(review.indexOf("## Section spec"));
  });

  it("sends fix calls the current file and only that section's issues, stable context first", () => {
    const fix = mock.requests.find((r) => r.key === "TypeFix" && r.n === 1)!.body;
    const at = (s: string) => fix.indexOf(s);
    expect(at("TS2322")).toBeGreaterThan(-1);
    expect(at("## DESIGN.md")).toBeLessThan(at("## Kit API"));
    expect(at("## Kit API")).toBeLessThan(at("## Current file"));
    expect(at("## Current file")).toBeLessThan(at("## Issues to fix"));
    expect(at("## Issues to fix")).toBeLessThan(at("## Section spec"));
    expect(fix).not.toContain("OverflowFix");
  });
});
