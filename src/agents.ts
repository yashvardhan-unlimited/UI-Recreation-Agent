import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import Type from "typebox";
import type { Reference } from "./capture.js";
import type { Issue } from "./gates.js";
import { ask, type CodeFile, type Part } from "./llm.js";
import type { Plan, SectionSpec } from "./store.js";

export const prompt = (name: string) => readFile(new URL(`../prompts/${name}.md`, import.meta.url), "utf8");

/** The builder's kit reference, generated from the one-line docs in the kit so the kit stays the single source of truth. */
export async function kitApi(kitDir: string) {
  const lines: string[] = [];
  for (const file of (await readdir(kitDir)).filter((f) => f.endsWith(".tsx")).sort()) {
    const src = await readFile(join(kitDir, file), "utf8");
    const exports = [...src.matchAll(/^\/\*\* (.+) \*\/\r?\nexport function (\w+\(.*\)) \{$/gm)].map(([, doc, sig]) => `- ${sig} — ${doc}`);
    // Signatures mention local types like `Box`; include them so the builder can read the props.
    if (exports.length) lines.push(`// import { … } from "../kit/${file.replace(".tsx", "")}"`, ...(src.match(/^type \w+ = .+;$/gm) ?? []), ...exports, "");
  }
  return lines.join("\n");
}

export type BuildContext = { design: string; kit: string; current?: Record<string, string> | undefined; issues?: Issue[] | undefined };
const fence = (name: string) => `\`\`\`${name.endsWith(".svg") ? "svg" : "tsx"} ${name}`;

// Writes a section's files from its spec, or (with current files + issues) fixes them. Stable context goes first so parallel calls share a cached prefix.
async function writeSection(role: "builder" | "showpiece", spec: SectionSpec, ctx: BuildContext, names: string[]) {
  const system = (await prompt(role)).replaceAll("{{lines}}", process.env.UI_SECTION_LINES ?? "150").replaceAll("{{id}}", spec.id);
  const current = Object.entries(ctx.current ?? {}).map(([name, code]) => `${fence(name)}\n${code}\n\`\`\``).join("\n\n");
  const fix = current ? `## Current files\n${current}\n\n## Issues to fix\n${(ctx.issues ?? []).map((i) => `- ${i.fix}`).join("\n")}\n\n` : "";
  const user = `## DESIGN.md\n${ctx.design}\n\n## Kit API\n${ctx.kit}\n\n${fix}## Section spec\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\``;
  // A lone unnamed block is the section file; otherwise every expected file must come back under its name.
  const pick = (files: CodeFile[]): Record<string, string | undefined> =>
    names.length === 1 && files.length === 1 ? { [names[0]!]: files[0]!.code } : Object.fromEntries(names.map((n) => [n, files.find((f) => f.name === n)?.code]));
  const check = (files: CodeFile[]) => {
    const got = pick(files);
    const ok = names.every((n) => got[n] && (n.endsWith(".svg") || /\bexport default\b/.test(got[n])));
    return ok ? undefined : `Reply with exactly these fenced blocks: ${names.map(fence).join(" … ")}; every .tsx file default-exports its component.`;
  };
  const reply = await ask<CodeFile[]>(role, { system, user: [user], check });
  return { value: pick(reply.value) as Record<string, string>, usage: reply.usage };
}

export const buildSection = (spec: SectionSpec, ctx: BuildContext) => writeSection("builder", spec, ctx, [`${spec.id}.tsx`]);
/** A tier-4 moment on the showpiece model: a 3D section is the section, its lazily loaded .scene.tsx and an SVG poster; a pinned story is one file. */
export const buildShowpiece = (spec: SectionSpec, ctx: BuildContext) =>
  writeSection("showpiece", spec, ctx, spec.showpiece?.kind === "3d" ? [`${spec.id}.tsx`, `${spec.id}.scene.tsx`, `${spec.id}.poster.svg`] : [`${spec.id}.tsx`]);

const Text = Type.String({ minLength: 1 });
const Hex = Type.String({ pattern: "^#[0-9a-fA-F]{6}$" });
// Font names land in CSS and a URL, so only plain family names get through.
const Font = Type.String({ pattern: "^[A-Za-z0-9 ]{2,40}$" });
const Spec = Type.Object({
  id: Type.String({ pattern: "^[A-Z][A-Za-z0-9]*$" }),
  goal: Text,
  layout: Type.Object({ desktop: Text, mobile: Text }),
  copy: Text,
  motion: Type.Array(Type.String()),
  images: Type.Optional(Type.Array(Type.Object({ src: Text, alt: Type.String() }), { maxItems: 8 })),
  showpiece: Type.Optional(Type.Object({ kind: Type.Union([Type.Literal("3d"), Type.Literal("pinned")]), idea: Text, poster: Text })),
  ref: Type.Optional(Type.Integer({ minimum: 0 })),
});
const Direction = Type.Object({
  name: Text,
  direction: Type.Object({
    theme: Text, typePairing: Text, hero: Text, rhythm: Text,
    signature: Type.Array(Text, { minItems: 3, maxItems: 4 }),
    motionEnergy: Type.Union([Type.Literal("calm"), Type.Literal("lively"), Type.Literal("bold")]),
  }),
  design: Text,
  tokens: Type.Object({
    colors: Type.Object({ bg: Hex, fg: Hex, muted: Hex, surface: Hex, accent: Hex, line: Hex }),
    fonts: Type.Object({ display: Font, body: Font }),
    radius: Type.String({ pattern: "^\\d+(\\.\\d+)?(px|rem)$" }),
  }),
  pages: Type.Array(Type.Object({ path: Text, sections: Type.Array(Spec, { minItems: 1, maxItems: 12 }) }), { minItems: 1, maxItems: 1 }),
});
export type DirectorOutput = Plan & { design: string };

const luminance = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

// What the schema can't say; each message tells the director what to change.
function checkPlan(out: DirectorOutput, refs: number): string | undefined {
  const sections = out.pages.flatMap((p) => p.sections);
  const stray = sections.find((s) => s.ref !== undefined && s.ref >= refs);
  if (stray) return `Section "${stray.id}" has ref ${stray.ref}, but ${refs ? `the reference sections are numbered 0 to ${refs - 1}` : "there is no reference; remove ref"}.`;
  const ids = sections.map((s) => s.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) return `Section id "${dup}" is used more than once; every id must be unique.`;
  if (sections.filter((s) => s.showpiece).length > 1) return "More than one section has a showpiece; keep only the strongest one (max one per page).";
  const lines = out.design.trim().split("\n").length;
  if (lines > 50) return `DESIGN.md is ${lines} lines; cut it to 50.`;
  const c = out.tokens.colors;
  for (const [fg, bg, pair] of [[c.fg, c.bg, "fg on bg"], [c.muted, c.bg, "muted on bg"], [c.bg, c.accent, "bg as button text on accent"]] as const) {
    const ratio = contrast(fg, bg);
    if (ratio < 4.5) return `Contrast for ${pair} is ${ratio.toFixed(2)}:1; WCAG AA needs 4.5:1. Darken or lighten one of the two colors.`;
  }
  return undefined;
}

/** Commits to a direction card, then writes DESIGN.md, tokens and the section plan; motion names the kit doesn't export are dropped. */
export async function direct(brief: string, ctx: { kit: string; preset?: string | undefined; reference?: { text: string; sections: number } | undefined }) {
  const preset = ctx.preset === undefined ? "" : `## Style preset\n${ctx.preset}\n\n`;
  const reference = ctx.reference === undefined ? "" : `## Reference\n${ctx.reference.text}\n\n`;
  const user = `## Kit API\n${ctx.kit}\n\n${preset}${reference}## Brief\n${brief}`;
  const check = (out: DirectorOutput) => checkPlan(out, ctx.reference?.sections ?? 0);
  const reply = await ask<DirectorOutput>("director", { system: await prompt("director"), user: [user], schema: Direction, check });
  const kitNames = new Set([...ctx.kit.matchAll(/^- (\w+)\(/gm)].map((m) => m[1]));
  for (const section of reply.value.pages.flatMap((p) => p.sections)) section.motion = section.motion.filter((m) => kitNames.has(m));
  return reply;
}
const Verdict = Type.Object({
  score: Type.Number({ minimum: 0, maximum: 10 }),
  slop: Type.Array(Type.String()),
  issues: Type.Array(Type.Object({ severity: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]), fix: Text }), { maxItems: 5 }),
});

/** Judges one section from its 1440px and 390px crops (plus a reference crop when cloning) against its spec, DESIGN.md and the direction card. */
export async function critique(spec: SectionSpec, ctx: { design: string; direction: Plan["direction"]; desktop: string; mobile: string; ref?: string }) {
  const text = `## DESIGN.md\n${ctx.design}\n\n## Direction card\n${JSON.stringify(ctx.direction, null, 2)}\n\n## Section spec\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\``;
  const user: Part[] = [text, "Desktop, 1440px wide:", { image: ctx.desktop }, "Mobile, 390px wide:", { image: ctx.mobile }, ...(ctx.ref ? ["Reference:", { image: ctx.ref }] : [])];
  const reply = await ask<{ score: number; slop: string[]; issues: Omit<Issue, "section" | "source">[] }>("critic", { system: await prompt("critic"), user, schema: Verdict });
  const issues = reply.value.issues.map((i): Issue => ({ ...i, section: spec.id, source: "critic" }));
  return { value: { ...reply.value, issues }, usage: reply.usage };
}
const look = { role: Text, layout: Text, hierarchy: Text, typography: Text, spacing: Text, motion: Text, components: Type.Array(Text, { maxItems: 5 }) };
export type Description = { role: string; layout: string; hierarchy: string; typography: string; spacing: string; motion: string; components: string[] };
type Band = Description & { top: number; bottom: number };
const Fraction = Type.Number({ minimum: 0, maximum: 1 });
const ImageReading = Type.Object({ sections: Type.Array(Type.Object({ top: Fraction, bottom: Fraction, ...look }), { minItems: 1, maxItems: 12 }), palette: Type.Array(Hex, { maxItems: 6 }), fonts: Type.Array(Text, { maxItems: 3 }) });

/** Describes reference section `i` from its crops, entrance frames and (if it holds the primary CTA) hover frames, anchored to the measured facts. */
export async function analyzeSection(ref: Reference, i: number) {
  const hover = ref.hover?.section === i ? ["Primary button before and after hover:", { image: ref.hover.before }, { image: ref.hover.after }] : [];
  const mobile = ref.mobile[i] ? ["Mobile, 390px wide:", { image: ref.mobile[i] }] : [];
  const user: Part[] = [`## Measured facts\n${JSON.stringify(ref.facts)}\n\n## Section ${i} of ${ref.crops.length} (0-based, top to bottom)`, "Desktop, 1440px wide:", { image: ref.crops[i]! }, ...mobile,
    "Scroll frames as it enters the viewport:", ...ref.frames[i]!.map((image) => ({ image })), ...hover];
  return ask<Description>("analyst", { system: await prompt("analyst"), user, schema: Type.Object(look) });
}

/** Screenshot-only reference: one call splits the image into section bands (fractions of its height) and describes each, with estimated palette and fonts. */
export async function analyzeImage(image: string) {
  const ordered = (r: { sections: Band[] }) => r.sections.every((s, i) => s.bottom > s.top && s.top >= (r.sections[i - 1]?.bottom ?? 0) - 0.01)
    ? undefined : "Section bands must run top to bottom without overlapping, each with bottom greater than top.";
  return ask<{ sections: Band[]; palette: string[]; fonts: string[] }>("analyst", { system: await prompt("analyst"), user: ["## Screenshot only, no measured facts", { image }], schema: ImageReading, check: ordered });
}