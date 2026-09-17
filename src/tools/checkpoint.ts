import { cp, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sha256 } from "./files.js";
import { UiAgentError } from "../utils/errors.js";
import { writeJsonAtomic } from "../utils/fs.js";
import { z } from "zod";
import { ProjectPathPolicy } from "./path-policy.js";

interface CheckpointManifest { schemaVersion: 1; id: string; createdAt: string; files: Array<{ path: string; sha256: string }> }
const checkpointManifestSchema = z.object({ schemaVersion: z.literal(1), id: z.string(), createdAt: z.string().datetime(), files: z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).max(20_000) });

export interface CheckpointCandidate {
  id: string;
  requiredGatesPass: boolean;
  blockerDefects: number;
  highDefects: number;
  designQuality: number;
  accessibility: number;
  performance: number;
}

export function selectBestCheckpoint(candidates: CheckpointCandidate[]): CheckpointCandidate | undefined {
  return [...candidates].sort((a, b) =>
    Number(b.requiredGatesPass) - Number(a.requiredGatesPass)
    || a.blockerDefects - b.blockerDefects
    || a.highDefects - b.highDefects
    || b.designQuality - a.designQuality
    || b.accessibility - a.accessibility
    || b.performance - a.performance
  )[0];
}

export async function createCheckpoint(projectRoot: string, runRoot: string): Promise<{ id: string; path: string; files: number }> {
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 6)}`;
  const destination = path.join(runRoot, "checkpoints", id);
  const sourceDestination = path.join(destination, "source");
  await mkdir(sourceDestination, { recursive: true });
  const files = await listProjectFiles(projectRoot);
  const manifest: CheckpointManifest = { schemaVersion: 1, id, createdAt: new Date().toISOString(), files: [] };
  for (const relative of files) {
    const source = path.join(projectRoot, relative);
    const target = path.join(sourceDestination, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { force: false, recursive: false });
    manifest.files.push({ path: relative.replaceAll("\\", "/"), sha256: sha256(await readFile(source)) });
  }
  await writeJsonAtomic(path.join(destination, "checkpoint.json"), manifest);
  return { id, path: destination, files: files.length };
}

export async function restoreCheckpoint(input: { projectRoot: string; checkpointRoot: string; checkpointPath: string; expectedCurrentHashes: Record<string, string> }): Promise<{ restored: string[] }> {
  const checkpointPolicy = new ProjectPathPolicy(input.checkpointRoot);
  const relativeCheckpoint = path.relative(input.checkpointRoot, path.resolve(input.checkpointPath));
  const safeCheckpoint = await checkpointPolicy.resolve(relativeCheckpoint);
  const manifest = checkpointManifestSchema.parse(JSON.parse(await readFile(path.join(safeCheckpoint, "checkpoint.json"), "utf8"))) as CheckpointManifest;
  const projectPolicy = new ProjectPathPolicy(input.projectRoot);
  const restored: string[] = [];
  for (const entry of manifest.files) {
    const target = await projectPolicy.resolve(entry.path, { allowBinary: true });
    let current: Buffer | undefined;
    try { current = await readFile(target); } catch {}
    const expected = input.expectedCurrentHashes[entry.path];
    if (current && (!expected || sha256(current) !== expected)) throw new UiAgentError("CONFLICT", `Refusing to restore over unrecognized changes: ${entry.path}`);
  }
  for (const entry of manifest.files) {
    const source = await new ProjectPathPolicy(path.join(safeCheckpoint, "source")).resolve(entry.path, { allowBinary: true });
    const target = await projectPolicy.resolve(entry.path, { allowBinary: true });
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { force: true });
    restored.push(entry.path);
  }
  return { restored };
}

async function listProjectFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const policy = new ProjectPathPolicy(root);
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (["node_modules", ".git", ".ui-agent", "dist", "build", ".next", "coverage", "playwright-report", "test-results"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && (await stat(absolute)).size <= 5 * 1024 * 1024) {
        const relative = path.relative(root, absolute);
        try { await policy.resolve(relative, { mustExist: true, allowBinary: true }); files.push(relative); } catch (error) {
          if (!(error instanceof UiAgentError) || error.code !== "SECRET_FILE_BLOCKED") throw error;
        }
      }
    }
  };
  await visit(root);
  return files;
}
