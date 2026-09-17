import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProjectPathPolicy } from "./path-policy.js";
import { UiAgentError } from "../utils/errors.js";

export interface FileReadResult { path: string; content: string; bytes: number; sha256: string; truncated: boolean }
export interface UiPatchOperation { path: string; action: "create" | "replace" | "edit"; content?: string; find?: string; replace?: string; expectedSha256?: string }
export interface UiPatchResult { files: Array<{ path: string; action: string; beforeSha256?: string; afterSha256: string; bytes: number }> }

export async function readRelevantFiles(root: string, paths: string[], options: { maxFiles?: number; maxBytesPerFile?: number; maxTotalBytes?: number } = {}): Promise<FileReadResult[]> {
  const policy = new ProjectPathPolicy(root);
  const maxFiles = options.maxFiles ?? 30;
  const maxPerFile = options.maxBytesPerFile ?? 96 * 1024;
  const maxTotal = options.maxTotalBytes ?? 512 * 1024;
  if (paths.length > maxFiles) throw new UiAgentError("INVALID_INPUT", `At most ${maxFiles} files may be read at once.`);
  const results: FileReadResult[] = [];
  let total = 0;
  for (const input of paths) {
    const absolute = await policy.resolve(input, { mustExist: true });
    const info = await stat(absolute);
    if (!info.isFile()) throw new UiAgentError("INVALID_INPUT", `Not a regular file: ${input}`);
    if (total >= maxTotal) break;
    const buffer = await readFile(absolute);
    if (buffer.includes(0)) throw new UiAgentError("INVALID_INPUT", `Binary content is blocked: ${input}`);
    const allowed = Math.min(maxPerFile, maxTotal - total);
    const slice = buffer.subarray(0, allowed);
    total += slice.length;
    results.push({ path: policy.relative(absolute), content: slice.toString("utf8"), bytes: buffer.length, sha256: sha256(buffer), truncated: slice.length < buffer.length });
  }
  return results;
}

export async function applyUiPatch(root: string, operations: UiPatchOperation[]): Promise<UiPatchResult> {
  if (operations.length === 0 || operations.length > 50) throw new UiAgentError("INVALID_INPUT", "A UI patch must contain 1–50 file operations.");
  const policy = new ProjectPathPolicy(root);
  const resolved = await Promise.all(operations.map(async (operation) => ({ operation, absolute: await policy.resolve(operation.path) })));
  const duplicates = resolved.map((item) => item.absolute).filter((value, index, all) => all.indexOf(value) !== index);
  if (duplicates.length) throw new UiAgentError("INVALID_INPUT", "A patch cannot modify the same file twice.");
  const prepared: Array<{ absolute: string; next: string; output: UiPatchResult["files"][number] }> = [];
  for (const { operation, absolute } of resolved) {
    let before: Buffer | undefined;
    try { before = await readFile(absolute); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const beforeHash = before ? sha256(before) : undefined;
    if (before && operation.action !== "create" && !operation.expectedSha256) throw new UiAgentError("CONFLICT", `Editing an existing file requires the sha256 returned by read_relevant_files: ${operation.path}`);
    if (operation.expectedSha256 && beforeHash !== operation.expectedSha256) throw new UiAgentError("CONFLICT", `File changed since it was read: ${operation.path}`);
    let next: string;
    if (operation.action === "create") {
      if (before) throw new UiAgentError("CONFLICT", `Refusing to overwrite existing file with create: ${operation.path}`);
      if (operation.content === undefined) throw new UiAgentError("INVALID_INPUT", "Create requires content.");
      next = operation.content;
    } else if (operation.action === "replace") {
      if (!before) throw new UiAgentError("NOT_FOUND", `Cannot replace missing file: ${operation.path}`);
      if (operation.content === undefined) throw new UiAgentError("INVALID_INPUT", "Replace requires content.");
      next = operation.content;
    } else {
      if (!before) throw new UiAgentError("NOT_FOUND", `Cannot edit missing file: ${operation.path}`);
      if (operation.find === undefined || operation.replace === undefined || operation.find.length === 0) throw new UiAgentError("INVALID_INPUT", "Edit requires non-empty find and replace strings.");
      const current = before.toString("utf8");
      const occurrences = current.split(operation.find).length - 1;
      if (occurrences !== 1) throw new UiAgentError("CONFLICT", `Edit anchor must occur exactly once in ${operation.path}; found ${occurrences}.`);
      next = current.replace(operation.find, operation.replace);
    }
    if (Buffer.byteLength(next) > 2 * 1024 * 1024) throw new UiAgentError("INVALID_INPUT", `Patched file exceeds 2 MiB: ${operation.path}`);
    const after = Buffer.from(next);
    prepared.push({ absolute, next, output: { path: policy.relative(absolute), action: operation.action, ...(beforeHash ? { beforeSha256: beforeHash } : {}), afterSha256: sha256(after), bytes: after.length } });
  }
  for (const item of prepared) {
    await mkdir(path.dirname(item.absolute), { recursive: true });
    await writeFile(item.absolute, item.next, "utf8");
  }
  return { files: prepared.map((item) => item.output) };
}

export function sha256(buffer: Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}
