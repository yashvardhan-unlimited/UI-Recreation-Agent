import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSection, buildShowpiece, critique, kitApi } from "./agents.js";
import { audit } from "./browser.js";
import { gates, SECTIONS, writeRegistry, type Issue } from "./gates.js";
import type { Usage } from "./llm.js";
import { loadPlan, paths, promote, restore, runLog, snapshot, stageFiles, type Event, type SectionSpec } from "./store.js";

type Status = "pass" | "fixed" | "rolled_back" | "excluded";
export type Report = { previewUrl: string; sections: Record<string, { status: Status; score?: number; open: string[] }>; app: string[];
  usage: { calls: number; tokensIn: number; tokensOut: number; seconds: number } };
type Log = (event: Omit<Event, "t">) => Promise<void>;

export async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const worker = async () => { for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item); };
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, worker));
}

/** §4.4: gate → judge → promote green → fix bad, until clean or out of rounds; then roll back what never recovered. */
export async function loop(dir: string, log: Log = runLog(dir)): Promise<Omit<Report, "previewUrl">> {
  const started = Date.now();
  const p = paths(dir);
  const plan = await loadPlan(dir);
  if (!plan) throw new Error(`No plan at ${p.plan}; the director must write one before the loop runs.`);
  const specs = new Map(plan.pages.flatMap((page) => page.sections).map((s): [string, SectionSpec] => [s.id, s]));
  const ids = [...specs.keys()];
  const design = await readFile(p.design, "utf8");
  const kit = await kitApi(join(p.stage, "src", "kit"));
  const parallel = Number(process.env.UI_PARALLEL ?? 3);
  const rounds = Number(process.env.UI_ROUNDS ?? 3);
  const file = (id: string) => join(p.stage, SECTIONS, `${id}.tsx`);
  const withFiles = async () => (await Promise.all(ids.map((id) => access(file(id)).then(() => true, () => false)))).flatMap((ok, i) => (ok ? [ids[i]!] : []));
  const usage = { calls: 0, tokensIn: 0, tokensOut: 0 };
  const passScore = Number(process.env.UI_PASS_SCORE ?? 7);
  const failures = new Map<string, string>(), verdicts = new Map<string, { score: number; notes: string[] }>();
  const fixed = new Set<string>(), everGreen = new Set<string>(), passedAs = new Map<string, string>();

  const record = async (step: string, id: string, round: number, t: number, u: Usage | undefined, error?: string, note?: string) => {
    Object.assign(usage, { calls: usage.calls + 1, tokensIn: usage.tokensIn + (u?.tokensIn ?? 0), tokensOut: usage.tokensOut + (u?.tokensOut ?? 0) });
    const text = error ?? note;
    await log({ step, role: step === "critic" ? "critic" : specs.get(id)!.showpiece ? "showpiece" : "builder", model: u?.model ?? "", section: id, round, tokensIn: u?.tokensIn ?? 0, tokensOut: u?.tokensOut ?? 0, ms: Date.now() - t, ok: error === undefined, ...(text === undefined ? {} : { note: text }) });
  };

  // A model failure is recorded against this section only; its file stays as it was.
  const callBuilder = async (id: string, round: number, issues?: Issue[]) => {
    const t = Date.now();
    const spec = specs.get(id)!, current = issues && (await stageFiles(dir, id)), step = current?.[`${id}.tsx`] === undefined ? "build" : "fix";
    try {
      // Showpieces go to the showpiece role and come back as several files (section, scene, poster).
      const reply = await (spec.showpiece ? buildShowpiece : buildSection)(spec, { design, kit, ...(step === "fix" ? { current, issues } : {}) });
      for (const [name, code] of Object.entries(reply.value)) await writeFile(join(p.stage, SECTIONS, name), code);
      failures.delete(id);
      await record(step, id, round, t, reply.usage);
    } catch (e) {
      failures.set(id, `Builder failed: ${(e as Error).message}`);
      await record(step, id, round, t, (e as { usage?: Usage }).usage, (e as Error).message);
    }
  };

  // Pass = score ≥ UI_PASS_SCORE and no high-severity issue; a failing verdict's issues and slop become the fix list.
  const judge = async (id: string, round: number, issues: Issue[], hash: string) => {
    const t = Date.now();
    const shot = (width: string) => join(p.shots, String(round), width, `${id}.png`);
    try {
      const { ref } = specs.get(id)!, reference = ref === undefined ? {} : { ref: join(p.ref, `section-${ref}.png`) };
      const { value, usage: u } = await critique(specs.get(id)!, { design, direction: plan.direction, desktop: shot("1440"), mobile: shot("390"), ...reference });
      const pass = value.score >= passScore && !value.issues.some((i) => i.severity === "high");
      verdicts.set(id, { score: value.score, notes: value.issues.map((i) => i.fix) });
      if (pass) {
        passedAs.set(id, hash);
        everGreen.add(id);
        await snapshot(dir, id);
      } else issues.push(...value.issues, ...value.slop.map((s): Issue => ({ section: id, source: "critic", severity: "medium", fix: `Replace this generic pattern with something specific to the brief: ${s}` })));
      failures.delete(id);
      await record("critic", id, round, t, u, undefined, `score ${value.score}${pass ? "" : ", fail"}${value.slop.length ? `, slop ${value.slop.length}: ${value.slop.join(" | ")}` : ""}`);
    } catch (e) {
      failures.set(id, `Critic failed: ${(e as Error).message}`);
      await record("critic", id, round, t, (e as { usage?: Usage }).usage, (e as Error).message);
    }
  };

  const built = await withFiles();
  await pool(ids.filter((id) => !built.includes(id)), parallel, (id) => callBuilder(id, 0));

  let issues: Issue[] = [], clean: string[] = [];
  for (let round = 0; ; round++) {
    const t = Date.now();
    const present = await withFiles();
    const gate = await gates(p.stage, present);
    issues = [...gate.issues, ...(gate.mounted.length ? await audit(p.stage, { sections: gate.mounted, shots: join(p.shots, String(round)) }) : [])];
    await log({ step: "gates", round, ms: Date.now() - t, ok: !issues.length, note: `${issues.length} issues, ${gate.mounted.length} mounted${issues.length ? ": " : ""}${issues.map((i) => `${i.section}/${i.source}: ${i.fix.split("\n")[0]!.slice(0, 160)}`).join(" | ")}` });

    const gateClean = gate.mounted.filter((id) => !issues.some((i) => i.section === id));
    const tokens = await readFile(join(p.stage, "src", "tokens.css"), "utf8");
    const hashes = new Map<string, string>();
    for (const id of gateClean) hashes.set(id, createHash("sha1").update(JSON.stringify(await stageFiles(dir, id)) + tokens).digest("hex"));
    // §12: only sections that changed since they last passed are judged (and snapshotted) again.
    await pool(gateClean.filter((id) => passedAs.get(id) !== hashes.get(id)), parallel, (id) => judge(id, round, issues, hashes.get(id)!));
    clean = gateClean.filter((id) => passedAs.get(id) === hashes.get(id));
    const live = ids.filter((id) => everGreen.has(id));
    await promote(dir, live);
    await log({ step: "promote", round, ms: 0, ok: true, note: live.join(",") });

    const bad = ids.filter((id) => !clean.includes(id));
    if (!bad.length || round === rounds) break;
    // A section with a file but no issues only lost its critic call; it is judged again next round, not rebuilt.
    const toFix = bad.filter((id) => issues.some((i) => i.section === id) || !present.includes(id));
    toFix.forEach((id) => fixed.add(id));
    await pool(toFix, parallel, (id) => callBuilder(id, round + 1, issues.filter((i) => i.section === id)));
  }

  const sections: Report["sections"] = {};
  for (const id of ids) {
    const open = [...issues.filter((i) => i.section === id).map((i) => i.fix.split("\n")[0]!), ...(failures.has(id) ? [failures.get(id)!] : [])];
    const v = verdicts.get(id), score = v ? { score: v.score } : {};
    if (clean.includes(id)) sections[id] = { status: fixed.has(id) ? "fixed" : "pass", ...score, open: v?.notes ?? [] };
    else if (everGreen.has(id)) {
      await restore(dir, id);
      sections[id] = { status: "rolled_back", ...score, open };
    } else sections[id] = { status: "excluded", ...score, open };
  }
  // Leave stage matching what is live, so the next edit starts from known-good files.
  await writeRegistry(p.stage, ids.filter((id) => everGreen.has(id)));
  const app = [...new Set(issues.filter((i) => i.section === "_app").map((i) => i.fix.split("\n")[0]!))];
  return { sections, app, usage: { ...usage, seconds: Math.round((Date.now() - started) / 1000) } };
}
