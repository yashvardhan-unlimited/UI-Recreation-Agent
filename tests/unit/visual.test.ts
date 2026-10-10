import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { reviewScreenshot } from "../../src/tools/visual.js";
import { testConfig } from "../helpers.js";

describe("single-screenshot visual review", () => {
  it("sends the captured local image to the configured visual model and returns its structured review", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: "qwen3.8:27b",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ summary: "Clear hierarchy.", issues: [], strengths: ["The title is visible."], uncertainty: ["Interaction states are not visible."] }) } }]
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const review = await reviewScreenshot({
      imagePath: path.resolve("fixtures/references/robotics-desktop.svg"),
      modelId: "qwen3.8:27b",
      config: testConfig(),
      page: "home",
      viewport: "desktop",
      requirements: "A responsive robotics marketing page."
    });

    expect(review.summary).toBe("Clear hierarchy.");
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { model: string; messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }> };
    expect(request.model).toBe("qwen3.8:27b");
    expect(request.messages[0]?.content[0]?.image_url?.url).toMatch(/^data:image\/png;base64,/);
  });
});
