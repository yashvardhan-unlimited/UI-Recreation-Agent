import type { AppConfig } from "../config/schema.js";
import { deadlineSignal } from "../utils/abort.js";
import { safeError, UiAgentError } from "../utils/errors.js";
import { authHeaders, ensureTrailingSlash } from "./discovery.js";
import type { ChatMessage, ChatTool } from "./types.js";

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  responseFormat?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal | undefined;
}

export interface ChatResponse {
  model: string;
  content: string;
  reasoning?: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  finishReason: string;
  usage?: Record<string, number>;
  latencyMs: number;
  raw: unknown;
}

export class LocalOpenAiClient {
  constructor(private readonly config: AppConfig) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const endpoint = new URL("chat/completions", ensureTrailingSlash(this.config.model.inferenceBaseUrl)).toString();
    validateImageAttachments(request.messages, this.config);
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      stream: false,
      max_tokens: request.maxTokens ?? this.config.model.maxOutputTokens,
      temperature: request.temperature ?? this.config.model.temperature,
      reasoning_effort: mapThinking(this.config.model.thinking, request.model, this.config)
    };
    if (request.tools) body.tools = request.tools;
    if (request.toolChoice) body.tool_choice = request.toolChoice;
    if (request.responseFormat) body.response_format = request.responseFormat;
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.config.model.retry.maxAttempts; attempt += 1) {
      const started = performance.now();
      const attemptSignal = deadlineSignal(this.config.model.requestTimeoutMs, request.signal);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders(this.config) },
          body: JSON.stringify(body),
          signal: attemptSignal
        });
        if (!response.ok) {
          const summary = providerErrorSummary((await response.text()).slice(0, 1_000));
          if (response.status < 500 && response.status !== 429) throw new UiAgentError("PROCESS_FAILED", `Model request failed with HTTP ${response.status}${summary}.`);
          throw new RetryableModelError(`HTTP ${response.status}${summary}`, response.status === 429 ? retryAfterMs(response.headers.get("retry-after")) : undefined);
        }
        const raw = await response.json() as any;
        const choice = raw.choices?.[0];
        if (!choice?.message) throw new Error("No assistant choice in model response.");
        return {
          model: String(raw.model ?? request.model),
          content: typeof choice.message.content === "string" ? choice.message.content : "",
          ...(typeof choice.message.reasoning === "string" ? { reasoning: choice.message.reasoning } : {}),
          toolCalls: Array.isArray(choice.message.tool_calls) ? choice.message.tool_calls.map((call: any) => ({
            id: String(call.id),
            name: String(call.function?.name ?? ""),
            arguments: typeof call.function?.arguments === "string" ? call.function.arguments : JSON.stringify(call.function?.arguments ?? {})
          })) : [],
          finishReason: String(choice.finish_reason ?? "unknown"),
          ...(raw.usage ? { usage: raw.usage as Record<string, number> } : {}),
          latencyMs: Math.round(performance.now() - started),
          raw
        };
      } catch (error) {
        lastError = attemptSignal.aborted && !request.signal?.aborted ? attemptSignal.reason : error;
        if (request.signal?.aborted || error instanceof UiAgentError || attempt >= this.config.model.retry.maxAttempts) break;
        const retryDelayMs = error instanceof RetryableModelError && error.retryAfterMs !== undefined ? error.retryAfterMs : this.config.model.retry.baseDelayMs * attempt;
        await new Promise((resolve) => setTimeout(resolve, Math.min(retryDelayMs, 60_000)));
      }
    }
    if (request.signal?.aborted) throw new UiAgentError("ABORTED", "Model request cancelled.", { cause: lastError });
    if (lastError instanceof UiAgentError) throw lastError;
    throw new UiAgentError("PROCESS_FAILED", `Model request failed after retries: ${safeError(lastError).message}`, { cause: lastError, suggestion: `Check ${endpoint} and the configured timeout.` });
  }
}

function validateImageAttachments(messages: ChatMessage[], config: AppConfig): void {
  const imageUrls: string[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "image_url") {
        const value = (part as { image_url?: { url?: unknown } }).image_url?.url;
        if (typeof value === "string") imageUrls.push(value);
      }
    }
  }
  if (imageUrls.length > config.model.maxAttachedImages) throw new UiAgentError("INVALID_INPUT", `Request attaches ${imageUrls.length} images; configured maximum is ${config.model.maxAttachedImages}.`);
  for (const value of imageUrls) {
    const match = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=]+)$/i.exec(value);
    if (!match) throw new UiAgentError("NETWORK_BLOCKED", "Visual model inputs must be local data-image payloads, not remote URLs.");
    const estimatedBytes = Math.floor(match[1]!.length * 0.75);
    if (estimatedBytes > config.model.maxImageBytes) throw new UiAgentError("INVALID_INPUT", `Attached image exceeds ${config.model.maxImageBytes} bytes.`);
  }
}

function mapThinking(level: AppConfig["model"]["thinking"], modelId: string, config: AppConfig): string {
  if (config.model.provider === "groq" && modelId.startsWith("openai/gpt-oss-")) return level === "medium" || level === "high" ? level : "low";
  return level === "off" ? "none" : level;
}

class RetryableModelError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = "RetryableModelError";
  }
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function providerErrorSummary(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; type?: unknown } };
    const value = typeof parsed.error?.code === "string" ? parsed.error.code : typeof parsed.error?.type === "string" ? parsed.error.type : undefined;
    return value && /^[a-z0-9_.-]{1,80}$/i.test(value) ? ` (${value})` : "";
  } catch {
    return "";
  }
}
