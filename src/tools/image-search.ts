import { z } from "zod";
import type { AppConfig } from "../config/schema.js";
import { UiAgentError } from "../utils/errors.js";
import type { ImageCandidate } from "./assets.js";
import { deadlineSignal } from "../utils/abort.js";

const openverseResponseSchema = z.object({
  results: z.array(z.object({
    id: z.string(),
    title: z.string().nullish(),
    thumbnail: z.string().url().nullish(),
    url: z.string().url().nullish(),
    foreign_landing_url: z.string().url().nullish(),
    creator: z.string().nullish(),
    creator_url: z.string().url().nullish(),
    width: z.number().nullish(),
    height: z.number().nullish(),
    filetype: z.string().nullish(),
    license: z.string(),
    license_url: z.string().url().nullish(),
    provider: z.string().nullish(),
    watermarked: z.boolean().nullish()
  }).passthrough())
});

export interface ImageSearchAdapter {
  id: AppConfig["imageSearch"]["providers"][number];
  search(input: { query: string; config: AppConfig; signal: AbortSignal }): Promise<ImageCandidate[]>;
}

const cache = new Map<string, { expiresAt: number; candidates: ImageCandidate[] }>();
let nextRequestAt = 0;

const openverseAdapter: ImageSearchAdapter = {
  id: "openverse",
  search: searchOpenverse
};

const adapters = new Map<ImageSearchAdapter["id"], ImageSearchAdapter>([[openverseAdapter.id, openverseAdapter]]);

export async function searchImages(input: { query: string; config: AppConfig; signal?: AbortSignal | undefined }): Promise<ImageCandidate[]> {
  const enabled = input.config.imageSearch.providers.flatMap((id) => adapters.get(id) ?? []);
  if (enabled.length === 0) throw new UiAgentError("CAPABILITY_MISSING", "No implemented image search provider is enabled.");
  const key = JSON.stringify({ query: input.query.trim().toLowerCase(), providers: enabled.map((adapter) => adapter.id), licenses: input.config.imageSearch.acceptedLicenses, limit: input.config.imageSearch.resultLimit });
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return structuredClone(cached.candidates);
  const waitMs = Math.max(0, nextRequestAt - Date.now());
  if (waitMs) await abortableDelay(waitMs, input.signal);
  nextRequestAt = Date.now() + 250;
  const signal = deadlineSignal(20_000, input.signal);
  const candidates = (await Promise.all(enabled.map((adapter) => adapter.search({ query: input.query, config: input.config, signal })))).flat().slice(0, input.config.imageSearch.resultLimit);
  cache.set(key, { expiresAt: Date.now() + 5 * 60_000, candidates });
  return structuredClone(candidates);
}

async function searchOpenverse(input: { query: string; config: AppConfig; signal: AbortSignal }): Promise<ImageCandidate[]> {
  const licenses = input.config.imageSearch.acceptedLicenses.join(",");
  const url = new URL("https://api.openverse.org/v1/images/");
  url.searchParams.set("q", input.query);
  url.searchParams.set("page_size", String(input.config.imageSearch.resultLimit));
  url.searchParams.set("license", licenses);
  url.searchParams.set("mature", input.config.imageSearch.safeSearch === "strict" ? "false" : "false");
  const response = await fetch(url, { headers: { "user-agent": "local-ui-agent/0.1 (licensed asset discovery)" }, signal: input.signal });
  if (!response.ok) throw new UiAgentError("PROCESS_FAILED", `Openverse search returned HTTP ${response.status}.`);
  const parsed = openverseResponseSchema.parse(await response.json());
  return parsed.results.flatMap((entry): ImageCandidate[] => {
    const license = entry.license.toLowerCase();
    const width = entry.width ?? undefined; const height = entry.height ?? undefined;
    const valid = entry.thumbnail && entry.url && entry.foreign_landing_url && permitted(entry.thumbnail, input.config) && permitted(entry.url, input.config) && input.config.imageSearch.acceptedLicenses.includes(license) && !entry.watermarked && (!width || width >= 1_000) && (!height || height >= 600);
    if (!valid) return [];
    return [{
      id: `openverse:${entry.id}`,
      provider: "openverse",
      title: entry.title?.trim() || "Untitled image",
      previewUrl: entry.thumbnail!,
      assetUrl: entry.url!,
      sourcePage: entry.foreign_landing_url!,
      creator: entry.creator?.trim() || "Unknown creator",
      ...(entry.creator_url ? { creatorUrl: entry.creator_url } : {}),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      ...(entry.filetype ? { fileType: entry.filetype } : {}),
      license,
      ...(entry.license_url ? { licenseUrl: entry.license_url } : {}),
      attributionRequired: !["cc0", "pdm"].includes(license),
      watermarked: false,
      licenseConfidence: entry.license_url ? "high" : "medium"
    }];
  });
}

async function abortableDelay(ms: number, parent?: AbortSignal): Promise<void> {
  if (parent?.aborted) throw new UiAgentError("ABORTED", "Image search cancelled.");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { parent?.removeEventListener("abort", abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(new UiAgentError("ABORTED", "Image search cancelled.")); };
    parent?.addEventListener("abort", abort, { once: true });
  });
}

function permitted(value: string, config: AppConfig): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && config.imageSearch.permittedDomains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}
