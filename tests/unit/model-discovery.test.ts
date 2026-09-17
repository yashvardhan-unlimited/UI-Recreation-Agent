import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverModels, selectModels, verifyOpenAiModelsEndpoint } from "../../src/model/discovery.js";
import { testConfig, tagsFixture } from "../helpers.js";

describe("model discovery and Pi provider selection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses only exact IDs returned by discovery and initially prefers qwen3.8:27b", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(tagsFixture), { status: 200 })));
    const config = testConfig();
    const models = await discoverModels(config);
    const selected = selectModels(models, config);
    expect(selected.coding.name).toBe("qwen3.8:27b");
    expect(selected.visual?.name).toBe("qwen3.8:27b");
  });

  it("rejects a configured ID that discovery did not return", () => {
    const config = testConfig({ model: { ...testConfig().model, codingModelId: "invented:latest" } });
    expect(() => selectModels(tagsFixture.models, config)).toThrow(/not installed/);
  });

  it("verifies /v1/models contains the selected exact IDs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ object: "list", data: [{ id: "qwen3.8:27b" }] }), { status: 200 })));
    await expect(verifyOpenAiModelsEndpoint(testConfig())).resolves.toEqual(["qwen3.8:27b"]);
  });
});
