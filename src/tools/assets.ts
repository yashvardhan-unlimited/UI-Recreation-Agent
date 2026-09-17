import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import type { AppConfig } from "../config/schema.js";
import { readJson, writeJsonAtomic } from "../utils/fs.js";
import { UiAgentError } from "../utils/errors.js";
import { ProjectPathPolicy } from "./path-policy.js";
import { validateExternalReferenceUrl } from "./url-safety.js";

export interface AssetInfo { path: string; type: string; bytes: number; width?: number; height?: number; format?: string }
export interface ImageCandidate {
  id: string;
  provider: "openverse" | "wikimedia";
  title: string;
  previewUrl: string;
  assetUrl: string;
  sourcePage: string;
  creator: string;
  creatorUrl?: string;
  width?: number;
  height?: number;
  fileType?: string;
  license: string;
  licenseUrl?: string;
  attributionRequired: boolean;
  watermarked: boolean;
  licenseConfidence: "high" | "medium" | "low";
}

export interface AssetProvenance {
  recordId: string;
  id: string;
  originalUrl: string;
  sourcePage: string;
  creator: string;
  provider: string;
  license: string;
  licenseUrl?: string;
  attributionText: string;
  downloadedAt: string;
  checksumSha256: string;
  transformations: string[];
  localPath: string;
  derivatives: Array<{ localPath: string; width: number; format: "webp" | "avif"; checksumSha256: string }>;
  usedBy: string[];
  altText: string;
  decorative: boolean;
  authorization: "provider-license" | "user-supplied";
}

export async function listAssets(projectRoot: string): Promise<AssetInfo[]> {
  const roots = ["public", "src/assets"];
  const output: AssetInfo[] = [];
  for (const root of roots) {
    const absolute = path.join(projectRoot, root);
    let entries;
    try { entries = await readdir(absolute, { recursive: true, withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const parent = entry.parentPath ?? absolute;
      const filePath = path.join(parent, entry.name);
      const relative = path.relative(projectRoot, filePath).replaceAll("\\", "/");
      try {
        const buffer = await readFile(filePath);
        const extension = path.extname(filePath).toLowerCase();
        if ([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".svg"].includes(extension)) {
          const metadata = await sharp(buffer, { limitInputPixels: 50_000_000 }).metadata();
          output.push({ path: relative, type: "image", bytes: buffer.length, ...(metadata.width ? { width: metadata.width } : {}), ...(metadata.height ? { height: metadata.height } : {}), ...(metadata.format ? { format: metadata.format } : {}) });
        } else if ([".woff", ".woff2", ".ttf", ".otf"].includes(extension)) output.push({ path: relative, type: "font", bytes: buffer.length });
      } catch {}
    }
  }
  return output.slice(0, 1_000);
}

export async function createAssetContactSheet(input: { candidates: ImageCandidate[]; outputPath: string; config: AppConfig; signal?: AbortSignal | undefined }): Promise<string> {
  const candidates = input.candidates.slice(0, input.config.imageSearch.resultLimit);
  const tileWidth = 320; const tileHeight = 240; const columns = Math.min(4, Math.max(1, candidates.length));
  const composites: OverlayOptions[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    const response = await fetchPermitted(candidate.previewUrl, input.config, input.signal ?? AbortSignal.timeout(20_000));
    if (!response.ok) continue;
    const source = await readBounded(response, Math.min(5 * 1024 * 1024, input.config.imageSearch.maxBytes));
    const tile = await sharp(source, { limitInputPixels: 30_000_000 }).resize(tileWidth, 190, { fit: "cover" }).extend({ bottom: 50, background: "#ffffff" }).composite([{ input: Buffer.from(`<svg width="${tileWidth}" height="50"><rect width="100%" height="100%" fill="white"/><text x="12" y="22" font-family="Arial" font-size="16" font-weight="700" fill="#111">${index + 1}. ${escapeXml(candidate.title.slice(0, 28))}</text><text x="12" y="42" font-family="Arial" font-size="13" fill="#555">${escapeXml(`${candidate.license.toUpperCase()} · ${candidate.creator}`.slice(0, 42))}</text></svg>`), top: 190, left: 0 }]).png().toBuffer();
    composites.push({ input: tile, left: (index % columns) * tileWidth, top: Math.floor(index / columns) * tileHeight });
  }
  const rows = Math.max(1, Math.ceil(candidates.length / columns));
  await mkdir(path.dirname(input.outputPath), { recursive: true });
  await sharp({ create: { width: columns * tileWidth, height: rows * tileHeight, channels: 4, background: "#e5e7eb" } }).composite(composites).png().toFile(input.outputPath);
  return input.outputPath;
}

export async function downloadApprovedImage(input: { candidate: ImageCandidate; approvedCandidateId: string; projectRoot: string; destination: string; usedBy: string[]; altText: string; decorative: boolean; config: AppConfig; signal?: AbortSignal | undefined }): Promise<AssetProvenance> {
  if (input.candidate.id !== input.approvedCandidateId) throw new UiAgentError("APPROVAL_REQUIRED", "Downloaded candidate does not match the recorded approval.");
  if (!input.config.imageSearch.acceptedLicenses.includes(input.candidate.license.toLowerCase()) || input.candidate.licenseConfidence !== "high" || input.candidate.watermarked) throw new UiAgentError("INVALID_INPUT", "Candidate license or watermark status is not acceptable.");
  if (input.decorative && input.altText !== "") throw new UiAgentError("INVALID_INPUT", "Decorative images must use empty alt text.");
  if (!input.decorative && input.altText.trim().length < 3) throw new UiAgentError("INVALID_INPUT", "Functional/content images require useful alt text.");
  if (path.extname(input.destination).toLowerCase() !== ".webp") throw new UiAgentError("INVALID_INPUT", "Optimized image destinations must use a .webp extension.");
  const manifestPath = path.join(input.projectRoot, "assets.provenance.json");
  let manifest: { schemaVersion: 1; assets: AssetProvenance[] } = { schemaVersion: 1, assets: [] };
  try { manifest = await readJson(manifestPath); } catch {}
  if (manifest.assets.length >= input.config.imageSearch.downloadLimit) throw new UiAgentError("INVALID_INPUT", "Configured per-project image download limit reached.");
  const response = await fetchPermitted(input.candidate.assetUrl, input.config, input.signal ?? AbortSignal.timeout(30_000));
  if (!response.ok) throw new UiAgentError("PROCESS_FAILED", `Asset download returned HTTP ${response.status}.`);
  const type = response.headers.get("content-type")?.split(";")[0]?.toLowerCase() ?? "";
  if (!type.startsWith("image/") || type === "image/svg+xml") throw new UiAgentError("INVALID_INPUT", `Unsupported asset MIME type: ${type}`);
  const source = await readBounded(response, input.config.imageSearch.maxBytes);
  const metadata = await sharp(source, { limitInputPixels: input.config.imageSearch.maxDecodedPixels }).metadata();
  const permittedFormats = new Set(["jpeg", "png", "webp", "avif", "gif"]);
  if (!metadata.format || !permittedFormats.has(metadata.format)) throw new UiAgentError("INVALID_INPUT", "Decoded magic bytes are not an approved raster format.");
  const expectedMimes: Record<string, string[]> = { jpeg: ["image/jpeg", "image/jpg"], png: ["image/png"], webp: ["image/webp"], avif: ["image/avif"], gif: ["image/gif"] };
  if (!expectedMimes[metadata.format]?.includes(type)) throw new UiAgentError("INVALID_INPUT", `MIME type ${type} does not match decoded ${metadata.format} bytes.`);
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > input.config.imageSearch.maxDecodedPixels) throw new UiAgentError("INVALID_INPUT", "Asset dimensions are unsafe or unreadable.");
  if (metadata.width > input.config.imageSearch.maxWidth || metadata.height > input.config.imageSearch.maxHeight) throw new UiAgentError("INVALID_INPUT", "Asset exceeds configured image dimensions.");
  if (metadata.width < 640 || metadata.height < 360) throw new UiAgentError("INVALID_INPUT", "Asset resolution is too low for production use.");
  const policy = new ProjectPathPolicy(input.projectRoot);
  const destination = await policy.resolve(input.destination, { allowBinary: true });
  await mkdir(path.dirname(destination), { recursive: true });
  const transformed = await sharp(source).rotate().resize({ width: 2_400, height: 2_400, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  await writeFile(destination, transformed);
  const derivatives: AssetProvenance["derivatives"] = [];
  const baseName = path.basename(destination, ".webp");
  for (const width of [640, 1280, 1920].filter((candidateWidth) => candidateWidth < metadata.width!)) {
    const variantPath = await policy.resolve(path.join(path.dirname(input.destination), `${baseName}-${width}.webp`), { allowBinary: true });
    const variant = await sharp(source).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    await writeFile(variantPath, variant);
    derivatives.push({ localPath: policy.relative(variantPath), width, format: "webp", checksumSha256: createHash("sha256").update(variant).digest("hex") });
  }
  if (metadata.width >= 1_000) {
    const avifWidth = Math.min(1_920, metadata.width);
    const avifPath = await policy.resolve(path.join(path.dirname(input.destination), `${baseName}-${avifWidth}.avif`), { allowBinary: true });
    const avif = await sharp(source).rotate().resize({ width: avifWidth, withoutEnlargement: true }).avif({ quality: 55 }).toBuffer();
    await writeFile(avifPath, avif);
    derivatives.push({ localPath: policy.relative(avifPath), width: avifWidth, format: "avif", checksumSha256: createHash("sha256").update(avif).digest("hex") });
  }
  const provenance: AssetProvenance = {
    recordId: randomUUID(),
    id: input.candidate.id,
    originalUrl: input.candidate.assetUrl,
    sourcePage: input.candidate.sourcePage,
    creator: input.candidate.creator,
    provider: input.candidate.provider,
    license: input.candidate.license,
    ...(input.candidate.licenseUrl ? { licenseUrl: input.candidate.licenseUrl } : {}),
    attributionText: `${input.candidate.title} by ${input.candidate.creator}, licensed ${input.candidate.license.toUpperCase()}`,
    downloadedAt: new Date().toISOString(),
    checksumSha256: createHash("sha256").update(transformed).digest("hex"),
    transformations: [`decoded ${metadata.format ?? type}`, "auto-rotated", "bounded to 2400px", "encoded WebP quality 82", `generated ${derivatives.length} responsive derivative(s)`],
    localPath: policy.relative(destination),
    derivatives,
    usedBy: input.usedBy,
    altText: input.altText,
    decorative: input.decorative,
    authorization: "provider-license"
  };
  manifest.assets = [...manifest.assets, provenance];
  await writeJsonAtomic(manifestPath, manifest);
  return provenance;
}

export async function registerSuppliedImage(input: { projectRoot: string; assetPath: string; usedBy: string[]; altText: string; decorative: boolean; config: AppConfig }): Promise<AssetProvenance> {
  if (input.decorative && input.altText !== "") throw new UiAgentError("INVALID_INPUT", "Decorative images must use empty alt text.");
  if (!input.decorative && input.altText.trim().length < 3) throw new UiAgentError("INVALID_INPUT", "Functional/content images require useful alt text.");
  const policy = new ProjectPathPolicy(input.projectRoot);
  const absolute = await policy.resolve(input.assetPath, { mustExist: true, allowBinary: true });
  const source = await readFile(absolute);
  if (source.length > input.config.imageSearch.maxBytes) throw new UiAgentError("INVALID_INPUT", "Supplied image exceeds configured byte limit.");
  const metadata = await sharp(source, { limitInputPixels: input.config.imageSearch.maxDecodedPixels }).metadata();
  if (!metadata.width || !metadata.height || metadata.width > input.config.imageSearch.maxWidth || metadata.height > input.config.imageSearch.maxHeight || metadata.width * metadata.height > input.config.imageSearch.maxDecodedPixels) throw new UiAgentError("INVALID_INPUT", "Supplied image dimensions are unsafe or unreadable.");
  const extensionFormats: Record<string, string[]> = { ".jpg": ["jpeg"], ".jpeg": ["jpeg"], ".png": ["png"], ".webp": ["webp"], ".avif": ["avif"], ".gif": ["gif"] };
  const extension = path.extname(absolute).toLowerCase();
  if (!metadata.format || !extensionFormats[extension]?.includes(metadata.format)) throw new UiAgentError("INVALID_INPUT", "Supplied file extension does not match approved raster magic bytes; SVG must be sanitized or rasterized separately.");
  const provenance: AssetProvenance = {
    recordId: randomUUID(), id: `user-supplied:${createHash("sha256").update(source).digest("hex").slice(0, 16)}`,
    originalUrl: "user-supplied", sourcePage: "user-supplied", creator: "user-supplied", provider: "user",
    license: "user-authorized", attributionText: "Authorization and licensing supplied by the user", downloadedAt: new Date().toISOString(),
    checksumSha256: createHash("sha256").update(source).digest("hex"), transformations: [], localPath: policy.relative(absolute), derivatives: [],
    usedBy: input.usedBy, altText: input.altText, decorative: input.decorative, authorization: "user-supplied"
  };
  const manifestPath = path.join(input.projectRoot, "assets.provenance.json");
  let manifest: { schemaVersion: 1; assets: AssetProvenance[] } = { schemaVersion: 1, assets: [] };
  try { manifest = await readJson(manifestPath); } catch {}
  manifest.assets = [...manifest.assets, provenance];
  await writeJsonAtomic(manifestPath, manifest);
  return provenance;
}

async function fetchPermitted(value: string, config: AppConfig, signal: AbortSignal): Promise<Response> {
  let url = new URL(value);
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    if (url.protocol !== "https:") throw new UiAgentError("NETWORK_BLOCKED", "Image downloads require HTTPS.");
    if (!isPermittedHost(url.hostname, config)) throw new UiAgentError("NETWORK_BLOCKED", `Asset host is not permitted: ${url.hostname}`);
    await validateExternalReferenceUrl(url.toString());
    const response = await fetch(url, { redirect: "manual", signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new UiAgentError("PROCESS_FAILED", "Image redirect omitted its Location header.");
    url = new URL(location, url);
  }
  throw new UiAgentError("NETWORK_BLOCKED", "Image download exceeded five redirects.");
}

async function readBounded(response: Response, maximum: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maximum) throw new UiAgentError("INVALID_INPUT", `Asset exceeds configured byte limit (${maximum}).`);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) { await reader.cancel(); throw new UiAgentError("INVALID_INPUT", `Asset exceeds configured byte limit (${maximum}).`); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, length);
}

function isPermittedHost(hostname: string, config: AppConfig): boolean {
  const host = hostname.toLowerCase();
  return config.imageSearch.permittedDomains.some((domain) => host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`));
}

function escapeXml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" })[char]!); }
