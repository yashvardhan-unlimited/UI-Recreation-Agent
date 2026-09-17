import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { UiAgentError } from "./errors.js";
import { deadlineSignal } from "./abort.js";

export interface ProcessResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
}

export function safeChildEnvironment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const allowed = ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP", "ProgramFiles", "ProgramFiles(x86)"];
  const environment: NodeJS.ProcessEnv = {};
  for (const key of allowed) if (process.env[key]) environment[key] = process.env[key];
  return { ...environment, CI: "1", NO_COLOR: "1", UI_AGENT_PREVIEW: "1", ...extra };
}

export async function runProcess(command: string, args: string[], options: { cwd: string; timeoutMs: number; signal?: AbortSignal | undefined; maxOutputBytes?: number; env?: Record<string, string> }): Promise<ProcessResult> {
  const started = performance.now();
  const max = options.maxOutputBytes ?? 128 * 1024;
  const combinedSignal = deadlineSignal(options.timeoutMs, options.signal);
  const invocation = commandInvocation(command, args);
  const child = spawn(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: safeChildEnvironment(options.env),
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  let truncated = false;
  const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
    const current = target === "stdout" ? stdout : stderr;
    if (Buffer.byteLength(current) >= max) { truncated = true; return; }
    const next = `${current}${chunk.toString("utf8")}`;
    const bounded = Buffer.byteLength(next) > max ? Buffer.from(next).subarray(0, max).toString("utf8") : next;
    if (target === "stdout") stdout = bounded; else stderr = bounded;
    if (bounded.length < next.length) truncated = true;
  };
  child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
  child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
  const onAbort = () => void terminateProcessTree(child);
  combinedSignal.addEventListener("abort", onAbort, { once: true });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  }).finally(() => combinedSignal.removeEventListener("abort", onAbort));
  if (combinedSignal.aborted) throw new UiAgentError(options.signal?.aborted ? "ABORTED" : "TIMEOUT", options.signal?.aborted ? "Process cancelled." : `Process exceeded ${options.timeoutMs} ms.`, { details: { command } });
  return { command: [command, ...args].join(" "), exitCode, stdout, stderr, truncated, durationMs: Math.round(performance.now() - started) };
}

export async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    await new Promise<void>((resolve) => killer.once("exit", () => resolve()));
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
  }
}

export function commandForPlatform(command: string): string {
  return commandInvocation(command, []).command;
}

export function commandInvocation(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform === "win32" && (command === "npm" || command === "npx")) {
    const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", command === "npm" ? "npm-cli.js" : "npx-cli.js");
    return { command: process.execPath, args: [cli, ...args] };
  }
  return { command, args };
}
