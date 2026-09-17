import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { safeError } from "../utils/errors.js";

export interface ToolDetails<T = unknown> {
  ok: boolean;
  data?: T;
  error?: ReturnType<typeof safeError>;
  durationMs: number;
}

export function toolSuccess<T>(data: T, startedAt: number, summary?: string): AgentToolResult<ToolDetails<T>> {
  return {
    content: [{ type: "text", text: summary ?? JSON.stringify(data, null, 2) }],
    details: { ok: true, data, durationMs: Math.round(performance.now() - startedAt) }
  };
}

export function toolFailure(error: unknown, startedAt: number): AgentToolResult<ToolDetails> {
  const safe = safeError(error);
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: safe }, null, 2) }],
    details: { ok: false, error: safe, durationMs: Math.round(performance.now() - startedAt) }
  };
}
