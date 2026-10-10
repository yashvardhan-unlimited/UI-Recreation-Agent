import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import sharp from "sharp";
import { z } from "zod";
import type { AppConfig } from "../config/schema.js";
import { LocalOpenAiClient } from "../model/openai-client.js";
import { parseJsonWithRecovery } from "../model/structured.js";
import { ProjectPathPolicy } from "./path-policy.js";

const referenceAnalysisSchema = z.object({
  observed: z.object({
    regions: z.array(z.object({ name: z.string(), hierarchy: z.string(), approximateBounds: z.string() })),
    typography: z.array(z.string()),
    colorsAndSurfaces: z.array(z.string()),
    spacingAndGrid: z.array(z.string()),
    imageryAndIcons: z.array(z.string()),
    controlsAndStates: z.array(z.string())
  }),
  inferred: z.object({ responsiveBehavior: z.array(z.string()), interactions: z.array(z.string()), motion: z.array(z.string()) }),
  ambiguous: z.array(z.string()),
  prohibitedCopyRisks: z.array(z.string())
});

const comparisonSchema = z.object({
  summary: z.string(),
  issues: z.array(z.object({
    severity: z.enum(["blocker", "high", "medium", "low"]),
    category: z.enum(["geometry", "spacing", "typography", "color", "surface", "asset", "responsive", "hierarchy", "motion", "interaction"]),
    observedProblem: z.string(),
    likelySource: z.string().optional(),
    proposedRepair: z.string(),
    verificationMethod: z.string()
  })),
  strengths: z.array(z.string()),
  uncertainty: z.array(z.string())
});

export async function analyzeReference(input: { imagePath: string; modelId: string; config: AppConfig; intent: "inspired" | "close-match"; signal?: AbortSignal | undefined }): Promise<z.infer<typeof referenceAnalysisSchema>> {
  const image = await normalizeImage(input.imagePath, input.config);
  const client = new LocalOpenAiClient(input.config);
  const response = await client.chat({
    model: input.modelId,
    messages: [{ role: "user", content: [imagePart(image), { type: "text", text: `Analyze this authorized design reference for a frontend ${input.intent} workflow. Separate visible facts from guesses. Return JSON with observed {regions[{name,hierarchy,approximateBounds}], typography[], colorsAndSurfaces[], spacingAndGrid[], imageryAndIcons[], controlsAndStates[]}, inferred {responsiveBehavior[], interactions[], motion[]}, ambiguous[], prohibitedCopyRisks[]. Do not claim exact hidden behavior, source code, fonts, or timing.` }] }],
    responseFormat: { type: "json_object" },
    maxTokens: Math.min(input.config.model.maxOutputTokens, 4_096),
    temperature: 0,
    signal: input.signal
  });
  return parseJsonWithRecovery(response.content, (value) => referenceAnalysisSchema.parse(value)).value;
}

export async function compareScreenshots(input: { targetPath: string; renderedPath: string; outputPath: string; modelId: string; config: AppConfig; page: string; viewport: string; signal?: AbortSignal | undefined }): Promise<{ metrics: Record<string, number>; diffPath: string; review: z.infer<typeof comparisonSchema> }> {
  const targetBuffer = await normalizeImage(input.targetPath, input.config);
  const renderBuffer = await normalizeImage(input.renderedPath, input.config);
  const targetMeta = await sharp(targetBuffer).metadata();
  const width = targetMeta.width!;
  const height = targetMeta.height!;
  const renderedSized = await sharp(renderBuffer).resize(width, height, { fit: "fill" }).png().toBuffer();
  const targetPng = PNG.sync.read(await sharp(targetBuffer).png().toBuffer());
  const renderedPng = PNG.sync.read(renderedSized);
  const diff = new PNG({ width, height });
  const differingPixels = pixelmatch(targetPng.data, renderedPng.data, diff.data, width, height, { threshold: 0.1, includeAA: false });
  await mkdir(path.dirname(input.outputPath), { recursive: true });
  const diffPath = await new ProjectPathPolicy(path.dirname(input.outputPath)).resolve(path.basename(input.outputPath), { allowBinary: true });
  await sharp(PNG.sync.write(diff)).png().toFile(diffPath);
  const metrics = { width, height, differingPixels, differingPixelRatio: differingPixels / (width * height) };
  const client = new LocalOpenAiClient(input.config);
  const response = await client.chat({
    model: input.modelId,
    messages: [{ role: "user", content: [imagePart(targetBuffer), imagePart(renderedSized), { type: "text", text: `Image 1 is the approved target and image 2 is the rendered ${input.page} at ${input.viewport}. Compare visible geometry, section order, alignment, spacing, typography/wrapping, colors/surfaces, assets/crops, hierarchy, responsive adaptation, and motion coherence only where visible. Pixel ratio is ${metrics.differingPixelRatio.toFixed(4)} and is evidence, not an accuracy score. Return JSON {summary, issues:[{severity,category,observedProblem,likelySource?,proposedRepair,verificationMethod}], strengths[], uncertainty[]}. Never say ready if visible high-severity issues remain.` }] }],
    responseFormat: { type: "json_object" },
    maxTokens: Math.min(input.config.model.maxOutputTokens, 4_096),
    temperature: 0,
    signal: input.signal
  });
  const review = parseJsonWithRecovery(response.content, (value) => comparisonSchema.parse(value)).value;
  return { metrics, diffPath, review };
}

export async function reviewScreenshot(input: { imagePath: string; modelId: string; config: AppConfig; page: string; viewport: string; requirements: string; signal?: AbortSignal | undefined }): Promise<z.infer<typeof comparisonSchema>> {
  const image = await normalizeImage(input.imagePath, input.config);
  const client = new LocalOpenAiClient(input.config);
  const response = await client.chat({
    model: input.modelId,
    messages: [{ role: "user", content: [imagePart(image), { type: "text", text: `Review this actual rendered screenshot of ${input.page} at ${input.viewport}. Assess only visible evidence: geometry, spacing, typography/wrapping, color/surfaces, assets/crops, hierarchy, responsive adaptation, visible motion state, and affordances. Requested context follows and may contain non-visual requirements; do not claim it is visible unless it appears in the screenshot:\n${input.requirements}\nReturn JSON {summary, issues:[{severity,category,observedProblem,likelySource?,proposedRepair,verificationMethod}], strengths[], uncertainty[]}. Do not mark the UI ready if a visible blocker or high-severity issue remains.` }] }],
    responseFormat: { type: "json_object" },
    maxTokens: Math.min(input.config.model.maxOutputTokens, 4_096),
    temperature: 0,
    signal: input.signal
  });
  return parseJsonWithRecovery(response.content, (value) => comparisonSchema.parse(value)).value;
}

async function normalizeImage(filePath: string, config: AppConfig): Promise<Buffer> {
  const source = await readFile(filePath);
  if (source.length > config.model.maxImageBytes) throw new Error(`Image exceeds ${config.model.maxImageBytes} bytes.`);
  const metadata = await sharp(source, { limitInputPixels: 60_000_000 }).metadata();
  const maxWidth = config.browser.screenshot.maxWidth;
  const maxHeight = config.browser.screenshot.maxHeight;
  if ((metadata.width ?? 0) > maxWidth || (metadata.height ?? 0) > maxHeight) return sharp(source).resize({ width: maxWidth, height: maxHeight, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  return sharp(source).png().toBuffer();
}

function imagePart(buffer: Buffer): Record<string, unknown> {
  return { type: "image_url", image_url: { url: `data:image/png;base64,${buffer.toString("base64")}` } };
}
