import { readFile } from "node:fs/promises";
import type { TSchema } from "typebox";
import Value from "typebox/value";

export type Role = "intake" | "director" | "analyst" | "builder" | "showpiece" | "critic";
export type Part = string | { image: string };
export type Usage = { model: string; tokensIn: number; tokensOut: number };
export type CodeFile = { lang: string; name: string; code: string };
type Chunk = { choices?: { delta?: { content?: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };

const temperature: Partial<Record<Role, number>> = { intake: 0, builder: 0.2, showpiece: 0.2 };
// ponytail: fixed 10-minute cap per request; make it an env var if slow self-hosted servers need longer.
const TIMEOUT_MS = 600_000;

const content = (parts: Part[]) =>
  Promise.all(parts.map(async (p) => typeof p === "string" ? { type: "text", text: p }
    : { type: "image_url", image_url: { url: /^(data|https?):/.test(p.image) ? p.image : `data:image/png;base64,${(await readFile(p.image)).toString("base64")}` } }));

function parse(text: string, schema?: TSchema): { value: unknown } | { error: string } {
  // Reasoning models emit <think>…</think> (some only the closing tag); the answer is what follows.
  const reply = text.split("</think>").pop()!.trim();
  if (!schema) {
    // Code replies are fenced files: ```tsx Name.tsx (the name is optional); the caller's check decides which files it needs.
    const files: CodeFile[] = [...reply.matchAll(/```(tsx|svg)[ \t]*([\w.-]*)[^\n]*\n([\s\S]*?)```/g)].map(([, lang, name, code]) => ({ lang: lang!, name: name!, code: code! }));
    return files.length ? { value: files } : { error: "Reply must contain the file(s) as fenced ```tsx blocks." };
  }
  let value: unknown;
  try {
    value = JSON.parse(reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1));
  } catch (e) {
    return { error: `Reply must be one JSON object: ${(e as Error).message}.` };
  }
  const errors = [...Value.Errors(schema, value)].slice(0, 5).map((e) => `${e.instancePath || "/"} ${e.message}`);
  return errors.length ? { error: `The JSON does not match the schema: ${errors.join("; ")}.` } : { value };
}

/** One model call for any OpenAI-compatible server: validated output (schema, then `check`), one retry with the error, usage always reported (also on thrown errors). */
export async function ask<T = string>(
  role: Role,
  { system, user, schema, check }: { system: string; user: Part[]; schema?: TSchema; check?: (value: T) => string | undefined },
): Promise<{ value: T; usage: Usage }> {
  const ROLE = role.toUpperCase();
  const url = process.env[`UI_LLM_URL_${ROLE}`] ?? process.env.UI_LLM_URL ?? "http://localhost:8000/v1";
  const model = process.env[`UI_MODEL_${ROLE}`];
  if (!model) throw new Error(`Set UI_MODEL_${ROLE} to the model id your server at ${url} serves for the ${role} role.`);
  const usage: Usage = { model, tokensIn: 0, tokensOut: 0 };
  const messages: { role: string; content: unknown }[] = [{ role: "system", content: system }, { role: "user", content: await content(user) }];
  let error = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${url}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.UI_LLM_KEY ?? "local"}` },
      body: JSON.stringify({ model, messages, temperature: temperature[role] ?? 0.3, stream: true, stream_options: { include_usage: true }, ...(schema && { response_format: { type: "json_schema", json_schema: { name: role, schema } } }) }),
    });
    if (!res.ok) throw Object.assign(new Error(`${role} call to ${url} failed with HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`), { usage });
    // Streamed: without it the server sends headers only when the answer is complete, and fetch gives up on headers after 5 minutes.
    const chunks = (await res.text()).split("\n").filter((l) => l.startsWith("data: {")).map((l) => JSON.parse(l.slice(6)) as Chunk);
    const text = chunks.map((c) => c.choices?.[0]?.delta?.content ?? "").join("");
    usage.tokensIn += chunks.findLast((c) => c.usage)?.usage?.prompt_tokens ?? 0;
    usage.tokensOut += chunks.findLast((c) => c.usage)?.usage?.completion_tokens ?? 0;
    const result = parse(text, schema);
    const problem = "value" in result ? check?.(result.value as T) : result.error;
    if ("value" in result && problem === undefined) return { value: result.value as T, usage };
    error = problem!;
    messages.push({ role: "assistant", content: text }, { role: "user", content: `${error} Reply again in the required format.` });
  }
  throw Object.assign(new Error(`${role} reply was invalid twice: ${error}`), { usage });
}
