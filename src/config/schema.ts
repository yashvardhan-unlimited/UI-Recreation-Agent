import { z } from "zod";

export const interactionLevelSchema = z.enum(["high", "balanced", "autonomous"]);
export type InteractionLevel = z.infer<typeof interactionLevelSchema>;

export const viewportSchema = z.object({
  name: z.string().min(1),
  width: z.number().int().min(240).max(7680),
  height: z.number().int().min(240).max(7680),
  deviceScaleFactor: z.number().min(0.5).max(4).default(1)
});

export const appConfigSchema = z.object({
  schemaVersion: z.literal(1),
  interaction: interactionLevelSchema.default("high"),
  model: z.object({
    discoveryUrl: z.string().url().default("http://127.0.0.1:18080/api/tags"),
    inferenceBaseUrl: z.string().url().default("http://127.0.0.1:18080/v1"),
    protocol: z.enum(["openai-completions", "ollama-native"]).default("openai-completions"),
    codingModelId: z.string().min(1).optional(),
    visualModelId: z.string().min(1).optional(),
    contextWindow: z.number().int().positive().max(2_000_000).default(262_144),
    maxOutputTokens: z.number().int().min(128).max(131_072).default(8_192),
    requestTimeoutMs: z.number().int().min(1_000).max(30 * 60_000).default(180_000),
    retry: z.object({
      maxAttempts: z.number().int().min(1).max(8).default(2),
      baseDelayMs: z.number().int().min(0).max(60_000).default(750)
    }).default({ maxAttempts: 2, baseDelayMs: 750 }),
    thinking: z.enum(["off", "minimal", "low", "medium", "high"]).default("off"),
    temperature: z.number().min(0).max(2).default(0.2),
    maxAttachedImages: z.number().int().min(1).max(8).default(2),
    maxImageBytes: z.number().int().min(1_024).max(50 * 1024 * 1024).default(8 * 1024 * 1024),
    auth: z.object({
      headerName: z.string().min(1).optional(),
      environmentVariable: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).optional()
    }).default({})
  }),
  workflow: z.object({
    maxRepairRounds: z.number().int().min(0).max(20).default(3),
    maxElapsedMs: z.number().int().min(10_000).max(24 * 60 * 60_000).default(45 * 60_000),
    perToolTimeoutMs: z.number().int().min(1_000).max(30 * 60_000).default(120_000),
    maxStagnantRounds: z.number().int().min(1).max(10).default(2)
  }),
  browser: z.object({
    browserName: z.enum(["chromium", "chrome", "msedge"]).default("chromium"),
    headless: z.boolean().default(true),
    viewports: z.array(viewportSchema).min(1).max(12).default([
      { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 },
      { name: "tablet", width: 1024, height: 768, deviceScaleFactor: 1 },
      { name: "mobile", width: 390, height: 844, deviceScaleFactor: 1 }
    ]),
    screenshot: z.object({
      maxWidth: z.number().int().min(240).max(10_000).default(3_000),
      maxHeight: z.number().int().min(240).max(30_000).default(12_000),
      maxCountPerRun: z.number().int().min(1).max(500).default(80)
    }).default({ maxWidth: 3_000, maxHeight: 12_000, maxCountPerRun: 80 })
  }),
  quality: z.object({
    axeImpactBlocklist: z.array(z.enum(["minor", "moderate", "serious", "critical"])).default(["serious", "critical"]),
    lighthouse: z.object({
      enabled: z.boolean().default(true),
      performance: z.number().min(0).max(1).default(0.75),
      accessibility: z.number().min(0).max(1).default(0.9)
    }).default({ enabled: true, performance: 0.75, accessibility: 0.9 })
  }),
  imageSearch: z.object({
    providers: z.array(z.enum(["openverse", "wikimedia"])).default(["openverse"]),
    permittedDomains: z.array(z.string()).default(["api.openverse.org", "commons.wikimedia.org", "upload.wikimedia.org"]),
    resultLimit: z.number().int().min(1).max(50).default(12),
    downloadLimit: z.number().int().min(1).max(20).default(5),
    safeSearch: z.enum(["strict", "moderate"]).default("strict"),
    acceptedLicenses: z.array(z.string()).default(["cc0", "pdm", "by", "by-sa"]),
    requireAttribution: z.boolean().default(true),
    requireExplicitApproval: z.boolean().default(true),
    maxBytes: z.number().int().min(1_024).max(100 * 1024 * 1024).default(15 * 1024 * 1024),
    maxWidth: z.number().int().min(320).max(30_000).default(12_000),
    maxHeight: z.number().int().min(320).max(30_000).default(12_000),
    maxDecodedPixels: z.number().int().min(1_000_000).max(200_000_000).default(40_000_000)
  })
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export const defaultConfig: AppConfig = appConfigSchema.parse({
  schemaVersion: 1,
  interaction: "high",
  model: {},
  workflow: {},
  browser: {},
  quality: {},
  imageSearch: {}
});
