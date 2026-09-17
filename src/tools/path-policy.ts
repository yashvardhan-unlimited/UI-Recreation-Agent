import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { UiAgentError } from "../utils/errors.js";

const blockedNames = new Set([".env", ".npmrc", ".pypirc", ".netrc", ".git-credentials", "id_rsa", "id_ed25519", "auth.json", "credentials", "credentials.json", "secrets", "secrets.json"]);
const blockedDirectories = new Set([".git", ".ssh", ".aws", ".azure", ".kube", ".docker", ".gnupg", ".codex", ".pi", ".ui-agent"]);
const binaryExtensions = new Set([".exe", ".dll", ".so", ".dylib", ".zip", ".tar", ".gz", ".7z", ".pdf", ".woff", ".woff2", ".ttf", ".otf", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".ico", ".mp4", ".mov", ".mp3"]);

export class ProjectPathPolicy {
  readonly root: string;
  private rootReal?: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async resolve(input: string, options: { mustExist?: boolean; allowBinary?: boolean; allowSensitive?: boolean } = {}): Promise<string> {
    if (input.includes("\0")) throw new UiAgentError("INVALID_INPUT", "Path contains a null byte.");
    const candidate = path.resolve(this.root, input);
    this.assertLexical(candidate);
    if (!options.allowSensitive) this.assertNotSensitive(candidate);
    if (!options.allowBinary && binaryExtensions.has(path.extname(candidate).toLowerCase())) throw new UiAgentError("INVALID_INPUT", `Binary file access is blocked: ${input}`);
    const rootReal = await this.getRootReal();
    try {
      const resolved = await realpath(candidate);
      this.assertWithin(resolved, rootReal);
      const stat = await lstat(resolved);
      if (stat.isSymbolicLink()) throw new UiAgentError("PATH_OUTSIDE_PROJECT", `Symbolic links are not accepted: ${input}`);
      return resolved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (options.mustExist) throw new UiAgentError("NOT_FOUND", `File does not exist: ${input}`);
      const existingParent = await this.nearestExistingParent(path.dirname(candidate));
      const parentReal = await realpath(existingParent);
      this.assertWithin(parentReal, rootReal);
      return candidate;
    }
  }

  relative(absolute: string): string {
    return path.relative(this.root, absolute).replaceAll("\\", "/");
  }

  private assertLexical(candidate: string): void {
    this.assertWithin(candidate, this.root);
  }

  private assertWithin(candidate: string, root: string): void {
    const relative = path.relative(root, candidate);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
    throw new UiAgentError("PATH_OUTSIDE_PROJECT", `Path escapes the project root: ${candidate}`);
  }

  private assertNotSensitive(candidate: string): void {
    const relative = path.relative(this.root, candidate).replaceAll("\\", "/");
    const parts = relative.split("/").map((part) => part.toLowerCase());
    const base = parts.at(-1) ?? "";
    if (parts.some((part) => blockedNames.has(part) || blockedDirectories.has(part) || part.startsWith(".env.")) || [".pem", ".key", ".p12", ".pfx"].includes(path.extname(base))) {
      throw new UiAgentError("SECRET_FILE_BLOCKED", `Sensitive path is blocked: ${relative}`);
    }
  }

  private async getRootReal(): Promise<string> {
    this.rootReal ??= await realpath(this.root);
    return this.rootReal;
  }

  private async nearestExistingParent(start: string): Promise<string> {
    let current = start;
    while (true) {
      try {
        await lstat(current);
        return current;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const parent = path.dirname(current);
        if (parent === current) throw new UiAgentError("PATH_OUTSIDE_PROJECT", "Could not resolve a safe parent directory.");
        current = parent;
      }
    }
  }
}
