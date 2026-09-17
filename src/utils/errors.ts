export type UiAgentErrorCode =
  | "ABORTED"
  | "TIMEOUT"
  | "PATH_OUTSIDE_PROJECT"
  | "SECRET_FILE_BLOCKED"
  | "INVALID_INPUT"
  | "CAPABILITY_MISSING"
  | "PROCESS_FAILED"
  | "NETWORK_BLOCKED"
  | "APPROVAL_REQUIRED"
  | "NOT_FOUND"
  | "CONFLICT";

export class UiAgentError extends Error {
  readonly code: UiAgentErrorCode;
  readonly suggestion?: string;
  readonly details?: Record<string, unknown>;

  constructor(code: UiAgentErrorCode, message: string, options: { suggestion?: string; details?: Record<string, unknown>; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "UiAgentError";
    this.code = code;
    if (options.suggestion !== undefined) this.suggestion = options.suggestion;
    if (options.details !== undefined) this.details = options.details;
  }
}

export function safeError(error: unknown): { code: string; message: string; suggestion?: string } {
  if (error instanceof UiAgentError) {
    return {
      code: error.code,
      message: redact(error.message),
      ...(error.suggestion ? { suggestion: error.suggestion } : {})
    };
  }
  return { code: "UNEXPECTED", message: redact(error instanceof Error ? error.message : String(error)) };
}

export function redact(value: string): string {
  return value
    .replace(/(authorization|api[-_ ]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]")
    .replace(/data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+/gi, "[IMAGE_PAYLOAD_REDACTED]");
}
