import { execFile } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

export type Issue = { section: string; source: "lint" | "type" | "build" | "runtime" | "perf" | "critic"; severity: "high" | "medium" | "low"; fix: string };
type Rule = [RegExp, Issue["severity"], string];

export const SECTIONS = join("src", "sections");
const idOf = (file: string) => file.replace(/(\.scene)?\.tsx$/, "");
const lineOf = (src: string, index: number) => src.slice(0, index).split("\n").length;

const exec = promisify(execFile);
// Spawning the bin with our own Node (no npx, no shell) keeps exit codes and kills exact on Windows.
// The script path is made absolute: relative to a relative cwd, node would resolve it from that cwd a second time.
export const node = (cwd: string, bin: string, ...args: string[]) =>
  exec(process.execPath, [resolve(cwd, "node_modules", bin), ...args], { cwd, maxBuffer: 64 << 20 }).then(
    (r) => ({ ok: true, out: r.stdout + r.stderr }),
    (e: { stdout?: string; stderr?: string; message: string }) => ({ ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` || e.message }),
  );

const sectionImports: Rule = [/(?:\bfrom\s*|^\s*import\s*)["'](?!(?:react|motion\/react|\.\.\/kit\/\w+|\.\/\w+\.poster\.svg)["'])|\bimport\(\s*["'](?!\.\/\w+\.scene["'])/m, "high", "Import only from 'react', 'motion/react', '../kit/<file>' and your own './<Id>.poster.svg'. Use kit primitives instead of other packages; 3D goes in <Id>.scene.tsx, loaded with <Scene3D load={() => import(\"./<Id>.scene\")} />."];
const sceneImports: Rule = [/(?:\bfrom\s*|^\s*import\s*)["'](?!(?:react|three|@react-three\/(?:fiber|drei))["'])/m, "high", "A .scene.tsx file may import only 'react', 'three', '@react-three/fiber' and '@react-three/drei'."];
const rules: Rule[] = [
  [/\b(?:initial|animate|exit|while\w+)=\{\{[^}]*\b(?:width|height|top|left|right|bottom|margin\w*|padding\w*)\s*:/, "high", "Animate only transform and opacity (x, y, scale, rotate, opacity). Animating width/height/top/left/margin/padding forces layout on every frame and janks."],
  [/(?<!href=["'])#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(/, "high", "Use token classes only (bg-bg text-fg text-muted bg-surface text-accent bg-accent border-line), never hex/rgb/hsl colors."],
  [/\b(?:bg|text|border|from|via|to|ring|fill|stroke|outline|divide|decoration|shadow|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b/, "high", "Tailwind palette colors are removed from this theme and render nothing; use token classes (bg-bg text-fg text-muted bg-surface text-accent bg-accent border-line)."],
  [/<img\b(?![^>]*\balt=)|<img\b(?![^>]*\bwidth=)|<img\b(?![^>]*\bheight=)/, "high", "Give every <img> alt, width and height (alt=\"\" if decorative); the size reserves space so nothing shifts when it loads."],
  [/\b(?:min-|max-)?h-screen\b|\b100vh\b/, "medium", "Use min-h-svh (or h-svh) instead of h-screen/100vh; mobile browser bars make 100vh taller than the visible screen."],
  [/\b(?:unleash\w*|elevate\w*|revolutioni[sz]\w*|seamless\w*|next-gen|cutting-edge|acme|lorem)\b/i, "medium", "Rewrite the copy in concrete terms for this product; banned filler: unleash, elevate, revolutionize, seamless, next-gen, cutting-edge, Acme, Lorem."],
];

async function lint(stage: string, files: string[]): Promise<Issue[]> {
  const max = Number(process.env.UI_SECTION_LINES ?? 150);
  const issues: Issue[] = [];
  for (const file of files) {
    const src = await readFile(join(stage, SECTIONS, file), "utf8");
    const section = idOf(file);
    for (const [re, severity, fix] of [file.endsWith(".scene.tsx") ? sceneImports : sectionImports, ...rules]) {
      const m = re.exec(src);
      if (m) issues.push({ section, source: "lint", severity, fix: `${fix} (${file}:${lineOf(src, m.index)})` });
    }
    const lines = src.split("\n").length;
    if (lines > max) issues.push({ section, source: "lint", severity: "medium", fix: `${file} has ${lines} lines; cut it to ${max} with kit primitives and by mapping over data instead of repeating markup.` });
  }
  return issues;
}

export const writeRegistry = (root: string, ids: string[]) =>
  writeFile(
    join(root, SECTIONS, "index.ts"),
    `import type { ComponentType } from "react";\n${ids.map((id) => `import ${id} from "./${id}";\n`).join("")}\n` +
      `export const sections: { id: string; Section: ComponentType }[] = [\n${ids.map((id) => `  { id: "${id}", Section: ${id} },\n`).join("")}];\n`,
  );

async function typecheck(stage: string, ids: string[]): Promise<Issue[]> {
  const { out } = await node(stage, "typescript/bin/tsc", "--noEmit", "--pretty", "false");
  const bySection = new Map<string, string[]>();
  for (const line of out.split(/\r?\n/).filter((l) => /error TS\d+/.test(l))) {
    // Registry errors ("Module './X' has no default export") belong to the section they name.
    const id = /sections[\\/](\w+)(?:\.scene)?\.tsx/.exec(line)?.[1] ?? /'"\.\/(\w+)"'/.exec(line)?.[1];
    const key = id && ids.includes(id) ? id : "_app";
    bySection.set(key, [...(bySection.get(key) ?? []), line]);
  }
  return [...bySection].map(([section, lines]) => ({ section, source: "type", severity: "high", fix: `Fix these TypeScript errors:\n${lines.slice(0, 5).join("\n")}` }));
}

async function build(stage: string, ids: string[]) {
  const issues: Issue[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    await writeRegistry(stage, ids);
    const { ok, out } = await node(stage, "vite/bin/vite.js", "build", "--logLevel", "error");
    if (ok) return { issues, mounted: ids };
    const bad = ids.filter((id) => new RegExp(`sections[\\\\/]${id}(\\.scene)?\\.tsx`).test(out));
    const fix = `vite build failed; fix this error:\n${out.trim().split(/\r?\n/).slice(-12).join("\n")}`;
    issues.push(...(bad.length ? bad : ["_app"]).map((section): Issue => ({ section, source: "build", severity: "high", fix })));
    if (!bad.length) break;
    ids = ids.filter((id) => !bad.includes(id));
  }
  return { issues, mounted: [] as string[] };
}

async function entryHasThree(stage: string) {
  const dist = join(stage, "dist");
  const manifest = JSON.parse(await readFile(join(dist, ".vite", "manifest.json"), "utf8")) as Record<string, { file: string; imports?: string[] }>;
  const chunks = new Set<string>();
  const walk = (key: string): void => {
    const chunk = manifest[key];
    if (!chunk || chunks.has(chunk.file)) return;
    chunks.add(chunk.file);
    chunk.imports?.forEach(walk);
  };
  walk("index.html");
  const code = await Promise.all([...chunks].map((file) => readFile(join(dist, file), "utf8")));
  return code.some((c) => c.includes("WebGLRenderer"));
}

/** Lint, type-check and build the stage; sections that don't compile are left out of the registry. */
export async function gates(stage: string, ids: string[]): Promise<{ issues: Issue[]; mounted: string[] }> {
  const files = (await readdir(join(stage, SECTIONS))).filter((f) => f.endsWith(".tsx") && ids.includes(idOf(f)));
  const issues = await lint(stage, files);
  await writeRegistry(stage, ids);
  const typeIssues = await typecheck(stage, ids);
  const built = await build(stage, ids.filter((id) => !typeIssues.some((i) => i.section === id)));
  issues.push(...typeIssues, ...built.issues);
  // Lint already names the section that imports three statically; this catches whatever slips past it.
  if (built.mounted.length && (await entryHasThree(stage)))
    issues.push({ section: "_app", source: "build", severity: "high", fix: "three.js landed in the entry chunk. Load 3D lazily: put it in <Id>.scene.tsx and render <Scene3D load={() => import(\"./<Id>.scene\")} />; never import three, @react-three/* or a .scene file statically." });
  return { issues, mounted: built.mounted };
}
