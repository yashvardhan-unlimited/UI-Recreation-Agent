import { UiAgentError } from "../utils/errors.js";

export function parseJsonWithRecovery<T>(value: string, validate: (candidate: unknown) => T): { value: T; recovered: boolean } {
  const attempts = [value, stripFence(value), extractObject(value), repairCommonJson(stripFence(extractObject(value)))];
  let lastError: unknown;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    if (!attempt) continue;
    try {
      return { value: validate(JSON.parse(attempt)), recovered: index > 0 };
    } catch (error) {
      lastError = error;
    }
  }
  throw new UiAgentError("INVALID_INPUT", "Model output was not valid structured JSON after bounded recovery.", { cause: lastError, details: { preview: value.slice(0, 300) } });
}

function stripFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function extractObject(value: string): string {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");
  const start = objectStart === -1 ? arrayStart : arrayStart === -1 ? objectStart : Math.min(objectStart, arrayStart);
  if (start < 0) return value;
  const objectEnd = value.lastIndexOf("}");
  const arrayEnd = value.lastIndexOf("]");
  const end = Math.max(objectEnd, arrayEnd);
  return end > start ? value.slice(start, end + 1) : value;
}

function repairCommonJson(value: string): string {
  return value.replace(/,\s*([}\]])/g, "$1");
}
