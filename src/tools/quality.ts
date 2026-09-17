import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";
import type { AppConfig } from "../config/schema.js";
import { runProcess, type ProcessResult } from "../utils/process.js";
import { BrowserManager } from "./browser.js";

export interface QualityCheckResult {
  passed: boolean;
  deterministic: Array<{ name: string; passed: boolean; skipped?: boolean; result?: ProcessResult; reason?: string }>;
  browser?: Record<string, Record<string, unknown>>;
}

export async function runQualityChecks(input: { projectRoot: string; previewUrl?: string; browser?: BrowserManager; artifactRoot?: string; config: AppConfig; signal?: AbortSignal | undefined }): Promise<QualityCheckResult> {
  const packageJson = JSON.parse(await readFile(path.join(input.projectRoot, "package.json"), "utf8")) as { scripts?: Record<string, string> };
  const deterministic: QualityCheckResult["deterministic"] = [];
  for (const name of ["typecheck", "lint", "build", "test"] as const) {
    if (!packageJson.scripts?.[name]) { deterministic.push({ name, passed: true, skipped: true, reason: "script not configured" }); continue; }
    try {
      const result = await runProcess("npm", ["run", name], { cwd: input.projectRoot, timeoutMs: input.config.workflow.perToolTimeoutMs, signal: input.signal });
      deterministic.push({ name, passed: result.exitCode === 0, result });
    } catch (error) {
      deterministic.push({ name, passed: false, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  let browserResult: Record<string, Record<string, unknown>> | undefined;
  if (input.previewUrl && input.browser) {
    browserResult = {};
    for (const viewport of input.config.browser.viewports) {
      const sessionId = await input.browser.createSession({ url: input.previewUrl, mode: "preview", ...viewport, signal: input.signal });
      try { browserResult[viewport.name] = await input.browser.collectQuality(sessionId); } finally { await input.browser.closeSession(sessionId); }
    }
  }
  if (input.previewUrl && input.config.quality.lighthouse.enabled) {
    try {
      const lighthouseResult = await runLighthouse(input.previewUrl, input.artifactRoot ?? path.join(input.projectRoot, ".ui-agent-artifacts"), input.signal);
      const passed = lighthouseResult.performance >= input.config.quality.lighthouse.performance && lighthouseResult.accessibility >= input.config.quality.lighthouse.accessibility;
      deterministic.push({ name: "lighthouse", passed, reason: `performance=${lighthouseResult.performance.toFixed(2)}, accessibility=${lighthouseResult.accessibility.toFixed(2)}, report=${lighthouseResult.reportPath}` });
    } catch (error) {
      deterministic.push({ name: "lighthouse", passed: false, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  const browserPassed = browserResult ? Object.values(browserResult).every((result) => evaluateBrowserResult(result, input.config)) : true;
  return { passed: deterministic.every((check) => check.passed) && browserPassed, deterministic, ...(browserResult ? { browser: browserResult } : {}) };
}

async function runLighthouse(url: string, artifactRoot: string, signal?: AbortSignal): Promise<{ performance: number; accessibility: number; reportPath: string }> {
  if (signal?.aborted) throw signal.reason;
  const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-extensions"] });
  const abort = () => { void chrome.kill(); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const result = await lighthouse(url, { port: chrome.port, output: "json", logLevel: "error", onlyCategories: ["performance", "accessibility"] });
    if (!result) throw new Error("Lighthouse returned no result.");
    const directory = path.join(artifactRoot, "quality");
    await mkdir(directory, { recursive: true });
    const reportPath = path.join(directory, "lighthouse.json");
    await writeFile(reportPath, typeof result.report === "string" ? result.report : JSON.stringify(result.lhr), "utf8");
    return { performance: result.lhr.categories.performance?.score ?? 0, accessibility: result.lhr.categories.accessibility?.score ?? 0, reportPath };
  } finally { signal?.removeEventListener("abort", abort); chrome.kill(); }
}

export function evaluateBrowserResult(result: Record<string, unknown>, config: AppConfig): boolean {
  const errors = ["consoleErrors", "pageErrors", "failedRequests", "blockedRequests", "brokenImages", "offViewportControls", "clippedCriticalContent", "missingVisibleFocus"].some((key) => Array.isArray(result[key]) && result[key].length > 0);
  const overflow = typeof result.horizontalOverflowPx === "number" && result.horizontalOverflowPx > 2;
  const empty = result.emptyReactRoot === true;
  const keyboardTrap = result.possibleKeyboardTrap === true;
  const accessibility = result.accessibility as { violations?: Array<{ impact?: string | null }> } | undefined;
  const severeAxe = accessibility?.violations?.some((violation) => violation.impact && config.quality.axeImpactBlocklist.includes(violation.impact as any)) ?? false;
  return !errors && !overflow && !empty && !keyboardTrap && !severeAxe;
}
