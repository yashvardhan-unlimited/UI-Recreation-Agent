import { spawn, type ChildProcess } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import getPort from "get-port";
import { commandInvocation, runProcess, safeChildEnvironment, terminateProcessTree, type ProcessResult } from "../utils/process.js";
import { UiAgentError } from "../utils/errors.js";
import { deadlineSignal } from "../utils/abort.js";

export interface PreviewStatus {
  running: boolean;
  projectRoot: string;
  url?: string;
  port?: number;
  pid?: number | undefined;
  startedAt?: string;
  logs: string;
}

interface PreviewRecord {
  child: ChildProcess;
  url: string;
  port: number;
  startedAt: string;
  logs: string;
}

export class PreviewManager {
  private readonly processes = new Map<string, PreviewRecord>();
  private cleanupBound = false;

  constructor(private readonly timeoutMs: number, private readonly maxLogBytes = 128 * 1024) {}

  async install(projectRoot: string, signal?: AbortSignal): Promise<ProcessResult> {
    if (await exists(path.join(projectRoot, "package-lock.json"))) return this.checkedRun("npm", ["ci", "--ignore-scripts"], projectRoot, signal);
    if (await exists(path.join(projectRoot, "pnpm-lock.yaml"))) return this.checkedRun("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], projectRoot, signal);
    if (await exists(path.join(projectRoot, "yarn.lock"))) return this.checkedRun("yarn", ["install", "--immutable", "--ignore-scripts"], projectRoot, signal);
    // Fresh agent-created projects cannot have a committed lockfile yet. Generate the
    // deterministic npm lock before installing; lifecycle scripts remain disabled for
    // both commands. Existing projects keep their package-manager lock semantics.
    await this.createLockfile(projectRoot, signal);
    return this.checkedRun("npm", ["ci", "--ignore-scripts"], projectRoot, signal);
  }

  async createLockfile(projectRoot: string, signal?: AbortSignal): Promise<ProcessResult> {
    if (await exists(path.join(projectRoot, "package-lock.json"))) throw new UiAgentError("CONFLICT", "package-lock.json already exists.");
    if (!await exists(path.join(projectRoot, "package.json"))) throw new UiAgentError("NOT_FOUND", "package.json is required before creating a lockfile.");
    return this.checkedRun("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], projectRoot, signal);
  }

  async build(projectRoot: string, signal?: AbortSignal): Promise<ProcessResult> {
    return this.runPackageScript(projectRoot, "build", [], signal);
  }

  async runScript(projectRoot: string, script: string, args: string[] = [], signal?: AbortSignal): Promise<ProcessResult> {
    return this.runPackageScript(projectRoot, script, args, signal);
  }

  async start(projectRoot: string, options: { script?: string; port?: number; signal?: AbortSignal | undefined } = {}): Promise<PreviewStatus> {
    const key = path.resolve(projectRoot);
    const current = this.processes.get(key);
    if (current && current.child.exitCode === null) return this.status(key);
    const packageJson = JSON.parse(await readFile(path.join(key, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    const hasBuiltOutput = await exists(path.join(key, "dist"));
    const script = options.script ?? (hasBuiltOutput && packageJson.scripts?.preview ? "preview" : packageJson.scripts?.dev ? "dev" : packageJson.scripts?.preview ? "preview" : packageJson.scripts?.start ? "start" : undefined);
    if (!script) throw new UiAgentError("INVALID_INPUT", "No dev, preview, or start script was found.");
    const port = options.port ?? await getPort({ port: [4173, 5173, 3000, 8080] });
    const args = ["run", script, "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"];
    const invocation = commandInvocation("npm", args);
    const child = spawn(invocation.command, invocation.args, {
      cwd: key,
      env: safeChildEnvironment({ PORT: String(port), HOST: "127.0.0.1" }),
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const record: PreviewRecord = { child, url: `http://127.0.0.1:${port}`, port, startedAt: new Date().toISOString(), logs: "" };
    const append = (chunk: Buffer): void => {
      record.logs = `${record.logs}${chunk.toString("utf8")}`;
      if (Buffer.byteLength(record.logs) > this.maxLogBytes) record.logs = Buffer.from(record.logs).subarray(-this.maxLogBytes).toString("utf8");
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("exit", () => { if (this.processes.get(key)?.child === child) this.processes.delete(key); });
    this.processes.set(key, record);
    this.bindCleanup();
    try {
      await this.waitReady(record.url, record, options.signal);
    } catch (error) {
      await this.stop(key);
      throw error;
    }
    return this.status(key);
  }

  status(projectRoot: string): PreviewStatus {
    const key = path.resolve(projectRoot);
    const record = this.processes.get(key);
    if (!record || record.child.exitCode !== null) return { running: false, projectRoot: key, logs: record?.logs ?? "" };
    return { running: true, projectRoot: key, url: record.url, port: record.port, pid: record.child.pid, startedAt: record.startedAt, logs: record.logs };
  }

  async stop(projectRoot: string): Promise<PreviewStatus> {
    const key = path.resolve(projectRoot);
    const record = this.processes.get(key);
    if (record) {
      await terminateProcessTree(record.child);
      this.processes.delete(key);
    }
    return { running: false, projectRoot: key, logs: record?.logs ?? "" };
  }

  async cleanup(): Promise<void> {
    await Promise.all([...this.processes.keys()].map((root) => this.stop(root)));
  }

  private async runPackageScript(projectRoot: string, script: string, args: string[], signal?: AbortSignal): Promise<ProcessResult> {
    const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    if (!packageJson.scripts?.[script]) throw new UiAgentError("INVALID_INPUT", `Missing package script: ${script}`);
    return this.checkedRun("npm", ["run", script, ...(args.length ? ["--", ...args] : [])], projectRoot, signal);
  }

  private async checkedRun(command: string, args: string[], cwd: string, signal?: AbortSignal): Promise<ProcessResult> {
    const result = await runProcess(command, args, { cwd, timeoutMs: this.timeoutMs, signal });
    if (result.exitCode !== 0) throw new UiAgentError("PROCESS_FAILED", `${result.command} exited with code ${result.exitCode}.`, { details: { stdout: result.stdout.slice(-4_000), stderr: result.stderr.slice(-4_000) } });
    return result;
  }

  private async waitReady(url: string, record: PreviewRecord, parent?: AbortSignal): Promise<void> {
    const signal = deadlineSignal(Math.min(this.timeoutMs, 60_000), parent);
    while (!signal.aborted) {
      if (record.child.exitCode !== null) throw new UiAgentError("PROCESS_FAILED", `Preview exited before readiness. ${record.logs.slice(-2_000)}`);
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
        if (response.status >= 200 && response.status < 500) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new UiAgentError(parent?.aborted ? "ABORTED" : "TIMEOUT", parent?.aborted ? "Preview start cancelled." : `Preview did not become ready at ${url}.`, { details: { logs: record.logs.slice(-2_000) } });
  }

  private bindCleanup(): void {
    if (this.cleanupBound) return;
    this.cleanupBound = true;
    process.once("exit", () => { for (const record of this.processes.values()) record.child.kill(); });
    for (const event of ["SIGINT", "SIGTERM"] as const) process.once(event, () => { void this.cleanup().finally(() => process.exit(130)); });
  }
}

async function exists(filePath: string): Promise<boolean> {
  try { await access(filePath); return true; } catch { return false; }
}
