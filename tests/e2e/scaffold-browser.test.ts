import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { reactViteScaffold } from "../../src/templates/react-vite.js";
import { applyUiPatch } from "../../src/tools/files.js";
import { PreviewManager } from "../../src/tools/preview.js";
import { BrowserManager } from "../../src/tools/browser.js";
import { testConfig } from "../helpers.js";

describe("generated React vertical slice", () => {
  const preview = new PreviewManager(180_000);
  let browser: BrowserManager | undefined;

  afterAll(async () => {
    await preview.cleanup();
    await browser?.close();
  });

  it("scaffolds, locks, installs, builds, runs, interacts, audits, and captures at real viewports", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ui-agent-scaffold-e2e-"));
    const artifactRoot = path.join(projectRoot, ".artifacts");
    await applyUiPatch(projectRoot, reactViteScaffold());
    await preview.createLockfile(projectRoot);
    await preview.install(projectRoot);
    await preview.build(projectRoot);
    const generatedTests = await preview.runScript(projectRoot, "test");
    expect(generatedTests.stdout).toContain("1 passed");
    const running = await preview.start(projectRoot);
    expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:/);

    browser = new BrowserManager(testConfig({ quality: { ...testConfig().quality, lighthouse: { enabled: false, performance: 0.75, accessibility: 0.9 } } }), artifactRoot);
    for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
      const sessionId = await browser.createSession({ url: running.url!, mode: "preview", width: viewport.width, height: viewport.height });
      const inspection = await browser.inspect(sessionId);
      expect(inspection.visibleText).toContain("Build the interface around a clear idea.");
      await browser.interact(sessionId, { kind: "click", selector: "button" });
      const quality = await browser.collectQuality(sessionId);
      expect(quality.emptyReactRoot).toBe(false);
      expect(quality.horizontalOverflowPx).toBeLessThanOrEqual(0);
      expect(quality.consoleErrors).toEqual([]);
      const screenshot = await browser.capture(sessionId, { name: `${viewport.name}-default`, mode: "stable" });
      expect(screenshot.path).toMatch(new RegExp(`${viewport.name}-default\\.png$`));
      await browser.closeSession(sessionId);
    }
  }, 300_000);
});
