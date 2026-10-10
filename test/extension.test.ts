import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Report } from "../src/loop.js";
import { paths, removeProject } from "../src/store.js";
import { mockLlm } from "./mock-llm.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
const ids = ["Hero", "Beans", "Subscribe"];
const plan = JSON.stringify({
  name: "Halden",
  direction: { theme: "warm paper", typePairing: "Fraunces with Work Sans", hero: "oversized statement", rhythm: "wide, narrow, wide", signature: ["roast stamps", "margin notes", "rust rules"], motionEnergy: "calm" },
  design: "# Halden\n## Theme\nWarm paper, ink and rust.",
  tokens: { colors: { bg: "#f6f3ee", fg: "#1b1a17", muted: "#625d55", surface: "#ebe5db", accent: "#b4400f", line: "#d6cec1" }, fonts: { display: "Fraunces", body: "Work Sans" }, radius: "1rem" },
  pages: [{ path: "/", sections: ids.map((id) => ({ id, goal: `Show ${id}`, layout: { desktop: "single column", mobile: "single column" }, copy: `${id} copy.`, motion: ["Reveal"] })) }],
});
const section = (id: string) => `\`\`\`tsx\nimport { Reveal } from "../kit/motion";\n\nexport default function ${id}() {\n  return <section className="mx-auto max-w-3xl px-5 py-16"><Reveal><h2 className="font-display text-3xl">${id}</h2><p className="mt-4 text-muted">A plain paragraph about ${id.toLowerCase()}.</p></Reveal></section>;\n}\n\`\`\``;
type PiEvent = { type: string; toolName?: string; args?: unknown; isError?: boolean; result?: { content: { text: string }[]; details: Report; usage: { totalTokens: number } }; partialResult?: { content: { text: string }[] } };

// Runs the real pi CLI in print/JSON mode with only our extension loaded, isolated from the user's ~/.pi.
async function pi(cwd: string, env: Record<string, string>, prompt: string) {
  const args = [cli, "-p", "--mode", "json", "--no-session", "-ne", "-e", join(root, "src/index.ts"), "--provider", "selfhosted", "--model", "mock-main", prompt];
  // stdin must be closed: pi -p reads piped stdin as part of the prompt and would wait for it forever.
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr.on("data", (d: Buffer) => (err += d.toString()));
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  return { code, err, events: out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as PiEvent) };
}

describe("pi -e src/index.ts", () => {
  let mock: Awaited<ReturnType<typeof mockLlm>>, dir = "", env: Record<string, string> = {};
  let run: Awaited<ReturnType<typeof pi>>;
  beforeAll(async () => {
    mock = await mockLlm(
      {
        // The args mirror what gpt-oss:120b really sends: optional fields as empty strings.
        main: { _: [{ tool: "ui", args: { request: "Make a small one-page site for Halden, a coffee roaster.", ref: "", dir: "." } }, "Done: the Halden site is live at the preview URL."] },
        director: { _: [plan] },
        builder: Object.fromEntries(ids.map((id) => [id, [section(id)]])),
        critic: Object.fromEntries(ids.map((id) => [id, [JSON.stringify({ score: 8, slop: [], issues: [] })]])),
      },
      { Fraunces: "weights", "Work Sans": "weights" },
    );
    dir = await mkdtemp(join(tmpdir(), "ui-pi-"));
    env = { UI_LLM_URL: mock.url, UI_FONTS_URL: mock.origin, UI_MODEL_DIRECTOR: "mock-director", UI_MODEL_BUILDER: "mock-builder", UI_MODEL_CRITIC: "mock-critic", UI_PARALLEL: "3",
      PI_CODING_AGENT_DIR: join(dir, ".pi-agent"), PI_OFFLINE: "1", PI_TELEMETRY: "0" };
    run = await pi(dir, env, "Make me a small website for my coffee roastery, Halden.");
  }, 240_000);
  afterAll(async () => {
    await mock.close();
    await removeProject(paths(dir).site);
    await removeProject(paths(dir).stage);
    await rm(dir, { recursive: true, force: true });
  });

  it("lists the self-hosted models and lets the main agent call the ui tool", () => {
    expect(run.code, run.err).toBe(0);
    expect(run.events.find((e) => e.type === "tool_execution_start")).toMatchObject({ toolName: "ui", args: { request: expect.stringContaining("Halden") } });
  });

  it("streams progress lines and returns a short report with the full Report in details", () => {
    const progress = run.events.filter((e) => e.type === "tool_execution_update").map((e) => e.partialResult!.content[0]!.text).join("\n");
    expect(progress).toMatch(/✓ direct/);
    expect(progress).toMatch(/✓ promote \(round 0\) — Hero,Beans,Subscribe/);
    const end = run.events.find((e) => e.type === "tool_execution_end")!;
    expect(end.isError).toBe(false);
    const text = end.result!.content[0]!.text;
    expect(text).toMatch(/^Preview: http:\/\/127\.0\.0\.1:\d+\/\n- Hero: pass \(8\/10\)\n- Beans: pass \(8\/10\)\n- Subscribe: pass \(8\/10\)\n7 model calls/);
    expect(end.result!.details.previewUrl).toBe(text.split("\n")[0]!.slice("Preview: ".length));
    expect(end.result!.details.usage.calls).toBe(7);
    expect(end.result!.usage.totalTokens).toBeGreaterThan(0);
  });

  // Print mode exits before a turn queued by a command can run, so /ui is driven over RPC, which stays alive like the interactive TUI.
  it("/ui hands the request to the main agent as a ui tool call", async () => {
    const before = mock.requests.filter((r) => r.role === "main").length;
    const args = [cli, "--mode", "rpc", "--no-session", "-ne", "-e", join(root, "src/index.ts"), "--provider", "selfhosted", "--model", "mock-main"];
    const child = spawn(process.execPath, args, { cwd: dir, env: { ...process.env, ...env }, stdio: ["pipe", "ignore", "ignore"] });
    child.stdin.write(JSON.stringify({ type: "prompt", message: "/ui make the hero bigger" }) + "\n");
    const asked = () => mock.requests.filter((r) => r.role === "main").slice(before)[0]?.body;
    for (let waited = 0; !asked() && waited < 60_000; waited += 200) await new Promise((r) => setTimeout(r, 200));
    child.kill();
    expect(asked()).toContain('Call the ui tool with request: \\"make the hero bigger\\"');
  }, 120_000);
});
