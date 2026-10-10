import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { direct } from "../src/agents.js";
import { assemble, build } from "../src/flows.js";
import { node, SECTIONS } from "../src/gates.js";
import type { Report } from "../src/loop.js";
import { loadPlan, paths, removeProject, type Event, type Plan } from "../src/store.js";
import { mockLlm } from "./mock-llm.js";

const ids = ["Hero", "Farms", "Roasting", "Brew", "Subscribe"];
const design = ["# Halden", "## Theme", "Warm paper, ink and rust.", "## Color", "Rust accent on one action per screen.", "## Typography", "Fraunces headings, Work Sans body."].join("\n");
const section = (id: string, extra: object = {}) => ({ id, goal: `Explain ${id}`, layout: { desktop: "single column", mobile: "single column" }, copy: `${id} copy.`, motion: ["Reveal"], ...extra });
const directorReply = (sections: object[]) => JSON.stringify({
  name: "Halden",
  direction: { theme: "warm paper", typePairing: "Fraunces with Work Sans", hero: "oversized statement", rhythm: "wide, narrow, wide", signature: ["roast stamps", "margin notes", "rust rules"], motionEnergy: "calm" },
  design,
  tokens: { colors: { bg: "#f6f3ee", fg: "#1b1a17", muted: "#625d55", surface: "#ebe5db", accent: "#b4400f", line: "#d6cec1" }, fonts: { display: "Fraunces", body: "Work Sans" }, radius: "1rem" },
  pages: [{ path: "/", sections }],
});
const builderReply = (id: string) => `\`\`\`tsx
import { Reveal } from "../kit/motion";

export default function ${id}() {
  return (
    <section className="mx-auto max-w-3xl px-5 py-16">
      <Reveal>
        <h2 className="font-display text-3xl">${id}</h2>
        <p className="mt-4 text-muted">A plain paragraph about ${id.toLowerCase()}.</p>
      </Reveal>
    </section>
  );
}
\`\`\``;

describe("build flow with a mock director and builders", () => {
  let dir = "", report: Report, events: Event[] = [], plan: Plan;
  let mock: Awaited<ReturnType<typeof mockLlm>>;

  beforeAll(async () => {
    const tooManyShowpieces = ids.map((id, i) => section(id, i < 2 ? { showpiece: { kind: "pinned", idea: "story", poster: "a still" } } : {}));
    const valid = ids.map((id) => section(id, id === "Brew" ? { motion: ["Stagger", "Explode"] } : {}));
    mock = await mockLlm(
      {
        director: { _: [directorReply(tooManyShowpieces), directorReply(valid)] },
        builder: Object.fromEntries(ids.map((id) => [id, [builderReply(id)]])),
        critic: Object.fromEntries(ids.map((id) => [id, [JSON.stringify({ score: 8, slop: [], issues: [{ severity: "low", fix: "tighten leading on the h2: leading-tight" }] })]])),
      },
      { Fraunces: "weights", "Work Sans": "plain" },
    );
    Object.assign(process.env, { UI_LLM_URL: mock.url, UI_FONTS_URL: mock.origin, UI_MODEL_DIRECTOR: "mock-director", UI_MODEL_BUILDER: "mock-builder", UI_MODEL_CRITIC: "mock-critic", UI_PARALLEL: "3" });
    dir = await mkdtemp(join(tmpdir(), "ui-build-"));
    report = await build(dir, "A one-page site for Halden, a small coffee roaster that ships beans the day they are roasted.");
    const [log] = await readdir(paths(dir).runs);
    events = (await readFile(join(paths(dir).runs, log!), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as Event);
    plan = (await loadPlan(dir))!;
  }, 300_000);

  afterAll(async () => {
    await mock.close();
    await removeProject(paths(dir).site);
    await removeProject(paths(dir).stage);
    await rm(dir, { recursive: true, force: true });
  });

  it("retries the director once when its plan breaks a rule, then saves a validated plan", () => {
    const calls = mock.requests.filter((r) => r.role === "director");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toMatch(/max one per page/);
    expect(calls[0]!.body).not.toContain("## Style preset");
    expect(plan.pages[0]!.sections.map((s) => s.id)).toEqual(ids);
    expect(plan.pages[0]!.sections.find((s) => s.id === "Brew")!.motion).toEqual(["Stagger"]);
    expect(plan).not.toHaveProperty("design");
  });

  it("writes DESIGN.md, tokens and the fonts that load", async () => {
    expect(await readFile(paths(dir).design, "utf8")).toBe(design);
    const tokens = await readFile(join(paths(dir).site, "src", "tokens.css"), "utf8");
    expect(tokens).toContain("--color-accent: #b4400f;");
    expect(tokens).toContain('--font-display: "Fraunces", ui-sans-serif');
    expect(tokens).toContain('--font-body: "Work Sans", ui-sans-serif');
    const html = await readFile(join(paths(dir).site, "index.html"), "utf8");
    expect(html).toContain("family=Fraunces:wght@400..700&family=Work+Sans&display=swap");
  });

  it("builds every section in parallel, gates them and promotes all five", async () => {
    expect(Object.values(report.sections).map((s) => [s.status, s.score, s.open])).toEqual(ids.map(() => ["pass", 8, ["tighten leading on the h2: leading-tight"]]));
    const registry = await readFile(join(paths(dir).site, SECTIONS, "index.ts"), "utf8");
    expect([...registry.matchAll(/id: "(\w+)"/g)].map((m) => m[1])).toEqual(ids);
    const site = await node(paths(dir).site, "vite/bin/vite.js", "build", "--logLevel", "error");
    expect(site.ok, site.out).toBe(true);
  });

  it("logs the director call and one event per builder and critic call, with tokens", () => {
    const model = events.filter((e) => e.role);
    expect(model.map((e) => e.role)).toEqual(["director", ...ids.map(() => "builder"), ...ids.map(() => "critic")]);
    for (const e of model) expect(e.tokensIn! > 0 && e.tokensOut! > 0 && e.ok, JSON.stringify(e)).toBe(true);
    expect(report.usage.calls).toBe(11);
  });

  it("passes a preset to the director only when one is asked for", async () => {
    await direct("Same brief.", { kit: "- Reveal({ children }) — doc", preset: "# Preset: Editorial serif" });
    expect(mock.requests.at(-1)!.body).toContain("## Style preset\\n# Preset: Editorial serif");
    await expect(build(join(dir, "nowhere"), "brief", { preset: "../secrets" })).rejects.toThrow(/Unknown preset/);
    await expect(access(join(dir, "nowhere"))).rejects.toThrow();
  });

  it("falls back to the system font stack and logs it when a font doesn't exist", async () => {
    const logged: Omit<Event, "t">[] = [];
    await assemble(dir, { ...plan.tokens, fonts: { display: "Nonexistent Grotesk", body: "Work Sans" } }, async (e) => void logged.push(e));
    const tokens = await readFile(join(paths(dir).stage, "src", "tokens.css"), "utf8");
    expect(tokens).toMatch(/--font-display: ui-sans-serif/);
    expect(logged).toEqual([expect.objectContaining({ step: "fonts", ok: false, note: expect.stringContaining("Nonexistent Grotesk") })]);
    expect(await readFile(join(paths(dir).stage, "index.html"), "utf8")).toContain("family=Work+Sans&display=swap");
  });
});
