import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { AppConfig } from "../config/schema.js";
import { writeJsonAtomic } from "../utils/fs.js";
import { LocalOpenAiClient } from "./openai-client.js";
import { parseJsonWithRecovery } from "./structured.js";
import type { CapabilityEvidence, ChatMessage } from "./types.js";

const textSchema = z.object({ status: z.literal("ok"), number: z.literal(731) });
const visionSchema = z.object({
  text: z.string(),
  redShape: z.string(),
  redPosition: z.string(),
  blueShape: z.string(),
  bluePosition: z.string(),
  greenShape: z.string()
});
const comparisonSchema = z.object({ firstText: z.string(), secondText: z.string(), firstShape: z.string(), secondShape: z.string(), positionalDifference: z.string() });

export async function probeTextAndJson(config: AppConfig, modelId: string, signal?: AbortSignal): Promise<CapabilityEvidence[]> {
  return [await probeText(config, modelId, signal), await probeStructuredJson(config, modelId, signal)];
}

export async function probeText(config: AppConfig, modelId: string, signal?: AbortSignal): Promise<CapabilityEvidence> {
  const client = new LocalOpenAiClient(config);
  const endpoint = `${config.model.inferenceBaseUrl}/chat/completions`;
  const plain = await client.chat({ model: modelId, messages: [{ role: "user", content: "Reply with exactly LOCAL_MODEL_OK" }], maxTokens: 512, temperature: 0, signal });
  return { capability: "text", passed: plain.content.trim() === "LOCAL_MODEL_OK", latencyMs: plain.latencyMs, modelId, endpoint, evidence: plain.content.slice(0, 120) };
}

export async function probeStructuredJson(config: AppConfig, modelId: string, signal?: AbortSignal): Promise<CapabilityEvidence> {
  const client = new LocalOpenAiClient(config);
  const endpoint = `${config.model.inferenceBaseUrl}/chat/completions`;
  const structured = await client.chat({
    model: modelId,
    messages: [{ role: "user", content: "Return JSON with status exactly 'ok' and number exactly 731." }],
    responseFormat: { type: "json_schema", json_schema: { name: "doctor", strict: true, schema: { type: "object", additionalProperties: false, required: ["status", "number"], properties: { status: { type: "string", enum: ["ok"] }, number: { type: "integer", enum: [731] } } } } },
    maxTokens: 512,
    temperature: 0,
    signal
  });
  const parsed = parseJsonWithRecovery(structured.content, (candidate) => textSchema.parse(candidate));
  const malformed = parseJsonWithRecovery("```json\n{\"status\":\"ok\",\"number\":731,}\n```", (candidate) => textSchema.parse(candidate));
  return { capability: "structured_json", passed: parsed.value.status === "ok" && malformed.recovered, latencyMs: structured.latencyMs, modelId, endpoint, evidence: `schema=valid, malformed_recovery=${malformed.recovered}` };
}

export async function probeToolCalling(config: AppConfig, modelId: string, signal?: AbortSignal): Promise<CapabilityEvidence> {
  const client = new LocalOpenAiClient(config);
  const endpoint = `${config.model.inferenceBaseUrl}/chat/completions`;
  const first = await client.chat({
    model: modelId,
    messages: [{ role: "user", content: "Use the multiply tool to calculate 17 times 19. Do not calculate it yourself." }],
    tools: [{ type: "function", function: { name: "multiply", description: "Multiply two integers", parameters: { type: "object", additionalProperties: false, required: ["a", "b"], properties: { a: { type: "integer" }, b: { type: "integer" } } } } }],
    toolChoice: { type: "function", function: { name: "multiply" } },
    maxTokens: 512,
    temperature: 0,
    signal
  });
  const call = first.toolCalls[0];
  let passed = false;
  let summary = "No tool call returned.";
  let latencyMs = first.latencyMs;
  if (call?.name === "multiply") {
    const args = JSON.parse(call.arguments) as { a?: number; b?: number };
    const product = Number(args.a) * Number(args.b);
    const continuation: ChatMessage[] = [
      { role: "user", content: "Use the multiply tool to calculate 17 times 19. Do not calculate it yourself." },
      { role: "assistant", content: null, tool_calls: [{ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }] },
      { role: "tool", name: "multiply", tool_call_id: call.id, content: JSON.stringify({ product }) }
    ];
    const second = await client.chat({ model: modelId, messages: continuation, maxTokens: 512, temperature: 0, signal });
    latencyMs += second.latencyMs;
    passed = product === 323 && /323/.test(second.content);
    summary = `call=${call.name}(${args.a},${args.b}), continuation=${second.content.slice(0, 100)}`;
  }
  return { capability: "tools", passed, latencyMs, modelId, endpoint, evidence: summary };
}

export async function probeVision(config: AppConfig, modelId: string, artifactDir: string, signal?: AbortSignal): Promise<CapabilityEvidence[]> {
  return [await probeSingleVision(config, modelId, artifactDir, signal), await probeVisionComparison(config, modelId, artifactDir, signal)];
}

export async function probeSingleVision(config: AppConfig, modelId: string, artifactDir: string, signal?: AbortSignal): Promise<CapabilityEvidence> {
  await mkdir(artifactDir, { recursive: true });
  const singlePath = path.join(artifactDir, "vision-single.png");
  await sharp(Buffer.from(singleSvg())).png().toFile(singlePath);
  const client = new LocalOpenAiClient(config);
  const endpoint = `${config.model.inferenceBaseUrl}/chat/completions`;
  const single = await client.chat({
    model: modelId,
    messages: [{ role: "user", content: [imagePart(await readFile(singlePath)), { type: "text", text: "Inspect the actual image. Return JSON with text, redShape, redPosition, blueShape, bluePosition, and greenShape. For each position, report both the vertical and horizontal direction using a value such as top-left or bottom-right." }] }],
    responseFormat: { type: "json_object" },
    maxTokens: 512,
    temperature: 0,
    signal
  });
  let singlePassed = false;
  let singleSummary = single.content.slice(0, 300);
  try {
    const parsed = parseJsonWithRecovery(single.content, (value) => visionSchema.parse(value)).value;
    singlePassed = /VISION CHECK 731/i.test(parsed.text) && /circle/i.test(parsed.redShape) && /(upper|top)/i.test(parsed.redPosition) && /square/i.test(parsed.blueShape) && /right/i.test(parsed.bluePosition) && /triangle/i.test(parsed.greenShape);
    singleSummary = JSON.stringify(parsed);
  } catch {}
  await writeJsonAtomic(path.join(artifactDir, "vision-single-evidence.json"), single.raw);
  return { capability: "vision_single", passed: singlePassed, latencyMs: single.latencyMs, modelId, endpoint, evidence: singleSummary };
}

export async function probeVisionComparison(config: AppConfig, modelId: string, artifactDir: string, signal?: AbortSignal): Promise<CapabilityEvidence> {
  await mkdir(artifactDir, { recursive: true });
  const firstPath = path.join(artifactDir, "vision-first.png");
  const secondPath = path.join(artifactDir, "vision-second.png");
  await sharp(Buffer.from(compareSvg("ALPHA", "red", "circle", "left"))).png().toFile(firstPath);
  await sharp(Buffer.from(compareSvg("BETA", "blue", "square", "right"))).png().toFile(secondPath);
  const client = new LocalOpenAiClient(config);
  const endpoint = `${config.model.inferenceBaseUrl}/chat/completions`;
  const comparison = await client.chat({
    model: modelId,
    messages: [{ role: "user", content: [imagePart(await readFile(firstPath)), imagePart(await readFile(secondPath)), { type: "text", text: "Compare image 1 and image 2. Return JSON: firstText, secondText, firstShape, secondShape, positionalDifference. In positionalDifference, explicitly state which shape is on the left and which shape is on the right." }] }],
    responseFormat: { type: "json_object" },
    maxTokens: 512,
    temperature: 0,
    signal
  });
  let comparePassed = false;
  let compareSummary = comparison.content.slice(0, 300);
  try {
    const parsed = parseJsonWithRecovery(comparison.content, (value) => comparisonSchema.parse(value)).value;
    comparePassed = /ALPHA/i.test(parsed.firstText) && /BETA/i.test(parsed.secondText) && /circle/i.test(parsed.firstShape) && /square/i.test(parsed.secondShape) && /left/i.test(parsed.positionalDifference) && /right/i.test(parsed.positionalDifference);
    compareSummary = JSON.stringify(parsed);
  } catch {}
  await writeJsonAtomic(path.join(artifactDir, "vision-compare-evidence.json"), comparison.raw);
  return { capability: "vision_compare", passed: comparePassed, latencyMs: comparison.latencyMs, modelId, endpoint, evidence: compareSummary };
}

function imagePart(buffer: Buffer): Record<string, unknown> {
  return { type: "image_url", image_url: { url: `data:image/png;base64,${buffer.toString("base64")}` } };
}

function singleSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="white"/><circle cx="105" cy="105" r="58" fill="#ef233c"/><rect x="465" y="325" width="105" height="105" fill="#2563eb"/><path d="M320 115 L260 225 L380 225 Z" fill="#16a34a"/><text x="320" y="285" text-anchor="middle" font-family="Arial" font-size="35" font-weight="700" fill="#111827">VISION CHECK 731</text></svg>`;
}

function compareSvg(text: string, color: string, shape: "circle" | "square", position: "left" | "right"): string {
  const graphic = shape === "circle" ? `<circle cx="155" cy="210" r="80" fill="${color}"/>` : `<rect x="405" y="130" width="160" height="160" fill="${color}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420"><rect width="720" height="420" fill="white"/>${graphic}<text x="360" y="365" text-anchor="middle" font-family="Arial" font-size="48" font-weight="700" fill="#111">${text}</text><text x="360" y="60" text-anchor="middle" font-family="Arial" font-size="24" fill="#555">${position.toUpperCase()}</text></svg>`;
}
