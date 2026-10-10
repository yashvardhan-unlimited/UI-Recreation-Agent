import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export type MockRequest = { role: string; key: string; n: number; body: string };
/** A canned reply: message text, or a tool call (used to script pi's main agent). */
export type Reply = string | { tool: string; args: object };

/**
 * In-process OpenAI-compatible server: replies[role][key][n] is the n-th reply for that role and section id ("_" when the prompt names none); the last reply repeats.
 * It streams (SSE) when asked, lists `mock-<role>` models at GET /v1/models, and stands in for Google Fonts at GET /css2:
 * `fonts` says whether a family loads with a weight range, only as the plain family, or (absent) not at all.
 */
export async function mockLlm(replies: Record<string, Record<string, Reply[]>>, fonts: Record<string, "weights" | "plain"> = {}) {
  const requests: MockRequest[] = [];
  const counts = new Map<string, number>();
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url?.endsWith("/models")) {
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: Object.keys(replies).map((r) => ({ id: `mock-${r}`, object: "model" })) }));
    }
    if (req.method === "GET") {
      const [family, weights] = (new URL(req.url ?? "", "http://x").searchParams.get("family") ?? "").split(":");
      const ok = fonts[family!] === "weights" || (fonts[family!] === "plain" && !weights);
      return void res.writeHead(ok ? 200 : 400, { "content-type": "text/css" }).end(ok ? `/* ${family} */` : "");
    }
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      const { model, messages, stream } = JSON.parse(body) as { model: string; messages: { content: unknown }[]; stream?: boolean };
      const role = model.replace(/^mock-/, "");
      const key = /\\"id\\": \\"(\w+)\\"/.exec(JSON.stringify(messages[1]?.content))?.[1] ?? "_";
      const n = counts.get(role + key) ?? 0;
      counts.set(role + key, n + 1);
      requests.push({ role, key, n, body });
      const list = replies[role]?.[key];
      if (!list?.length) return void res.writeHead(500).end(`mock has no reply for ${role}/${key}`);
      const reply = list[Math.min(n, list.length - 1)]!;
      const text = typeof reply === "string" ? reply : JSON.stringify(reply);
      const usage = { prompt_tokens: Math.ceil(body.length / 4), completion_tokens: Math.ceil(text.length / 4), total_tokens: Math.ceil((body.length + text.length) / 4) };
      const call = typeof reply === "string" ? undefined : { id: `call_${n}`, type: "function", function: { name: reply.tool, arguments: JSON.stringify(reply.args) } };
      const finish = call ? "tool_calls" : "stop";
      if (!stream) {
        const message = call ? { role: "assistant", content: null, tool_calls: [call] } : { role: "assistant", content: reply };
        return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ index: 0, message, finish_reason: finish }], usage }));
      }
      const chunk = (delta: object, finish_reason: string | null, extra = {}) => `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason }], ...extra })}\n\n`;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(chunk(call ? { role: "assistant", tool_calls: [{ index: 0, ...call }] } : { role: "assistant", content: reply }, null));
      res.end(chunk({}, finish, { usage }) + "data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/v1`, origin: `http://127.0.0.1:${port}`, requests, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
