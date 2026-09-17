import { access, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/schema.js";
import { discoverModels, selectModels, verifyOpenAiModelsEndpoint } from "../model/discovery.js";
import { doctorMatchesConfig, hasPassingCheck, loadLatestDoctorReport, verifiedVisualModel } from "../model/doctor-cache.js";
import { RunStore } from "../state/store.js";
import { UiAgentError } from "../utils/errors.js";
import type { Logger } from "../utils/log.js";
import { createPiHarness, runInteractiveHarness } from "../pi/session.js";
import { initialWorkflowPrompt, resumeWorkflowPrompt } from "./prompts.js";

export async function startWorkflow(input: { kind: "create" | "improve" | "recreate" | "audit"; brief: string; projectRoot: string; workspaceRoot: string; config: AppConfig; logger: Logger; references?: string[]; referenceUrl?: string; urlAuthorized?: boolean; interactive?: boolean }): Promise<string> {
  assertSupportedProtocol(input.config);
  const projectRoot = path.resolve(input.projectRoot);
  if (input.kind === "create") await ensureCreateTarget(projectRoot);
  else await access(projectRoot);
  if (input.kind === "recreate" && input.referenceUrl && !input.urlAuthorized) throw new UiAgentError("APPROVAL_REQUIRED", "URL recreation requires explicit --authorized confirmation.");
  await mkdir(projectRoot, { recursive: true });
  const models = await discoverModels(input.config);
  if (input.config.model.protocol === "openai-completions") await verifyOpenAiModelsEndpoint(input.config);
  const selected = selectModels(models, input.config);
  const doctor = await loadLatestDoctorReport(input.workspaceRoot);
  if (!doctorMatchesConfig(doctor, input.config, selected.coding.name) || !hasPassingCheck(doctor, "text", selected.coding.name) || !hasPassingCheck(doctor, "pi_tool_roundtrip", selected.coding.name)) {
    throw new UiAgentError("CAPABILITY_MISSING", `Model ${selected.coding.name} has not passed the current text and Pi tool-roundtrip doctor checks.`, { suggestion: "Run ui-agent doctor while the local inference server is available." });
  }
  const visualModelId = verifiedVisualModel(doctor, selected.visual?.name);
  if (input.kind === "recreate" && !visualModelId) throw new UiAgentError("CAPABILITY_MISSING", "Recreation is refused until a local visual model passes genuine one-image and two-image doctor checks.", { suggestion: "Configure a local VLM and run ui-agent doctor." });
  const runStore = new RunStore(input.workspaceRoot);
  let run = await runStore.create({ kind: input.kind, brief: input.brief, projectRoot, interaction: input.config.interaction, references: input.references, referenceUrl: input.referenceUrl });
  if (input.urlAuthorized && input.referenceUrl) {
    run = { ...run, approvals: [...run.approvals, { id: crypto.randomUUID(), kind: "url_authorization", approved: true, summary: `User confirmed authorization for ${input.referenceUrl}`, at: new Date().toISOString() }] };
    await runStore.save(run);
  }
  const harness = await createPiHarness({ config: input.config, model: selected.coding, ...(visualModelId ? { visualModelId } : {}), run, runStore, logger: input.logger });
  run = { ...run, model: { provider: "local-ollama", codingModelId: selected.coding.name, ...(visualModelId ? { visualModelId } : {}), protocol: input.config.model.protocol, endpoint: input.config.model.inferenceBaseUrl }, ...(harness.session.sessionFile ? { piSessionFile: harness.session.sessionFile } : {}) };
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
  assertSupportedProtocol(input.config);
  const runStore = new RunStore(input.workspaceRoot);
  const run = await runStore.load(input.runId);
  const models = await discoverModels(input.config);
  const selected = selectModels(models, { ...input.config, model: { ...input.config.model, codingModelId: run.model?.codingModelId, visualModelId: run.model?.visualModelId } });
  const doctor = await loadLatestDoctorReport(input.workspaceRoot);
  if (!doctorMatchesConfig(doctor, input.config, selected.coding.name) || !hasPassingCheck(doctor, "pi_tool_roundtrip", selected.coding.name)) throw new UiAgentError("CAPABILITY_MISSING", "Resume requires a current matching Pi tool-roundtrip doctor check.");
  const visualModelId = verifiedVisualModel(doctor, selected.visual?.name);
  const resumedRun = run.status === "pending_input" ? run : { ...run, status: "running" as const };
  const harness = await createPiHarness({ config: input.config, model: selected.coding, ...(visualModelId ? { visualModelId } : {}), run: resumedRun, runStore, logger: input.logger, resumeSessionFile: run.piSessionFile });
  try {
    const prompt = resumeWorkflowPrompt(run);
    if (input.interactive ?? (run.interaction !== "autonomous" && Boolean(process.stdin.isTTY))) await runInteractiveHarness(harness, prompt);
    else await harness.session.prompt(prompt);
  } finally { await harness.dispose(); }
}

function assertSupportedProtocol(config: AppConfig): void {
  if (config.model.protocol !== "openai-completions") {
    throw new UiAgentError("CAPABILITY_MISSING", "This Pi SDK build does not provide a documented native Ollama agent provider.", { suggestion: "Set model.protocol to openai-completions and inferenceBaseUrl to the verified loopback /v1 endpoint." });
  }
}

async function ensureCreateTarget(projectRoot: string): Promise<void> {
  try {
    const entries = await readdir(projectRoot);
    if (entries.length > 0) throw new UiAgentError("CONFLICT", `Create target is not empty: ${projectRoot}`, { suggestion: "Choose a new directory or use improve." });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
