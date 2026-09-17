import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { runProcess } from "../utils/process.js";

export interface ProjectInspection {
  root: string;
  packageManager: "npm" | "pnpm" | "yarn" | "bun" | "unknown";
  framework: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  styling: string[];
  routes: string[];
  assets: string[];
  git: { repository: boolean; branch?: string; dirty: boolean; changes: string[] };
}

export async function inspectProject(root: string, signal?: AbortSignal): Promise<ProjectInspection> {
  const packageJson = await readPackageJson(root);
  const dependencies = stringRecord(packageJson?.dependencies);
  const devDependencies = stringRecord(packageJson?.devDependencies);
  const allDependencies = { ...dependencies, ...devDependencies };
  const files = await walkBounded(root, 4, 2_000);
  const manager = await detectPackageManager(root);
  const framework = detectFramework(allDependencies, files);
  const styling = detectStyling(allDependencies, files);
  const routes = files.filter((file) => /(^|\/)(pages|app|routes)\/.+\.(tsx?|jsx?|vue|svelte)$/.test(file)).slice(0, 200);
  const assets = files.filter((file) => /(^|\/)(public|assets)\/.+\.(png|jpe?g|webp|avif|gif|svg|woff2?|ttf|otf)$/i.test(file)).slice(0, 500);
  const git = await inspectGit(root, signal);
  return {
    root,
    packageManager: manager,
    framework,
    scripts: stringRecord(packageJson?.scripts),
    dependencies,
    devDependencies,
    styling,
    routes,
    assets,
    git
  };
}

async function readPackageJson(root: string): Promise<Record<string, unknown> | undefined> {
  try { return JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as Record<string, unknown>; } catch { return undefined; }
}

async function detectPackageManager(root: string): Promise<ProjectInspection["packageManager"]> {
  const candidates: Array<[string, ProjectInspection["packageManager"]]> = [["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lock", "bun"], ["bun.lockb", "bun"], ["package-lock.json", "npm"]];
  for (const [file, manager] of candidates) { try { await access(path.join(root, file)); return manager; } catch {} }
  return "unknown";
}

function detectFramework(dependencies: Record<string, string>, files: string[]): string {
  if (dependencies.next) return "Next.js";
  if (dependencies["@remix-run/react"]) return "Remix";
  if (dependencies.astro) return "Astro";
  if (dependencies.vue) return "Vue";
  if (dependencies.svelte) return "Svelte";
  if (dependencies.react && files.some((file) => /^vite\.config\./.test(file))) return "React + Vite";
  if (dependencies.react) return "React";
  return files.includes("index.html") ? "Static HTML" : "Unknown";
}

function detectStyling(dependencies: Record<string, string>, files: string[]): string[] {
  const result: string[] = [];
  if (dependencies.tailwindcss) result.push("Tailwind CSS");
  if (dependencies["styled-components"]) result.push("styled-components");
  if (dependencies["@emotion/react"]) result.push("Emotion");
  if (files.some((file) => file.endsWith(".module.css"))) result.push("CSS Modules");
  if (files.some((file) => file.endsWith(".scss"))) result.push("Sass");
  if (files.some((file) => file.endsWith(".css"))) result.push("CSS");
  return [...new Set(result)];
}

async function inspectGit(root: string, signal?: AbortSignal): Promise<ProjectInspection["git"]> {
  try {
    const result = await runProcess("git", ["status", "--short", "--branch"], { cwd: root, timeoutMs: 10_000, signal, maxOutputBytes: 32_000 });
    if (result.exitCode !== 0) return { repository: false, dirty: false, changes: [] };
    const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    return { repository: true, ...(lines[0] ? { branch: lines[0].replace(/^##\s*/, "") } : {}), dirty: lines.length > 1, changes: lines.slice(1) };
  } catch { return { repository: false, dirty: false, changes: [] }; }
}

async function walkBounded(root: string, maxDepth: number, maxFiles: number): Promise<string[]> {
  const output: string[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > maxDepth || output.length >= maxFiles) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (output.length >= maxFiles || ["node_modules", ".git", ".ui-agent", "dist", "build", ".next"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      if (entry.isDirectory()) await visit(absolute, depth + 1);
      else if (entry.isFile()) {
        try { if ((await stat(absolute)).size <= 20 * 1024 * 1024) output.push(relative); } catch {}
      }
    }
  };
  await visit(root, 0);
  return output;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
