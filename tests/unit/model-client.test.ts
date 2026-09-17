import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalOpenAiClient } from "../../src/model/openai-client.js";
import { parseJsonWithRecovery } from "../../src/model/structured.js";
import { testConfig } from "../helpers.js";

describe("model request resilience", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("recovers fenced JSON with a trailing comma", () => {
    const result = parseJsonWithRecovery("```json\n{\"ok\":true,}\n```", (value) => value as { ok: boolean });
    expect(result).toEqual({ value: { ok: true }, recovered: true });
  });

  it("retries a transient server failure then succeeds", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ model: "qwen3.8:27b", choices: [{ finish_reason: "stop", message: { content: "ok" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const config = testConfig({ model: { ...testConfig().model, retry: { maxAttempts: 2, baseDelayMs: 0 } } });
    await expect(new LocalOpenAiClient(config).chat({ model: "qwen3.8:27b", messages: [{ role: "user", content: "test" }] })).resolves.toMatchObject({ content: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors caller cancellation without retrying", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation(async (_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      controller.abort();
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new LocalOpenAiClient(testConfig()).chat({ model: "qwen3.8:27b", messages: [{ role: "user", content: "test" }], signal: controller.signal })).rejects.toMatchObject({ code: "ABORTED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports malformed model envelopes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    await expect(new LocalOpenAiClient(testConfig({ model: { ...testConfig().model, retry: { maxAttempts: 1, baseDelayMs: 0 } } })).chat({ model: "qwen3.8:27b", messages: [{ role: "user", content: "test" }] })).rejects.toMatchObject({ code: "PROCESS_FAILED" });
  });

  it("reports request timeouts distinctly after the configured retry budget", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason instanceof Error ? init.signal.reason : new Error("aborted")), { once: true });
    })));
    const config = testConfig({ model: { ...testConfig().model, requestTimeoutMs: 1_000, retry: { maxAttempts: 1, baseDelayMs: 0 } } });
    await expect(new LocalOpenAiClient(config).chat({ model: "qwen3.8:27b", messages: [{ role: "user", content: "timeout" }] })).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("enforces local bounded image attachments before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const content = [{ type: "image_url", image_url: { url: "https://example.com/image.png" } }, { type: "text", text: "inspect" }];
    await expect(new LocalOpenAiClient(testConfig()).chat({ model: "qwen3.8:27b", messages: [{ role: "user", content }] })).rejects.toMatchObject({ code: "NETWORK_BLOCKED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
