import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  InteractiveMode,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionRuntime
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { AppConfig } from "../config/schema.js";
import type { OllamaModel } from "../model/types.js";
import type { RunManifest } from "../state/schema.js";
import { RunStore } from "../state/store.js";
import { BrowserManager } from "../tools/browser.js";
import { PreviewManager } from "../tools/preview.js";
import type { Logger } from "../utils/log.js";
import { createUiAgentExtension } from "./extension.js";
import { UI_AGENT_SYSTEM_PROMPT } from "./system-prompt.js";
import { authHeaders } from "../model/discovery.js";

export const UI_TOOL_NAMES = [
  "inspect_project", "read_relevant_files", "scaffold_frontend", "apply_ui_patch", "manage_preview", "browser_inspect", "browser_interact",
  "capture_screenshot", "analyze_reference", "compare_screenshots", "run_quality_checks", "checkpoint_project",
  "list_assets", "search_images", "create_asset_contact_sheet", "download_approved_image", "register_supplied_asset", "record_design_spec", "record_defects",
  "advance_workflow", "ask_human", "approve_direction"
];

export interface PiHarness {
  runtime: AgentSessionRuntime;
  session: AgentSession;
  model: Model<any>;
  run: RunManifest;
  dispose(): Promise<void>;
}

export async function createPiHarness(input: {
  config: AppConfig;
  provider: "local-ollama" | "groq";
  model: OllamaModel;
  visualModelId?: string;
  run: RunManifest;
  runStore: RunStore;
  logger: Logger;
  resumeSessionFile?: string | undefined;
}): Promise<PiHarness> {
  if (input.config.model.protocol !== "openai-completions") {
    throw new Error("The installed Pi SDK integration supports only the verified openai-completions protocol. Select it or use a Pi version with a documented native Ollama provider.");
  }
  if (input.resumeSessionFile) {
    const relative = path.relative(path.join(input.run.runRoot, "pi-sessions"), path.resolve(input.resumeSessionFile));
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Refusing to resume a Pi session outside this run's agent-owned session directory.");
  }
  const agentDir = path.join(input.run.runRoot, "pi-agent");
  const sessionDir = path.join(input.run.runRoot, "pi-sessions");
  await mkdir(agentDir, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  const modelRuntime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const providerId = input.provider;
  const runtimeKey = input.config.model.auth.environmentVariable ? process.env[input.config.model.auth.environmentVariable] ?? "" : "local-loopback";
  modelRuntime.registerProvider(providerId, {
    name: input.provider === "groq" ? "Groq API" : "Local Ollama-compatible server",
    baseUrl: input.config.model.inferenceBaseUrl,
    apiKey: runtimeKey,
    authHeader: false,
    headers: authHeaders(input.config),
    api: "openai-completions",
    models: [{
      id: input.model.name,
      name: input.model.name,
      reasoning: input.model.capabilities.includes("thinking"),
      thinkingLevelMap: groqThinkingLevelMap(input.provider, input.model.name),
      input: input.visualModelId === input.model.name ? ["text", "image"] : ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: input.model.details.context_length ?? input.config.model.contextWindow,
      maxTokens: input.config.model.maxOutputTokens,
      samplingParams: { temperature: input.config.model.temperature },
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: true,
        supportsUsageInStreaming: true,
        maxTokensField: "max_tokens",
        thinkingFormat: "openai",
        supportsStrictMode: false
      }
    }]
  });
  await modelRuntime.setRuntimeApiKey(providerId, runtimeKey);
  const model = modelRuntime.getModel(providerId, input.model.name);
  if (!model) throw new Error(`Pi could not register discovered model ${input.model.name}.`);
  const settingsManager = SettingsManager.inMemory({
    defaultProvider: providerId,
    defaultModel: input.model.name,
    defaultThinkingLevel: input.config.model.thinking,
    defaultProjectTrust: "never",
    compaction: { enabled: true, reserveTokens: Math.min(16_384, Math.floor(input.config.model.contextWindow * 0.1)), keepRecentTokens: 20_000 },
    retry: { enabled: true, maxRetries: input.config.model.retry.maxAttempts - 1, baseDelayMs: input.config.model.retry.baseDelayMs, provider: { timeoutMs: input.config.model.requestTimeoutMs, maxRetries: input.config.model.retry.maxAttempts - 1 } },
    images: { autoResize: true, blockImages: false },
    defaultTools: UI_TOOL_NAMES
  });
  const preview = new PreviewManager(input.config.workflow.perToolTimeoutMs);
  const browser = new BrowserManager(input.config, input.run.runRoot);
  const extension = createUiAgentExtension({ config: input.config, runStore: input.runStore, run: input.run, preview, browser, ...(input.visualModelId ? { visualModelId: input.visualModelId } : {}) });
  const factory = async ({ cwd, sessionManager, sessionStartEvent }: Parameters<Parameters<typeof createAgentSessionRuntime>[0]>[0]) => {
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      settingsManager,
      modelRuntime,
      resourceLoaderOptions: {
        extensionFactories: [{ name: "ui-agent", factory: extension }],
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: false,
        systemPrompt: UI_AGENT_SYSTEM_PROMPT
      }
    });
    const created = await createAgentSessionFromServices({ services, sessionManager, ...(sessionStartEvent ? { sessionStartEvent } : {}), model, thinkingLevel: input.config.model.thinking, tools: UI_TOOL_NAMES });
    return { ...created, services, diagnostics: services.diagnostics };
  };
  const sessionManager = input.resumeSessionFile ? SessionManager.open(input.resumeSessionFile, sessionDir, input.run.projectRoot) : SessionManager.create(input.run.projectRoot, sessionDir);
  const runtime = await createAgentSessionRuntime(factory, { cwd: input.run.projectRoot, agentDir, sessionManager });
  bindEventLogging(runtime.session, input.logger);
  return {
    runtime,
    session: runtime.session,
    model,
    run: input.run,
    async dispose() { await runtime.dispose(); await preview.cleanup(); await browser.close(); }
  };
}

function groqThinkingLevelMap(provider: "local-ollama" | "groq", modelId: string): Record<string, string> {
  return provider === "groq" && modelId.startsWith("openai/gpt-oss-")
    ? { off: "low", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" }
    : { off: "none", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" };
}

export async function runInteractiveHarness(harness: PiHarness, initialMessage: string): Promise<void> {
  const mode = new InteractiveMode(harness.runtime, { initialMessage, verbose: true });
  await mode.run();
}

export function bindEventLogging(session: AgentSession, logger: Logger): () => void {
  return session.subscribe((event) => {
    if (event.type === "message_start") logger.event("message", "Assistant response started.");
    if (event.type === "tool_execution_start") logger.event("tool", event.toolName);
    if (event.type === "tool_execution_end") logger.event(event.isError ? "tool-error" : "tool-ok", event.toolName);
    if (event.type === "compaction_start") logger.event("compact", "Pi context compaction started.");
    if (event.type === "auto_retry_start") logger.event("retry", `Automatic retry ${event.attempt}/${event.maxAttempts}.`);
  });
}
