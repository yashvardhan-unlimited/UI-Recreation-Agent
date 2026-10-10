import type { AppConfig } from "../config/schema.js";
import { deadlineSignal, throwIfAborted } from "../utils/abort.js";
import { safeError, UiAgentError } from "../utils/errors.js";
import { ollamaTagsSchema, openAiModelsSchema, type OllamaModel, type SelectedModels } from "./types.js";

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export interface ResolvedModelBackend {
  provider: "local-ollama" | "groq";
  config: AppConfig;
  models: OllamaModel[];
  selected: SelectedModels;
  discoveryUrl: string;
  modelsUrl: string;
  fallbackReason?: string;
}

export async function discoverModels(config: AppConfig, signal?: AbortSignal): Promise<OllamaModel[]> {
  assertLoopbackUrl(config.model.discoveryUrl, "discovery URL");
  throwIfAborted(signal);
  const response = await fetch(config.model.discoveryUrl, { signal: deadlineSignal(config.model.requestTimeoutMs, signal), headers: authHeaders(config) });
  if (!response.ok) throw new UiAgentError("CAPABILITY_MISSING", `Model discovery returned HTTP ${response.status}.`, { suggestion: `Check ${config.model.discoveryUrl}.` });
  return ollamaTagsSchema.parse(await response.json()).models;
}

export async function verifyOpenAiModelsEndpoint(config: AppConfig, signal?: AbortSignal): Promise<string[]> {
  assertAllowedInferenceUrl(config);
  const url = new URL("models", ensureTrailingSlash(config.model.inferenceBaseUrl)).toString();
  const response = await fetch(url, { signal: deadlineSignal(config.model.requestTimeoutMs, signal), headers: authHeaders(config) });
  if (!response.ok) throw new UiAgentError("CAPABILITY_MISSING", `OpenAI-compatible model endpoint returned HTTP ${response.status}.`, { suggestion: `Verify ${url}, or select the ollama-native protocol.` });
  return openAiModelsSchema.parse(await response.json()).data.map((entry) => entry.id);
}

export async function resolveModelBackend(config: AppConfig, signal?: AbortSignal): Promise<ResolvedModelBackend> {
  if (config.model.protocol !== "openai-completions") {
    throw new UiAgentError("CAPABILITY_MISSING", "Only the OpenAI-compatible completions protocol is supported by this Pi integration.", { suggestion: "Set model.protocol to openai-completions." });
  }

  let localError: unknown;
  if (config.model.provider !== "groq") {
    const probeConfig = config.model.provider === "auto"
      ? { ...config, model: { ...config.model, requestTimeoutMs: Math.min(config.model.requestTimeoutMs, config.model.localProbeTimeoutMs) } }
      : config;
    try {
      const backend = await resolveLocalBackend(probeConfig, signal);
      return { ...backend, config };
    } catch (error) {
      localError = error;
      if (config.model.provider === "local") throw error;
    }
  }

  const groqConfig = effectiveGroqConfig(config);
  const keyName = groqConfig.model.auth.environmentVariable!;
  if (!process.env[keyName]) {
    const prefix = localError ? `The local model endpoint is unavailable (${safeError(localError).message}). ` : "";
    throw new UiAgentError("CAPABILITY_MISSING", `${prefix}Groq fallback requires ${keyName}.`, { suggestion: `Add ${keyName}=your_key to .env, or export it in the parent environment.` });
  }
  try {
    const ids = await verifyOpenAiModelsEndpoint(groqConfig, signal);
    const models = groqModels(ids, groqConfig);
    const selected = selectModels(models, groqConfig);
    return {
      provider: "groq",
      config: groqConfig,
      models,
      selected,
      discoveryUrl: modelsEndpoint(groqConfig),
      modelsUrl: modelsEndpoint(groqConfig),
      ...(localError ? { fallbackReason: safeError(localError).message } : {})
    };
  } catch (error) {
    if (!localError) throw error;
    throw new UiAgentError("CAPABILITY_MISSING", `Neither model backend is available. Local: ${safeError(localError).message} Groq: ${safeError(error).message}`, { suggestion: `Check the local endpoint or verify ${keyName} and Groq network access.` });
  }
}

async function resolveLocalBackend(config: AppConfig, signal?: AbortSignal): Promise<ResolvedModelBackend> {
  const models = await discoverModels(config, signal);
  const selected = selectModels(models, config);
  const ids = await verifyOpenAiModelsEndpoint(config, signal);
  if (!ids.includes(selected.coding.name)) throw new UiAgentError("CAPABILITY_MISSING", `Selected model ${selected.coding.name} was not returned by the local /v1/models endpoint.`);
  return {
    provider: "local-ollama",
    config,
    models,
    selected,
    discoveryUrl: config.model.discoveryUrl,
    modelsUrl: modelsEndpoint(config)
  };
}

function effectiveGroqConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    model: {
      ...config.model,
      provider: "groq",
      discoveryUrl: `${GROQ_BASE_URL}/models`,
      inferenceBaseUrl: GROQ_BASE_URL,
      codingModelId: config.model.groq.codingModelId,
      visualModelId: config.model.groq.visualModelId,
      contextWindow: config.model.groq.contextWindow,
      auth: { headerName: "Authorization", environmentVariable: config.model.groq.apiKeyEnvironmentVariable }
    }
  };
}

function groqModels(ids: string[], config: AppConfig): OllamaModel[] {
  const configured = [config.model.codingModelId, config.model.visualModelId].filter((value): value is string => Boolean(value));
  const missing = [...new Set(configured)].filter((id) => !ids.includes(id));
  if (missing.length > 0) {
    throw new UiAgentError("INVALID_INPUT", `Configured Groq model(s) are unavailable: ${missing.join(", ")}.`, { suggestion: "Choose exact IDs returned by the Groq /models endpoint." });
  }
  return [...new Set(ids)].map((id) => ({
    name: id,
    model: id,
    modified_at: "",
    size: 0,
    digest: `groq-hosted:${id}`,
    details: { parent_model: "", format: "remote", family: id.split("/")[0], context_length: config.model.contextWindow },
    capabilities: ["completion", "tools", "thinking", ...(id === config.model.visualModelId ? ["vision"] : [])]
  }));
}

export function selectModels(models: OllamaModel[], config: AppConfig): SelectedModels {
  if (models.length === 0) throw new UiAgentError("CAPABILITY_MISSING", "No models were returned by discovery.");
  const byName = new Map(models.map((model) => [model.name, model]));
  const configuredCoding = config.model.codingModelId;
  if (configuredCoding && !byName.has(configuredCoding)) {
    throw new UiAgentError("INVALID_INPUT", `Configured model '${configuredCoding}' is not installed.`, { suggestion: `Choose one of: ${models.map((model) => model.name).join(", ")}` });
  }
  const preferred = byName.get("qwen3.8:27b");
  const coding = configuredCoding ? byName.get(configuredCoding)! : preferred ?? models.find((model) => model.capabilities.includes("tools")) ?? models[0]!;
  const configuredVisual = config.model.visualModelId;
  if (configuredVisual && !byName.has(configuredVisual)) {
    throw new UiAgentError("INVALID_INPUT", `Configured visual model '${configuredVisual}' is not installed.`);
  }
  const visual = configuredVisual ? byName.get(configuredVisual) : coding.capabilities.includes("vision") ? coding : models.find((model) => model.capabilities.includes("vision"));
  return { coding, ...(visual ? { visual } : {}) };
}

export function assertLoopbackUrl(value: string, label: string): void {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UiAgentError("INVALID_INPUT", `${label} must use HTTP(S).`);
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
    throw new UiAgentError("NETWORK_BLOCKED", `${label} must remain loopback-only; received ${url.hostname}.`);
  }
}

export function assertAllowedInferenceUrl(config: AppConfig): void {
  if (config.model.provider !== "groq") {
    assertLoopbackUrl(config.model.inferenceBaseUrl, "inference base URL");
    return;
  }
  const actual = new URL(config.model.inferenceBaseUrl);
  const expected = new URL(GROQ_BASE_URL);
  if (actual.username || actual.password || actual.search || actual.hash || actual.origin !== expected.origin || actual.pathname.replace(/\/$/, "") !== expected.pathname) {
    throw new UiAgentError("NETWORK_BLOCKED", `Groq inference must use the pinned official endpoint ${GROQ_BASE_URL}.`);
  }
}

export function authHeaders(config: AppConfig): Record<string, string> {
  const variable = config.model.auth.environmentVariable;
  if (!variable) return {};
  const value = process.env[variable];
  if (!value) return {};
  const name = config.model.auth.headerName ?? "Authorization";
  return { [name]: name.toLowerCase() === "authorization" ? `Bearer ${value}` : value };
}

export function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

export function modelsEndpoint(config: AppConfig): string {
  return new URL("models", ensureTrailingSlash(config.model.inferenceBaseUrl)).toString();
}
