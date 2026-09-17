import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserManager } from "../../src/tools/browser.js";
import { testConfig } from "../helpers.js";

describe("real browser collection", () => {
  let manager: BrowserManager | undefined;
  afterEach(async () => manager?.close());

  it("collects console, overflow, broken-image, accessibility, and normalized screenshots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ui-agent-browser-"));
    manager = new BrowserManager(testConfig(), root);
    const html = `data:text/html,${encodeURIComponent("<!doctype html><html><title>Fixture</title><style>body{margin:0}.wide{width:900px}</style><main><h1>Fixture</h1><button></button><img src='missing.png'><div class='wide'>wide</div></main><script>console.error('fixture-console-error')</script></html>")}`;
    const id = await manager.createSession({ url: html, mode: "preview", width: 390, height: 844 });
    const quality = await manager.collectQuality(id);
    expect(quality.consoleErrors).toContain("fixture-console-error");
    expect(quality.horizontalOverflowPx).toBeGreaterThan(0);
    expect((quality.brokenImages as string[]).length).toBeGreaterThan(0);
    expect((quality.accessibility as any).violations.length).toBeGreaterThan(0);
    const screenshot = await manager.capture(id, { name: "mobile state / menu", mode: "stable" });
    expect(screenshot.path).toMatch(/mobile-state-menu\.png$/);
  });
});
