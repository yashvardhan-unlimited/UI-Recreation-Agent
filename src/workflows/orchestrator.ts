import { access, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/schema.js";
import { loadProjectEnv } from "../config/load.js";
import { resolveModelBackend } from "../model/discovery.js";
import { doctorMatchesConfig, hasPassingCheck, loadLatestDoctorReport, verifiedVisualModel } from "../model/doctor-cache.js";
import { RunStore } from "../state/store.js";
import { UiAgentError } from "../utils/errors.js";
import type { Logger } from "../utils/log.js";
import { createPiHarness, runInteractiveHarness } from "../pi/session.js";
import { initialWorkflowPrompt, resumeWorkflowPrompt } from "./prompts.js";

export async function startWorkflow(input: { kind: "create" | "improve" | "recreate" | "audit"; brief: string; projectRoot: string; workspaceRoot: string; config: AppConfig; logger: Logger; references?: string[]; referenceUrl?: string; urlAuthorized?: boolean; interactive?: boolean }): Promise<string> {
  loadProjectEnv(input.workspaceRoot);
  assertSupportedProtocol(input.config);
  const projectRoot = path.resolve(input.projectRoot);
  if (input.kind === "create") await ensureCreateTarget(projectRoot);
  else await access(projectRoot);
  if (input.kind === "recreate" && input.referenceUrl && !input.urlAuthorized) throw new UiAgentError("APPROVAL_REQUIRED", "URL recreation requires explicit --authorized confirmation.");
  await mkdir(projectRoot, { recursive: true });
  const backend = await resolveModelBackend(input.config);
  const activeConfig = backend.config;
  const selected = backend.selected;
  const doctor = await loadLatestDoctorReport(input.workspaceRoot);
  if (!doctorMatchesConfig(doctor, activeConfig, selected.coding.name, backend.provider) || !hasPassingCheck(doctor, "text", selected.coding.name) || !hasPassingCheck(doctor, "pi_tool_roundtrip", selected.coding.name)) {
    throw new UiAgentError("CAPABILITY_MISSING", `Model ${selected.coding.name} has not passed the current text and Pi tool-roundtrip doctor checks.`, { suggestion: "Run ui-agent doctor with either local inference or the Groq fallback available." });
  }
  const visualModelId = verifiedVisualModel(doctor, selected.visual?.name);
  if (input.kind === "recreate" && !visualModelId) throw new UiAgentError("CAPABILITY_MISSING", "Recreation is refused until the active visual model passes genuine one-image and two-image doctor checks.", { suggestion: "Configure a visual model and run ui-agent doctor." });
  const runStore = new RunStore(input.workspaceRoot);
  let run = await runStore.create({ kind: input.kind, brief: input.brief, projectRoot, interaction: input.config.interaction, references: input.references, referenceUrl: input.referenceUrl });
  if (input.urlAuthorized && input.referenceUrl) {
    run = { ...run, approvals: [...run.approvals, { id: crypto.randomUUID(), kind: "url_authorization", approved: true, summary: `User confirmed authorization for ${input.referenceUrl}`, at: new Date().toISOString() }] };
    await runStore.save(run);
  }
  const harness = await createPiHarness({ config: activeConfig, provider: backend.provider, model: selected.coding, availableModels: backend.models, ...(visualModelId ? { visualModelId } : {}), run, runStore, logger: input.logger });
  run = { ...run, model: { provider: backend.provider, codingModelId: selected.coding.name, ...(visualModelId ? { visualModelId } : {}), protocol: activeConfig.model.protocol, endpoint: activeConfig.model.inferenceBaseUrl }, ...(harness.session.sessionFile ? { piSessionFile: harness.session.sessionFile } : {}) };
  await runStore.save(run);
  try {
    const prompt = initialWorkflowPrompt(run);
    if (input.interactive ?? (input.config.interaction !== "autonomous" && Boolean(process.stdin.isTTY))) await runInteractiveHarness(harness, prompt);
    else await harness.session.prompt(prompt);
  } catch (error) {
    const latest = await runStore.load(run.runId);
    if (latest.status !== "pending_input") await runStore.save({ ...latest, status: error instanceof UiAgentError && error.code === "ABORTED" ? "cancelled" : "failed", stopReason: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally { await harness.dispose(); }
  return run.runId;
}

export async function resumeWorkflow(input: { runId: string; workspaceRoot: string; config: AppConfig; logger: Logger; interactive?: boolean }): Promise<void> {
  loadProjectEnv(input.workspaceRoot);
  assertSupportedProtocol(input.config);
  const runStore = new RunStore(input.workspaceRoot);
  const run = await runStore.load(input.runId);
  const backend = await resolveModelBackend(configForRun(input.config, run.model));
  const activeConfig = backend.config;
  const selected = backend.selected;
  const doctor = await loadLatestDoctorReport(input.workspaceRoot);
  if (!doctorMatchesConfig(doctor, activeConfig, selected.coding.name, backend.provider) || !hasPassingCheck(doctor, "pi_tool_roundtrip", selected.coding.name)) throw new UiAgentError("CAPABILITY_MISSING", "Resume requires a current matching Pi tool-roundtrip doctor check.");
  const visualModelId = verifiedVisualModel(doctor, selected.visual?.name);
  const resumedRun = run.status === "pending_input" ? run : { ...run, status: "running" as const };
  const harness = await createPiHarness({ config: activeConfig, provider: backend.provider, model: selected.coding, availableModels: backend.models, ...(visualModelId ? { visualModelId } : {}), run: resumedRun, runStore, logger: input.logger, resumeSessionFile: run.piSessionFile });
  try {
    const prompt = resumeWorkflowPrompt(run);
    if (input.interactive ?? (run.interaction !== "autonomous" && Boolean(process.stdin.isTTY))) await runInteractiveHarness(harness, prompt);
    else await harness.session.prompt(prompt);
  } finally { await harness.dispose(); }
}

function configForRun(config: AppConfig, model: { provider: string; codingModelId: string; visualModelId?: string | undefined } | undefined): AppConfig {
  if (!model) return config;
  if (model.provider === "groq") {
    return {
      ...config,
      model: {
        ...config.model,
        provider: "groq",
        groq: { ...config.model.groq, codingModelId: model.codingModelId, ...(model.visualModelId ? { visualModelId: model.visualModelId } : {}) }
      }
    };
  }
  return { ...config, model: { ...config.model, provider: "local", codingModelId: model.codingModelId, ...(model.visualModelId ? { visualModelId: model.visualModelId } : {}) } };
}

function assertSupportedProtocol(config: AppConfig): void {
  if (config.model.protocol !== "openai-completions") {
    throw new UiAgentError("CAPABILITY_MISSING", "This Pi SDK build requires an OpenAI-compatible completions provider.", { suggestion: "Set model.protocol to openai-completions." });
  }
}

async function ensureCreateTarget(projectRoot: string): Promise<void> {
  try {
    const entries = await readdir(projectRoot);
    const projectEntries = entries.filter((entry) => ![".git", ".ui-agent"].includes(entry));
    if (projectEntries.length > 0) throw new UiAgentError("CONFLICT", `Create target is not empty: ${projectRoot}`, { suggestion: "Choose a new directory or use improve." });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
