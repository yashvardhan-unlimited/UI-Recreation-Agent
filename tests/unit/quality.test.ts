import { describe, expect, it } from "vitest";
import { evaluateBrowserResult } from "../../src/tools/quality.js";
import { testConfig } from "../helpers.js";

const clean = {
  consoleErrors: [], pageErrors: [], failedRequests: [], blockedRequests: [], brokenImages: [], offViewportControls: [],
  horizontalOverflowPx: 0, emptyReactRoot: false, accessibility: { violations: [] }
};

describe("deterministic browser gate", () => {
  it("fails on network/browser evidence even if a visual reviewer is positive", () => {
    expect(evaluateBrowserResult(clean, testConfig())).toBe(true);
    expect(evaluateBrowserResult({ ...clean, failedRequests: [{ url: "/missing.png" }] }, testConfig())).toBe(false);
    expect(evaluateBrowserResult({ ...clean, accessibility: { violations: [{ impact: "critical" }] } }, testConfig())).toBe(false);
  });
});
