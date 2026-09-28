import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverModels, GROQ_BASE_URL, resolveModelBackend, selectModels, verifyOpenAiModelsEndpoint } from "../../src/model/discovery.js";
import { testConfig, tagsFixture } from "../helpers.js";

describe("model discovery and Pi provider selection", () => {
  const originalGroqKey = process.env.GROQ_API_KEY;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalGroqKey;
  });

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

  it("prefers the local backend when both local endpoints are active", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(tagsFixture), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: "list", data: [{ id: "qwen3.8:27b" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.GROQ_API_KEY = "unused-test-key";

    const backend = await resolveModelBackend(testConfig());

    expect(backend.provider).toBe("local-ollama");
    expect(backend.selected.coding.name).toBe("qwen3.8:27b");
    expect(backend.config.model.requestTimeoutMs).toBe(testConfig().model.requestTimeoutMs);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to Groq with bearer auth when local discovery is unavailable", async () => {
    process.env.GROQ_API_KEY = "test-groq-key";
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.toString() : input;
      if (url.startsWith("http://127.0.0.1")) throw new TypeError("fetch failed");
      expect(url).toBe(`${GROQ_BASE_URL}/models`);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-groq-key");
      return new Response(JSON.stringify({ object: "list", data: [{ id: "openai/gpt-oss-20b" }, { id: "qwen/qwen3.8-27b" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const backend = await resolveModelBackend(testConfig());

    expect(backend.provider).toBe("groq");
    expect(backend.config.model.inferenceBaseUrl).toBe(GROQ_BASE_URL);
    expect(backend.selected.coding.name).toBe("openai/gpt-oss-20b");
    expect(backend.selected.visual?.name).toBe("qwen/qwen3.8-27b");
    expect(backend.fallbackReason).toMatch(/fetch failed/i);
  });

  it("falls back to Groq when local discovery works but the inference endpoint errors", async () => {
    process.env.GROQ_API_KEY = "test-groq-key";
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.toString() : input;
      if (url.endsWith("/api/tags")) return new Response(JSON.stringify(tagsFixture), { status: 200 });
      if (url.startsWith("http://127.0.0.1") && url.endsWith("/models")) return new Response("local unavailable", { status: 503 });
      if (url === `${GROQ_BASE_URL}/models`) return new Response(JSON.stringify({ object: "list", data: [{ id: "openai/gpt-oss-20b" }, { id: "qwen/qwen3.8-27b" }] }), { status: 200 });
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const backend = await resolveModelBackend(testConfig());

    expect(backend.provider).toBe("groq");
    expect(backend.fallbackReason).toMatch(/HTTP 503/);
    expect(backend.selected.coding.name).toBe("openai/gpt-oss-20b");
  });

  it("gives an actionable error when local inference and GROQ_API_KEY are absent", async () => {
    delete process.env.GROQ_API_KEY;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(resolveModelBackend(testConfig())).rejects.toMatchObject({ code: "CAPABILITY_MISSING", suggestion: expect.stringContaining("GROQ_API_KEY") });
  });

  it("refuses to send Groq credentials to a non-Groq host", async () => {
    const config = testConfig({ model: { ...testConfig().model, provider: "groq", inferenceBaseUrl: "https://example.com/v1", auth: { environmentVariable: "GROQ_API_KEY" } } });
    await expect(verifyOpenAiModelsEndpoint(config)).rejects.toMatchObject({ code: "NETWORK_BLOCKED" });
  });
});
