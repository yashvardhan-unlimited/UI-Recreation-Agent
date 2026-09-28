import { defaultConfig, type AppConfig } from "../src/config/schema.js";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...structuredClone(defaultConfig),
    ...overrides,
    model: { ...defaultConfig.model, ...(overrides.model ?? {}), retry: { ...defaultConfig.model.retry, ...(overrides.model?.retry ?? {}) }, groq: { ...defaultConfig.model.groq, ...(overrides.model?.groq ?? {}) } },
    workflow: { ...defaultConfig.workflow, ...(overrides.workflow ?? {}) },
    browser: { ...defaultConfig.browser, ...(overrides.browser ?? {}), screenshot: { ...defaultConfig.browser.screenshot, ...(overrides.browser?.screenshot ?? {}) } },
    quality: { ...defaultConfig.quality, ...(overrides.quality ?? {}), lighthouse: { ...defaultConfig.quality.lighthouse, ...(overrides.quality?.lighthouse ?? {}) } },
    imageSearch: { ...defaultConfig.imageSearch, ...(overrides.imageSearch ?? {}) }
  };
}

export const tagsFixture = {
  models: [
    { name: "qwen3.8:27b", model: "qwen3.8:27b", modified_at: "2026-09-16T00:00:00Z", size: 17_741_872_154, digest: "abc", details: { parent_model: "", format: "gguf", family: "qwen35", parameter_size: "27.3B", quantization_level: "Q4_K_M", context_length: 262144 }, capabilities: ["completion", "tools", "thinking", "vision"] },
    { name: "text-only:1b", model: "text-only:1b", modified_at: "2026-09-16T00:00:00Z", size: 10, digest: "def", details: { parent_model: "", format: "gguf", context_length: 8192 }, capabilities: ["completion"] }
  ]
};
