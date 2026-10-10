import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeImage, analyzeSection, direct, kitApi, type Description } from "./agents.js";
import { capture, cropImage, type Facts, type Reference } from "./capture.js";
import { SECTIONS, writeRegistry } from "./gates.js";
import { describePhoto, resolveImages, userPhotos } from "./images.js";
import type { Role, Usage } from "./llm.js";
import { loop, pool, type Report } from "./loop.js";
import { copyProject, paths, runLog, savePlan, syncStage, type Event, type Plan } from "./store.js";

type Log = (event: Omit<Event, "t">) => Promise<void>;
type Spent = { calls: number; tokensIn: number; tokensOut: number };
const KIT = fileURLToPath(new URL("../kit", import.meta.url));
const SYSTEM_FONTS = 'ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif';

// ponytail: a new site links node_modules to the agent's kit install; run npm install in site/ to detach it.
async function createSite(site: string) {
  await copyProject(KIT, site);
  await rm(join(site, SECTIONS), { recursive: true, force: true });
  await mkdir(join(site, SECTIONS), { recursive: true });
  await writeRegistry(site, []);
}

/** Writes tokens.css from the plan and links whichever Google Fonts actually load (400–700, then the plain family); anything else falls back to system fonts. */
export async function assemble(dir: string, tokens: Plan["tokens"], log: Log) {
  const { stage } = paths(dir);
  const base = process.env.UI_FONTS_URL ?? "https://fonts.googleapis.com";
  const loads = (query: string) => fetch(`${base}/css2?family=${query}&display=swap`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.ok, () => false);
  const found = new Map<string, string | undefined>();
  for (const name of new Set(Object.values(tokens.fonts))) {
    const family = name.replaceAll(" ", "+");
    const query = (await loads(`${family}:wght@400..700`)) ? `${family}:wght@400..700` : (await loads(family)) ? family : undefined;
    found.set(name, query);
    if (!query) await log({ step: "fonts", ms: 0, ok: false, note: `Google Fonts has no "${name}"; using the system font stack instead.` });
  }
  const stack = (name: string) => (found.get(name) ? `"${name}", ${SYSTEM_FONTS}` : SYSTEM_FONTS);
  const families = [...found.values()].filter((q) => q !== undefined);
  const c = tokens.colors;
  await writeFile(join(stage, "src", "tokens.css"), `@theme static {
  --color-*: initial;
  --color-bg: ${c.bg};
  --color-fg: ${c.fg};
  --color-muted: ${c.muted};
  --color-surface: ${c.surface};
  --color-accent: ${c.accent};
  --color-line: ${c.line};
  --font-display: ${stack(tokens.fonts.display)};
  --font-body: ${stack(tokens.fonts.body)};
  --radius-card: ${tokens.radius};
}
`);
  const links = families.length
    ? `<link rel="preconnect" href="${base}" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin /><link rel="stylesheet" href="${base}/css2?${families.map((f) => `family=${f}`).join("&")}&display=swap" />`
    : "";
  const html = join(stage, "index.html");
  await writeFile(html, (await readFile(html, "utf8")).replace(/<!-- fonts -->[\s\S]*?<!-- \/fonts -->/, `<!-- fonts -->${links}<!-- /fonts -->`));
}

// A flow-level model call, logged like the loop's. The caller decides whether a failure ends the run.
async function call<T>(log: Log, spent: Spent, step: string, role: Role, run: () => Promise<{ value: T; usage: Usage }>, section?: string): Promise<T> {
  const t = Date.now();
  const done = async (u: Usage | undefined, error?: string) => {
    Object.assign(spent, { calls: spent.calls + 1, tokensIn: spent.tokensIn + (u?.tokensIn ?? 0), tokensOut: spent.tokensOut + (u?.tokensOut ?? 0) });
    await log({ step, role, model: u?.model ?? "", ...(section === undefined ? {} : { section }), tokensIn: u?.tokensIn ?? 0, tokensOut: u?.tokensOut ?? 0, ms: Date.now() - t, ok: error === undefined, ...(error === undefined ? {} : { note: error }) });
  };
  try {
    const reply = await run();
    await done(reply.usage);
    return reply.value;
  } catch (e) {
    await done((e as { usage?: Usage }).usage, (e as Error).message);
    throw e;
  }
}

async function prepare(dir: string) {
  if (!(await access(paths(dir).site).then(() => true, () => false))) await createSite(paths(dir).site);
  await syncStage(dir);
}

// The user's photos → director → images resolved to files → tokens and fonts → every section built in parallel → gate, judge, fix and promote.
async function planAndBuild(dir: string, brief: string, ctx: Omit<Parameters<typeof direct>[1], "kit">, log: Log, spent: Spent, started: number): Promise<Report> {
  const p = paths(dir);
  const photos = await userPhotos(dir, (file) => call(log, spent, "photo", "analyst", () => describePhoto(file)).then((r) => r.about), log);
  const list = photos.map((f) => `- ${f.src} (${f.width}×${f.height}): ${f.about}`).join("\n");
  await log({ step: "start", ms: 0, ok: true, note: "planning the site: direction, design tokens and sections (often 2–4 min)" });
  const { design, ...plan } = await call(log, spent, "direct", "director", async () => direct(photos.length ? `${brief}\n\n## Photos\n${list}` : brief, { kit: await kitApi(join(p.stage, "src", "kit")), ...ctx }));
  await resolveImages(dir, plan, photos, log);
  await savePlan(dir, plan);
  await writeFile(p.design, design);
  await assemble(dir, plan.tokens, log);
  // A new plan starts from empty stage sections so the loop builds every planned section fresh.
  await rm(join(p.stage, SECTIONS), { recursive: true, force: true });
  await mkdir(join(p.stage, SECTIONS));
  const report = await loop(dir, log);
  const u = report.usage;
  return { previewUrl: p.site, ...report, usage: { seconds: Math.round((Date.now() - started) / 1000), calls: u.calls + spent.calls, tokensIn: u.tokensIn + spent.tokensIn, tokensOut: u.tokensOut + spent.tokensOut } };
}

/** Prompt → site: director plans, builders write every section in parallel, the loop gates, fixes and promotes. */
export async function build(dir: string, brief: string, opts: { preset?: string; log?: Log } = {}): Promise<Report> {
  // The name becomes a file path, so only plain preset names are accepted.
  if (opts.preset !== undefined && !/^[a-z-]+$/.test(opts.preset)) throw new Error(`Unknown preset "${opts.preset}"; use the name of a file in presets/, e.g. "editorial".`);
  const started = Date.now();
  await prepare(dir);
  const preset = opts.preset === undefined ? undefined : await readFile(new URL(`../presets/${opts.preset}.md`, import.meta.url), "utf8");
  return planAndBuild(dir, brief, { preset }, opts.log ?? runLog(dir), { calls: 0, tokensIn: 0, tokensOut: 0 }, started);
}

/** Captures a URL (or crops a screenshot) into .ui/ref/ and describes each section; a failed section analysis leaves only that description out. */
export async function analyze(dir: string, source: string, log: Log, spent: Spent = { calls: 0, tokensIn: 0, tokensOut: 0 }) {
  const p = paths(dir);
  if (/^https?:\/\//.test(source)) {
    const ref = await capture(source, p.ref);
    const descriptions: (Description | undefined)[] = ref.crops.map(() => undefined);
    await pool(ref.crops.map((_, i) => i), Number(process.env.UI_PARALLEL ?? 3), async (i) => {
      descriptions[i] = await call(log, spent, "analyze", "analyst", () => analyzeSection(ref, i), `ref-${i}`).catch(() => undefined);
    });
    return { ref, descriptions };
  }
  const reading = await call(log, spent, "analyze", "analyst", () => analyzeImage(source));
  const { size, crops } = await cropImage(source, reading.sections, p.ref);
  const sections = reading.sections.map((b) => ({ y: Math.round(b.top * size.height), height: Math.round((b.bottom - b.top) * size.height) }));
  const facts: Facts = { source, estimated: true, fonts: reading.fonts.map((family) => ({ family, share: 0 })), colors: { text: [], background: reading.palette }, sizes: [], radii: [], headings: [], sections };
  const ref: Reference = { facts, fold: source, crops, mobile: [], frames: crops.map(() => []) };
  const descriptions = reading.sections.map(({ role, layout, hierarchy, typography, spacing, motion, components }): Description | undefined => ({ role, layout, hierarchy, typography, spacing, motion, components }));
  return { ref, descriptions };
}

/** Link or screenshot → a site with the reference's design and original content; the critic compares each section with its reference crop. */
export async function clone(dir: string, source: string, brief: string, opts: { log?: Log } = {}): Promise<Report> {
  const started = Date.now();
  const log = opts.log ?? runLog(dir);
  const spent = { calls: 0, tokensIn: 0, tokensOut: 0 };
  await prepare(dir);
  await log({ step: "start", ms: 0, ok: true, note: `capturing and analysing the reference ${source}` });
  const { ref, descriptions } = await analyze(dir, source, log, spent);
  // The director gets sizes and weights but not the reference's heading text or address, so none of its copy or brand can leak into the plan.
  const facts = { ...ref.facts, source: undefined, headings: ref.facts.headings.map(({ tag, size, weight }) => ({ tag, size, weight })) };
  const sections = descriptions.map((d, i) => `${i}: ${d ? JSON.stringify(d) : "(not analysed; follow its measured box)"}`).join("\n");
  const text = `### Measured facts${ref.facts.estimated ? " (estimated from a screenshot)" : ""}\n${JSON.stringify(facts)}\n\n### Sections\n${sections}`;
  return planAndBuild(dir, brief, { reference: { text, sections: ref.crops.length } }, log, spent, started);
}
