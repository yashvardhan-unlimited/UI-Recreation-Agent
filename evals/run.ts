// Eval harness (§13): runs every brief (and every reference with a URL) headless through the real flows,
// then writes results.csv and prints a summary table. Each item's result.json is kept, so a rerun with the same
// --out resumes where the last one stopped. Usage: npm run eval -- [--out evals/out/<name>] [--only id,id]
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { build, clone } from "../src/flows.js";
import type { Report } from "../src/loop.js";
import { paths, type Event } from "../src/store.js";

type Item = { id: string; kind: string; brief: string; preset?: string; url?: string };
type Result = { id: string; kind: string; seconds: number; report?: Report; error?: string };
export type Row = {
  id: string; kind: string; status: string; sections: number; green: number;
  first_round_gate_pass_rate: number | ""; rounds_to_green: number | ""; mean_critic_score: number | "";
  slop_findings: number; rollbacks: number; excluded: number; calls: number; tokens_in: number; tokens_out: number; wall_s: number;
};

const here = fileURLToPath(new URL(".", import.meta.url));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** One CSV row from a run's report and its event log. */
export function metrics(result: Result, events: Omit<Event, "t">[]): Row {
  const sections = result.report ? Object.values(result.report.sections) : [];
  const ids = result.report ? Object.keys(result.report.sections) : [];
  const critic = events.filter((e) => e.step === "critic");
  // Gates run on every section each round; in round 0 every section that passed them is judged, so critic events count the gate passes.
  const gatePassed = new Set(critic.filter((e) => e.round === 0).map((e) => e.section)).size;
  const greenAt = events.find((e) => e.step === "promote" && ids.length > 0 && ids.every((id) => (e.note ?? "").split(",").includes(id)))?.round;
  const scores = sections.flatMap((s) => (s.score === undefined ? [] : [s.score]));
  return {
    id: result.id,
    kind: result.kind,
    status: result.error ? `error: ${result.error.split("\n")[0]!.slice(0, 120)}` : "ok",
    sections: ids.length,
    green: sections.filter((s) => s.status === "pass" || s.status === "fixed").length,
    first_round_gate_pass_rate: ids.length ? round2(gatePassed / ids.length) : "",
    rounds_to_green: greenAt ?? "",
    mean_critic_score: scores.length ? round2(scores.reduce((a, b) => a + b, 0) / scores.length) : "",
    slop_findings: critic.reduce((n, e) => n + Number(/slop (\d+)/.exec(e.note ?? "")?.[1] ?? 0), 0),
    rollbacks: sections.filter((s) => s.status === "rolled_back").length,
    excluded: sections.filter((s) => s.status === "excluded").length,
    calls: result.report?.usage.calls ?? events.filter((e) => e.role).length,
    tokens_in: result.report?.usage.tokensIn ?? events.reduce((n, e) => n + (e.tokensIn ?? 0), 0),
    tokens_out: result.report?.usage.tokensOut ?? events.reduce((n, e) => n + (e.tokensOut ?? 0), 0),
    wall_s: result.seconds,
  };
}

const csvCell = (v: unknown) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
export const toCsv = (rows: Row[]) => [Object.keys(rows[0]!).join(","), ...rows.map((r) => Object.values(r).map(csvCell).join(","))].join("\n") + "\n";

async function events(dir: string) {
  const runs = paths(dir).runs;
  const files = await readdir(runs).catch(() => [] as string[]);
  const text = (await Promise.all(files.map((f) => readFile(join(runs, f), "utf8")))).join("");
  return text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Event);
}

async function runOne(item: Item, out: string): Promise<Result> {
  const dir = join(out, item.id);
  const saved = await readFile(join(dir, "result.json"), "utf8").then((t) => JSON.parse(t) as Result, () => undefined);
  if (saved) return saved;
  await mkdir(dir, { recursive: true });
  const started = Date.now();
  let report: Report | undefined, error: string | undefined;
  try {
    report = item.url ? await clone(dir, item.url, item.brief) : await build(dir, item.brief, item.preset ? { preset: item.preset } : {});
  } catch (e) {
    error = (e as Error).stack ?? String(e);
  }
  const result: Result = { id: item.id, kind: item.kind, seconds: Math.round((Date.now() - started) / 1000), ...(report && { report }), ...(error && { error }) };
  await writeFile(join(dir, "result.json"), JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: "string" }, only: { type: "string" } } });
  const out = values.out ?? join(here, "out", new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-"));
  const briefs = JSON.parse(await readFile(join(here, "briefs.json"), "utf8")) as Item[];
  const refs = (JSON.parse(await readFile(join(here, "refs.json"), "utf8")) as Item[]).map((r) => ({ ...r, kind: "clone" }));
  const only = values.only?.split(",");
  const items = [...briefs, ...refs.filter((r) => r.url)].filter((i) => !only || only.includes(i.id));
  const placeholders = refs.filter((r) => !r.url).length;

  const roles = ["DIRECTOR", "BUILDER", "SHOWPIECE", "CRITIC", ...(items.some((i) => i.url) ? ["ANALYST"] : [])];
  const missing = roles.filter((r) => !process.env[`UI_MODEL_${r}`]);
  if (missing.length) throw new Error(`Set ${missing.map((r) => `UI_MODEL_${r}`).join(", ")} (and UI_LLM_URL) to the models to evaluate.`);
  console.log(`Evaluating ${items.length} items into ${out}${placeholders ? ` (${placeholders} refs skipped: no URL yet)` : ""}`);
  console.log(Object.fromEntries(roles.map((r) => [r.toLowerCase(), `${process.env[`UI_MODEL_${r}`]} @ ${process.env[`UI_LLM_URL_${r}`] ?? process.env.UI_LLM_URL ?? "http://localhost:8000/v1"}`])));

  const rows: Row[] = [];
  for (const [n, item] of items.entries()) {
    console.log(`[${n + 1}/${items.length}] ${item.id} (${item.kind}) …`);
    const result = await runOne(item, out);
    rows.push(metrics(result, await events(join(out, item.id))));
    console.log(`  ${rows.at(-1)!.status}, ${rows.at(-1)!.green}/${rows.at(-1)!.sections} green, ${result.seconds}s`);
    await writeFile(join(out, "results.csv"), toCsv(rows));
  }
  console.table(rows.map(({ id, kind, status, sections, green, first_round_gate_pass_rate, rounds_to_green, mean_critic_score, slop_findings, rollbacks, tokens_in, tokens_out, wall_s }) =>
    ({ id, kind, ok: status === "ok", green: `${green}/${sections}`, gate0: first_round_gate_pass_rate, rounds: rounds_to_green, score: mean_critic_score, slop: slop_findings, rollbacks, tokens_in, tokens_out, wall_s })));
  const ok = rows.filter((r) => r.status === "ok");
  const mean = (k: keyof Row) => round2(ok.flatMap((r) => (r[k] === "" ? [] : [Number(r[k])])).reduce((a, b, _, all) => a + b / all.length, 0));
  console.log(`Overall: ${ok.length}/${rows.length} ran, gate pass rate (round 0) ${mean("first_round_gate_pass_rate")}, mean critic score ${mean("mean_critic_score")},`,
    `${rows.reduce((n, r) => n + r.rollbacks + r.excluded, 0)} sections rolled back or excluded, ${rows.reduce((n, r) => n + r.wall_s, 0)}s total. CSV: ${join(out, "results.csv")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
