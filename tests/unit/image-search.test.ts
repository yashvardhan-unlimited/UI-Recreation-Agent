import { afterEach, describe, expect, it, vi } from "vitest";
import { searchImages } from "../../src/tools/image-search.js";
import { testConfig } from "../helpers.js";

describe("licensed image search normalization", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("filters incompatible licenses, watermarks, and low-resolution candidates", async () => {
    const results = [
      { id: "good", title: "Robotics", thumbnail: "https://api.openverse.org/thumb.jpg", url: "https://upload.wikimedia.org/good.jpg", foreign_landing_url: "https://commons.wikimedia.org/wiki/good", creator: "Creator", width: 1600, height: 900, filetype: "jpg", license: "by", license_url: "https://creativecommons.org/licenses/by/4.0/", provider: "wikimedia", watermarked: false },
      { id: "bad-license", title: "No", thumbnail: "https://api.openverse.org/no.jpg", url: "https://upload.wikimedia.org/no.jpg", foreign_landing_url: "https://commons.wikimedia.org/no", creator: "Creator", width: 1600, height: 900, license: "by-nc", watermarked: false },
      { id: "watermark", title: "No", thumbnail: "https://api.openverse.org/w.jpg", url: "https://upload.wikimedia.org/w.jpg", foreign_landing_url: "https://commons.wikimedia.org/w", creator: "Creator", width: 1600, height: 900, license: "by", watermarked: true }
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results }), { status: 200 })));
    const candidates = await searchImages({ query: "robotics lab", config: testConfig() });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ id: "openverse:good", license: "by", licenseConfidence: "high" });
  });
});
