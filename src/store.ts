import { appendFile, cp, mkdir, readFile, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SECTIONS, writeRegistry } from "./gates.js";

export type SectionSpec = {
  id: string;
  goal: string;
  layout: { desktop: string; mobile: string };
  copy: string;
  motion: string[];
  showpiece?: { kind: "3d" | "pinned"; idea: string; poster: string };
  ref?: number;
};
export type Plan = {
  name: string;
  direction: { theme: string; typePairing: string; hero: string; rhythm: string; signature: string[]; motionEnergy: "calm" | "lively" | "bold" };
  tokens: { colors: Record<"bg" | "fg" | "muted" | "surface" | "accent" | "line", string>; fonts: { display: string; body: string }; radius: string };
  pages: { path: string; sections: SectionSpec[] }[];
};
export type Event = { t: number; step: string; role?: string; model?: string; section?: string; round?: number;
  tokensIn?: number; tokensOut?: number; ms: number; ok: boolean; note?: string };

export function paths(dir: string) {
  const ui = join(dir, ".ui");
  return { site: join(dir, "site"), stage: join(ui, "stage"), green: join(ui, "green"), plan: join(ui, "plan.json"), design: join(dir, "DESIGN.md"), ref: join(ui, "ref"), runs: join(ui, "runs"), shots: join(ui, "shots") };
}

/** Copies a site project without its install; node_modules becomes a link to the source's, so one npm install serves every copy. */
export async function copyProject(from: string, to: string) {
  await cp(from, to, { recursive: true, filter: (src) => !/[\\/](node_modules|dist)$/.test(src) });
  await symlink(await realpath(join(from, "node_modules")), join(to, "node_modules"), "junction");
}

/** Deletes a copied project; the linked node_modules is unlinked first so rm can never reach into the shared install. */
export async function removeProject(root: string) {
  await unlink(join(root, "node_modules")).catch((e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT") throw e; });
  await rm(root, { recursive: true, force: true });
}

export const syncStage = (dir: string) => removeProject(paths(dir).stage).then(() => copyProject(paths(dir).site, paths(dir).stage));

export async function loadPlan(dir: string): Promise<Plan | undefined> {
  const text = await readFile(paths(dir).plan, "utf8").catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return undefined; throw e; });
  return text === undefined ? undefined : (JSON.parse(text) as Plan);
}

export async function savePlan(dir: string, plan: Plan) {
  await mkdir(join(dir, ".ui"), { recursive: true });
  await writeFile(paths(dir).plan, JSON.stringify(plan, null, 2));
}

// A section is its .tsx plus, for a 3D showpiece, the lazily loaded scene and the poster shown until (or instead of) the canvas.
const PARTS = [".tsx", ".scene.tsx", ".poster.svg"];
async function copySection(id: string, from: string, to: string) {
  await mkdir(to, { recursive: true });
  for (const ext of PARTS) await cp(join(from, id + ext), join(to, id + ext)).catch((e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT" || ext === ".tsx") throw e; });
}
/** The section's files currently on stage, by file name. */
export const stageFiles = async (dir: string, id: string) =>
  Object.fromEntries((await Promise.all(PARTS.map(async (ext) => [id + ext, await readFile(join(paths(dir).stage, SECTIONS, id + ext), "utf8").catch(() => undefined)]))).filter(([, code]) => code !== undefined)) as Record<string, string>;

export const snapshot = (dir: string, id: string) => copySection(id, join(paths(dir).stage, SECTIONS), paths(dir).green);
export const restore = (dir: string, id: string) => copySection(id, paths(dir).green, join(paths(dir).stage, SECTIONS));

/** Makes the live site show exactly `ids` (in that order) from their green snapshots, plus stage tokens and font links. */
export async function promote(dir: string, ids: string[]) {
  const { site, stage, green } = paths(dir);
  for (const id of ids) await copySection(id, green, join(site, SECTIONS));
  for (const file of ["src/tokens.css", "index.html"]) await cp(join(stage, file), join(site, file));
  await writeRegistry(site, ids);
}

export function runLog(dir: string) {
  const { runs } = paths(dir);
  const file = join(runs, `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  return async (event: Omit<Event, "t">) => {
    await mkdir(runs, { recursive: true });
    await appendFile(file, JSON.stringify({ t: Date.now(), ...event }) + "\n");
  };
}
