import type { ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import Type from "typebox";
import { serve } from "./browser.js";
import { build, clone } from "./flows.js";
import { intake } from "./intake.js";
import type { Report } from "./loop.js";
import { paths, runLog, type Event } from "./store.js";

// One vite dev server per site, reused across calls; promotion only copies files, so HMR shows each green section as it lands.
const servers = new Map<string, { url: string; child: ChildProcess }>();
async function preview(site: string) {
  const running = servers.get(site);
  if (running && running.child.exitCode === null) return running.url;
  const server = await serve(site, "dev");
  servers.set(site, server);
  return server.url;
}

const progress = (e: Omit<Event, "t">) =>
  `${e.ok ? "✓" : "✗"} ${e.step}${e.section ? ` ${e.section}` : ""}${e.round === undefined ? "" : ` (round ${e.round})`}${e.note ? ` — ${e.note.split("\n")[0]!.slice(0, 100)}` : ""}`;

const summary = (r: Report) => [
  `Preview: ${r.previewUrl}`,
  ...Object.entries(r.sections).map(([id, s]) => `- ${id}: ${s.status}${s.score === undefined ? "" : ` (${s.score}/10)`}${s.open[0] ? ` — ${s.open[0]}` : ""}`),
  ...(r.app.length ? [`Page-level: ${r.app.join("; ")}`] : []),
  `${r.usage.calls} model calls, ${r.usage.tokensIn + r.usage.tokensOut} tokens, ${r.usage.seconds}s. Details in .ui/.`,
].join("\n");

export default async function uiAgent(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ui",
    label: "UI Agent",
    description: "Designs, builds, recreates and fixes websites (React, Tailwind, Motion) with its own planner, builders and visual checks. Pass the user's request as written.",
    promptSnippet: "Create, restyle, clone, animate or check a website from a plain-language request",
    promptGuidelines: [
      "Use the ui tool for any request to create, redesign, recreate, animate or check a website or page; pass the user's words unchanged as request.",
      "Pass a reference URL or screenshot path to the ui tool as ref when the user wants a design recreated.",
    ],
    parameters: Type.Object({
      request: Type.String({ description: "What the user wants, in their words" }),
      ref: Type.Optional(Type.String({ description: "Reference URL or screenshot path to recreate" })),
      dir: Type.Optional(Type.String({ description: "Project folder (default: current folder)" })),
    }),
    async execute(_id, params, _signal, onUpdate, ctx) {
      const dir = resolve(ctx.cwd, params.dir ?? ".");
      const file = runLog(dir), lines: string[] = [];
      const log = async (e: Omit<Event, "t">) => {
        await file(e);
        lines.push(progress(e));
        onUpdate?.({ content: [{ type: "text", text: lines.slice(-8).join("\n") }], details: undefined });
      };
      // ponytail: the tool can't be cancelled mid-run yet; threading ctx.signal through the flows is the upgrade.
      // Models fill optional fields with "" (gpt-oss sends ref: ""), which must not turn a build into a clone.
      const { intent, usage } = await intake(dir, params.request, params.ref?.trim() || undefined);
      if (usage) await log({ step: "intake", role: "intake", model: usage.model, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, ms: 0, ok: true, note: intent.kind });
      let report: Report;
      if (intent.kind === "build") report = await build(dir, intent.instruction, { log });
      else if (intent.kind === "clone" && intent.ref) report = await clone(dir, intent.ref, intent.instruction, { log });
      else throw new Error(intent.kind === "clone" ? "Recreating a design needs a reference: pass the URL or screenshot path as ref." : `The ${intent.kind} flow isn't available yet; this version can build a new site or recreate a reference (pass ref).`);
      report.previewUrl = await preview(paths(dir).site);
      // Nested model usage goes into pi's session totals; self-hosted calls cost nothing.
      const { tokensIn: input, tokensOut: output } = report.usage, none = { cacheRead: 0, cacheWrite: 0 };
      return { content: [{ type: "text", text: summary(report) }], details: report, usage: { input, output, ...none, totalTokens: input + output, cost: { input: 0, output: 0, ...none, total: 0 } } };
    },
  });

  pi.registerCommand("ui", {
    description: "Ask the UI Agent to build, recreate or fix the site: /ui <request>",
    handler: async (args, ctx) => {
      if (!args.trim()) return ctx.ui.notify("Usage: /ui <what to build or change>", "warning");
      pi.sendUserMessage(`Call the ui tool with request: ${JSON.stringify(args.trim())}`, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
    },
  });

  const url = process.env.UI_LLM_URL;
  if (url) {
    const key = process.env.UI_LLM_KEY ?? "local";
    // Listed here rather than in refreshModels: pi gives extension loading plus model refresh 15 s in total, which a busy machine can exceed.
    const res = await fetch(`${url}/models`, { signal: AbortSignal.timeout(10_000), headers: { authorization: `Bearer ${key}` } }).catch(() => undefined);
    const free = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    if (!res?.ok) pi.on("session_start", async (_e, ctx) => ctx.ui.notify(`UI Agent: ${url}/models didn't answer (${res?.status ?? "no response"}), so the selfhosted provider is unavailable; check UI_LLM_URL and UI_LLM_KEY.`, "warning"));
    else pi.registerProvider("selfhosted", {
      name: "Self-hosted (UI Agent)",
      baseUrl: url,
      // pi reads "$NAME" and a leading "!" in apiKey as env/command references; escape both so the key stays a literal.
      apiKey: key.replaceAll("$", "$$$$").replace(/^!/, "$!"),
      api: "openai-completions",
      models: ((await res.json()) as { data: { id: string }[] }).data.map(({ id }) => ({ id, name: id, reasoning: false, input: ["text"], cost: free, contextWindow: 32_768, maxTokens: 8_192 })),
    });
  }
  pi.on("session_shutdown", async () => {
    for (const { child } of servers.values()) child.kill();
    servers.clear();
  });
}
