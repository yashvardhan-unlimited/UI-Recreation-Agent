import type { AppConfig } from "../config/schema.js";
import { deadlineSignal, throwIfAborted } from "../utils/abort.js";
import { UiAgentError } from "../utils/errors.js";
import { ollamaTagsSchema, openAiModelsSchema, type OllamaModel, type SelectedModels } from "./types.js";

export async function discoverModels(config: AppConfig, signal?: AbortSignal): Promise<OllamaModel[]> {
  assertLoopbackUrl(config.model.discoveryUrl, "discovery URL");
  throwIfAborted(signal);
  const response = await fetch(config.model.discoveryUrl, { signal: deadlineSignal(config.model.requestTimeoutMs, signal), headers: authHeaders(config) });
  if (!response.ok) throw new UiAgentError("CAPABILITY_MISSING", `Model discovery returned HTTP ${response.status}.`, { suggestion: `Check ${config.model.discoveryUrl}.` });
  return ollamaTagsSchema.parse(await response.json()).models;
}

export async function verifyOpenAiModelsEndpoint(config: AppConfig, signal?: AbortSignal): Promise<string[]> {
  assertLoopbackUrl(config.model.inferenceBaseUrl, "inference base URL");
  const url = new URL("models", ensureTrailingSlash(config.model.inferenceBaseUrl)).toString();
  const response = await fetch(url, { signal: deadlineSignal(config.model.requestTimeoutMs, signal), headers: authHeaders(config) });
  if (!response.ok) throw new UiAgentError("CAPABILITY_MISSING", `OpenAI-compatible model endpoint returned HTTP ${response.status}.`, { suggestion: `Verify ${url}, or select the ollama-native protocol.` });
  return openAiModelsSchema.parse(await response.json()).data.map((entry) => entry.id);
}

export function selectModels(models: OllamaModel[], config: AppConfig): SelectedModels {
  if (models.length === 0) throw new UiAgentError("CAPABILITY_MISSING", "No local models were returned by discovery.");
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
