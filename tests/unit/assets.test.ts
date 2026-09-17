import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadApprovedImage, type ImageCandidate } from "../../src/tools/assets.js";
import { testConfig } from "../helpers.js";

const candidate: ImageCandidate = {
  id: "openverse:owned-test", provider: "openverse", title: "Robotics laboratory", previewUrl: "https://93.184.216.34/preview.png",
  assetUrl: "https://93.184.216.34/source.png", sourcePage: "https://example.com/source", creator: "Fixture Creator",
  width: 1200, height: 800, fileType: "png", license: "by", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  attributionRequired: true, watermarked: false, licenseConfidence: "high"
};

describe("approved image download", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates raster bytes, optimizes locally, and appends provenance with contextual alt text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ui-agent-assets-"));
    const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#345678" } }).png().toBuffer();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(png, { status: 200, headers: { "content-type": "image/png", "content-length": String(png.length) } })));
    const config = testConfig({ imageSearch: { ...testConfig().imageSearch, permittedDomains: ["93.184.216.34"] } });
    const result = await downloadApprovedImage({ candidate, approvedCandidateId: candidate.id, projectRoot: root, destination: "public/images/robotics-lab.webp", usedBy: ["src/App.tsx"], altText: "Robotic arms operating in a research laboratory", decorative: false, config });
    expect(result.localPath).toBe("public/images/robotics-lab.webp");
    expect(result.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.altText).toContain("Robotic arms");
    const manifest = JSON.parse(await readFile(path.join(root, "assets.provenance.json"), "utf8")) as { assets: unknown[] };
    expect(manifest.assets).toHaveLength(1);
  });

  it("blocks unapproved hosts before fetching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const root = await mkdtemp(path.join(os.tmpdir(), "ui-agent-assets-"));
    await expect(downloadApprovedImage({ candidate: { ...candidate, assetUrl: "https://127.0.0.1/private.png" }, approvedCandidateId: candidate.id, projectRoot: root, destination: "public/private.webp", usedBy: [], altText: "Private image", decorative: false, config: testConfig() })).rejects.toThrow(/not permitted/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
