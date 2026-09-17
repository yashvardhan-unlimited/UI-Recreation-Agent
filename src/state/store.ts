import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { InteractionLevel } from "../config/schema.js";
import { slugify, writeJsonAtomic } from "../utils/fs.js";
import { UiAgentError } from "../utils/errors.js";
import { runManifestSchema, type RunManifest } from "./schema.js";

export class RunStore {
  readonly baseDir: string;

  constructor(workspaceRoot: string) {
    this.baseDir = path.join(workspaceRoot, ".ui-agent", "runs");
  }

  async create(input: { kind: RunManifest["kind"]; brief: string; projectRoot: string; interaction: InteractionLevel; references?: string[] | undefined; referenceUrl?: string | undefined }): Promise<RunManifest> {
    const now = new Date().toISOString();
    const runId = `${now.slice(0, 10)}-${slugify(input.kind)}-${randomUUID().slice(0, 8)}`;
    const runRoot = path.join(this.baseDir, runId);
    await mkdir(this.baseDir, { recursive: true });
    await mkdir(runRoot, { recursive: false });
    const immutableReferences: string[] = [];
    if (input.references?.length) {
      const referenceRoot = path.join(runRoot, "references");
      await mkdir(referenceRoot, { recursive: true });
      for (let index = 0; index < input.references.length; index += 1) {
        const source = path.resolve(input.references[index]!);
        const info = await stat(source);
        if (!info.isFile() || info.size > 50 * 1024 * 1024) throw new UiAgentError("INVALID_INPUT", `Reference must be a file of at most 50 MiB: ${source}`);
        const safeName = `${String(index + 1).padStart(2, "0")}-${path.basename(source).replace(/[^a-zA-Z0-9._-]/g, "-")}`;
        const destination = path.join(referenceRoot, safeName);
        await copyFile(source, destination);
        immutableReferences.push(destination);
      }
    }
    const manifest = runManifestSchema.parse({
      schemaVersion: 1,
      runId,
      kind: input.kind,
      createdAt: now,
      updatedAt: now,
      immutableInput: { brief: input.brief, references: immutableReferences, ...(input.referenceUrl ? { referenceUrl: input.referenceUrl } : {}) },
      projectRoot: path.resolve(input.projectRoot),
      runRoot,
      interaction: input.interaction,
      status: "running",
      stage: "UNDERSTAND",
      counters: { repairRounds: 0, stagnantRounds: 0, retries: 0 }
    });
    await this.save(manifest);
    await writeJsonAtomic(path.join(runRoot, "input.json"), manifest.immutableInput);
    return manifest;
  }

  async load(runId: string): Promise<RunManifest> {
    const filePath = this.manifestPath(runId);
    try {
      const manifest = runManifestSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
      const expectedRunRoot = path.resolve(this.baseDir, runId);
      if (path.resolve(manifest.runRoot) !== expectedRunRoot) throw new UiAgentError("CONFLICT", "Run manifest root does not match its agent-owned directory.");
      return manifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new UiAgentError("NOT_FOUND", `Run not found: ${runId}`);
      throw error;
    }
  }

  async save(manifest: RunManifest): Promise<void> {
    const validated = runManifestSchema.parse({ ...manifest, updatedAt: new Date().toISOString() });
    await writeJsonAtomic(this.manifestPath(validated.runId), validated);
  }

  async list(): Promise<RunManifest[]> {
    try {
      const entries = await readdir(this.baseDir, { withFileTypes: true });
      const manifests = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
        try { return await this.load(entry.name); } catch { return undefined; }
      }));
      return manifests.filter((value): value is RunManifest => value !== undefined).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  manifestPath(runId: string): string {
    if (!/^[a-zA-Z0-9._-]+$/.test(runId)) throw new UiAgentError("INVALID_INPUT", "Invalid run ID.");
    return path.join(this.baseDir, runId, "manifest.json");
  }
}
