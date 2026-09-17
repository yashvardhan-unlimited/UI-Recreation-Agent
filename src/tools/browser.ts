import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page, type Request, type Route } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import type { AppConfig } from "../config/schema.js";
import { UiAgentError } from "../utils/errors.js";
import { ProjectPathPolicy } from "./path-policy.js";
import { isAllowedPreviewUrl, validateExternalReferenceUrl } from "./url-safety.js";

export interface BrowserEvidence {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: Array<{ url: string; method: string; reason: string }>;
  blockedRequests: Array<{ url: string; method: string; reason: string }>;
}

interface BrowserSession {
  id: string;
  context: BrowserContext;
  page: Page;
  mode: "preview" | "reference";
  origin: string;
  evidence: BrowserEvidence;
}

export interface BrowserInspection {
  url: string;
  title: string;
  ariaSnapshot: string;
  visibleText: string;
  elements: Array<{
    selectorHint: string;
    tag: string;
    role: string | null;
    text: string;
    bounds: { x: number; y: number; width: number; height: number };
    style: Record<string, string>;
  }>;
  evidence: BrowserEvidence;
}

export class BrowserManager {
  private browser: Browser | undefined;
  private readonly sessions = new Map<string, BrowserSession>();
  private screenshotCount = 0;

  constructor(private readonly config: AppConfig, private readonly artifactRoot: string) {}

  executablePath(): string {
    return chromium.executablePath();
  }

  async createSession(input: { url: string; mode: "preview" | "reference"; width: number; height: number; deviceScaleFactor?: number; signal?: AbortSignal | undefined }): Promise<string> {
    const url = input.mode === "reference" ? (await validateExternalReferenceUrl(input.url)).url : new URL(input.url);
    if (input.mode === "preview" && !["data:", "about:"].includes(url.protocol) && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new UiAgentError("NETWORK_BLOCKED", "Preview browser accepts only loopback or inline diagnostic URLs.");
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: { width: input.width, height: input.height },
      deviceScaleFactor: input.deviceScaleFactor ?? 1,
      acceptDownloads: false,
      permissions: [],
      serviceWorkers: "block",
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: "light",
      reducedMotion: "no-preference"
    });
    const evidence: BrowserEvidence = { consoleErrors: [], pageErrors: [], failedRequests: [], blockedRequests: [] };
    const page = await context.newPage();
    page.on("console", (message) => { if (message.type() === "error") evidence.consoleErrors.push(message.text().slice(0, 1_000)); });
    page.on("pageerror", (error) => evidence.pageErrors.push(error.message.slice(0, 1_000)));
    page.on("requestfailed", (request) => evidence.failedRequests.push({ url: request.url(), method: request.method(), reason: request.failure()?.errorText ?? "failed" }));
    page.on("popup", (popup) => { evidence.blockedRequests.push({ url: popup.url(), method: "GET", reason: "popup blocked" }); void popup.close(); });
    page.on("download", (download) => { evidence.blockedRequests.push({ url: download.url(), method: "GET", reason: "download blocked" }); void download.cancel(); });
    await context.route("**/*", async (route) => this.guardRoute(route, input.mode, url, evidence));
    const id = randomUUID();
    this.sessions.set(id, { id, context, page, mode: input.mode, origin: url.origin, evidence });
    try {
      await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: this.config.workflow.perToolTimeoutMs });
      await this.waitForReady(page);
    } catch (error) {
      await this.closeSession(id);
      throw error;
    }
    return id;
  }

  async inspect(sessionId: string, selector = "body"): Promise<BrowserInspection> {
    const session = this.requireSession(sessionId);
    const locator = session.page.locator(selector).first();
    await locator.waitFor({ state: "visible", timeout: 15_000 });
    const ariaSnapshot = await locator.ariaSnapshot({ timeout: 15_000 });
    const visibleText = (await locator.innerText()).slice(0, 30_000);
    const elements = await session.page.locator("header,nav,main,section,article,aside,footer,h1,h2,h3,a,button,input,select,textarea,[role]").evaluateAll((nodes) => nodes.slice(0, 400).flatMap((node, index) => {
      const element = node as HTMLElement;
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (bounds.width <= 0 || bounds.height <= 0 || style.visibility === "hidden" || style.display === "none") return [];
      return [{
        selectorHint: element.id ? `#${element.id}` : `${element.tagName.toLowerCase()}:nth-visible(${index + 1})`,
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        text: (element.innerText || element.getAttribute("aria-label") || "").trim().slice(0, 300),
        bounds: { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) },
        style: {
          display: style.display,
          position: style.position,
          color: style.color,
          backgroundColor: style.backgroundColor,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          borderRadius: style.borderRadius,
          boxShadow: style.boxShadow,
          padding: style.padding,
          gap: style.gap
        }
      }];
    }));
    return { url: session.page.url(), title: await session.page.title(), ariaSnapshot, visibleText, elements, evidence: structuredClone(session.evidence) };
  }

  async interact(sessionId: string, action: { kind: "click" | "type" | "hover" | "focus" | "press" | "scroll" | "select"; selector?: string; value?: string; key?: string; x?: number; y?: number }): Promise<{ url: string; evidence: BrowserEvidence }> {
    const session = this.requireSession(sessionId);
    if (session.mode === "reference" && action.kind === "press" && action.key === "Enter") throw new UiAgentError("NETWORK_BLOCKED", "Enter submission is blocked in the reference browser.");
    if (action.kind === "scroll") await session.page.mouse.wheel(action.x ?? 0, action.y ?? 600);
    else {
      if (!action.selector) throw new UiAgentError("INVALID_INPUT", `${action.kind} requires a selector.`);
      const locator = session.page.locator(action.selector).first();
      if (session.mode === "reference") {
        const metadata = await locator.evaluate((node) => {
          const element = node as HTMLInputElement;
          return { type: element.type, text: (node.textContent ?? "").trim(), tag: node.nodeName.toLowerCase(), inForm: Boolean(element.closest("form")), download: node instanceof HTMLAnchorElement && node.hasAttribute("download") };
        });
        if (metadata.type === "password" || metadata.type === "file" || metadata.download || (action.kind === "click" && (metadata.inForm || /delete|remove|purchase|buy now|pay|submit|send|publish|logout|log out|sign out|unsubscribe|confirm transfer|book now|reserve/i.test(metadata.text)))) throw new UiAgentError("NETWORK_BLOCKED", "Sensitive or state-changing reference interaction blocked.");
      }
      if (action.kind === "click") await locator.click();
      if (action.kind === "type") await locator.fill(action.value ?? "");
      if (action.kind === "hover") await locator.hover();
      if (action.kind === "focus") await locator.focus();
      if (action.kind === "press") await locator.press(action.key ?? "Tab");
      if (action.kind === "select") await locator.selectOption(action.value ?? "");
    }
    await session.page.waitForTimeout(150);
    return { url: session.page.url(), evidence: structuredClone(session.evidence) };
  }

  async capture(sessionId: string, input: { name: string; fullPage?: boolean; selector?: string; mode?: "stable" | "live" }): Promise<{ path: string; width: number; height: number; mode: string }> {
    if (this.screenshotCount >= this.config.browser.screenshot.maxCountPerRun) throw new UiAgentError("INVALID_INPUT", "Configured screenshot count limit reached.");
    const session = this.requireSession(sessionId);
    const safeName = input.name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "");
    if (!safeName) throw new UiAgentError("INVALID_INPUT", "Screenshot name is empty after sanitization.");
    const directory = path.join(this.artifactRoot, "screenshots");
    await mkdir(directory, { recursive: true });
    const filePath = await new ProjectPathPolicy(this.artifactRoot).resolve(path.join("screenshots", `${safeName}.png`), { allowBinary: true });
    const stable = input.mode !== "live";
    const style = stable ? await session.page.addStyleTag({ content: "*,*::before,*::after{animation-play-state:paused!important;caret-color:transparent!important;transition-duration:0s!important;scroll-behavior:auto!important}" }) : undefined;
    try {
      await this.waitForReady(session.page);
      const maximum = this.config.browser.screenshot;
      let size: { width: number; height: number };
      if (input.selector) {
        const locator = session.page.locator(input.selector).first();
        const box = await locator.boundingBox();
        if (!box) throw new UiAgentError("NOT_FOUND", `Screenshot selector is not visible: ${input.selector}`);
        if (box.width > maximum.maxWidth || box.height > maximum.maxHeight) throw new UiAgentError("INVALID_INPUT", "Selected element exceeds configured screenshot dimensions.");
        await locator.screenshot({ path: filePath, animations: stable ? "disabled" : "allow", caret: "hide", scale: "css" });
        size = { width: Math.ceil(box.width), height: Math.ceil(box.height) };
      } else {
        const documentSize = await session.page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
        const wantsFullPage = input.fullPage ?? true;
        if (wantsFullPage && (documentSize.width > maximum.maxWidth || documentSize.height > maximum.maxHeight)) {
          size = { width: Math.min(documentSize.width, maximum.maxWidth), height: Math.min(documentSize.height, maximum.maxHeight) };
          await session.page.screenshot({ path: filePath, clip: { x: 0, y: 0, ...size }, animations: stable ? "disabled" : "allow", caret: "hide", scale: "css" });
        } else {
          await session.page.screenshot({ path: filePath, fullPage: wantsFullPage, animations: stable ? "disabled" : "allow", caret: "hide", scale: "css" });
          size = wantsFullPage ? documentSize : await session.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
        }
      }
      this.screenshotCount += 1;
      return { path: filePath, width: size.width, height: size.height, mode: stable ? "stable" : "live" };
    } finally {
      await style?.evaluate((element) => element.parentNode?.removeChild(element)).catch(() => undefined);
    }
  }

  async collectQuality(sessionId: string): Promise<Record<string, unknown>> {
    const session = this.requireSession(sessionId);
    const page = session.page;
    const diagnostics = await page.evaluate(() => {
      const root = document.getElementById("root");
      const images = [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.currentSrc || image.src);
      const viewportWidth = document.documentElement.clientWidth;
      const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - viewportWidth;
      const controls = [...document.querySelectorAll<HTMLElement>("a,button,input,select,textarea,[tabindex]")].filter((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
      });
      const offViewportControls = controls.flatMap((element) => {
        const box = element.getBoundingClientRect();
        return box.right < 0 || box.left > viewportWidth || box.bottom < 0 ? [element.outerHTML.slice(0, 300)] : [];
      });
      const clippedCriticalContent = [...document.querySelectorAll<HTMLElement>("h1,h2,h3,p,a,button,label,input,textarea")].flatMap((element) => {
        const style = getComputedStyle(element);
        const clipsX = ["hidden", "clip"].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 2;
        const clipsY = ["hidden", "clip"].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 2;
        return clipsX || clipsY ? [element.outerHTML.slice(0, 300)] : [];
      }).slice(0, 40);
      const critical = [...document.querySelectorAll<HTMLElement>("h1,h2,nav,a,button,input,main")].filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden";
      }).slice(0, 120);
      const overlaps: string[] = [];
      for (let first = 0; first < critical.length; first += 1) for (let second = first + 1; second < critical.length; second += 1) {
        const a = critical[first]!; const b = critical[second]!;
        if (a.contains(b) || b.contains(a)) continue;
        const x = a.getBoundingClientRect(); const y = b.getBoundingClientRect();
        const overlapWidth = Math.max(0, Math.min(x.right, y.right) - Math.max(x.left, y.left));
        const overlapHeight = Math.max(0, Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top));
        if (overlapWidth * overlapHeight > Math.min(x.width * x.height, y.width * y.height) * 0.25) overlaps.push(`${a.tagName.toLowerCase()} '${(a.innerText || "").slice(0, 40)}' overlaps ${b.tagName.toLowerCase()} '${(b.innerText || "").slice(0, 40)}'`);
      }
      return { emptyReactRoot: Boolean(root && root.childElementCount === 0 && !(root.textContent ?? "").trim()), brokenImages: images, horizontalOverflowPx: overflow, offViewportControls, clippedCriticalContent, overlaps: overlaps.slice(0, 40), focusableCount: controls.length };
    });
    const focusSequence: Array<{ element: string; visibleIndicator: boolean }> = [];
    const focusableCount = Number(diagnostics.focusableCount ?? 0);
    for (let index = 0; index < Math.min(30, focusableCount + 1); index += 1) {
      await page.keyboard.press("Tab");
      focusSequence.push(await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        if (!active || active === document.body) return { element: "body", visibleIndicator: false };
        const style = getComputedStyle(active);
        const outlineVisible = style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth || "0") > 0;
        const shadowVisible = style.boxShadow !== "none";
        return { element: active.id ? `#${active.id}` : `${active.tagName.toLowerCase()}:${(active.textContent ?? active.getAttribute("aria-label") ?? "").trim().slice(0, 60)}`, visibleIndicator: outlineVisible || shadowVisible };
      }));
    }
    const nonBodyFocus = focusSequence.filter((entry) => entry.element !== "body");
    const possibleKeyboardTrap = focusableCount > 1 && new Set(nonBodyFocus.map((entry) => entry.element)).size <= 1;
    const missingVisibleFocus = nonBodyFocus.filter((entry) => !entry.visibleIndicator).map((entry) => entry.element);
    const axe = await new AxeBuilder({ page }).analyze();
    return {
      ...diagnostics,
      focusSequence,
      possibleKeyboardTrap,
      missingVisibleFocus,
      consoleErrors: session.evidence.consoleErrors,
      pageErrors: session.evidence.pageErrors,
      failedRequests: session.evidence.failedRequests,
      blockedRequests: session.evidence.blockedRequests,
      accessibility: {
        violations: axe.violations.map((violation) => ({ id: violation.id, impact: violation.impact, help: violation.help, helpUrl: violation.helpUrl, nodes: violation.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) })),
        passes: axe.passes.length,
        incomplete: axe.incomplete.length
      }
    };
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    await session.context.close();
  }

  async close(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.closeSession(id)));
    await this.browser?.close();
    this.browser = undefined;
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    const channel = this.config.browser.browserName === "chromium" ? undefined : this.config.browser.browserName;
    this.browser = await chromium.launch({ headless: this.config.browser.headless, ...(channel ? { channel } : {}) });
    return this.browser;
  }

  private requireSession(id: string): BrowserSession {
    const session = this.sessions.get(id);
    if (!session) throw new UiAgentError("NOT_FOUND", `Browser session not found: ${id}`);
    return session;
  }

  private async guardRoute(route: Route, mode: "preview" | "reference", initialUrl: URL, evidence: BrowserEvidence): Promise<void> {
    const request = route.request();
    const url = request.url();
    try {
      if (mode === "preview") {
        if (!isAllowedPreviewUrl(url, initialUrl.origin)) return this.abortRoute(route, request, evidence, "external preview request blocked");
      } else {
        if (!["GET", "HEAD"].includes(request.method())) return this.abortRoute(route, request, evidence, "state-changing request blocked");
        const target = new URL(url);
        if (request.isNavigationRequest() && target.origin !== initialUrl.origin) return this.abortRoute(route, request, evidence, "unexpected external navigation blocked");
        if (["http:", "https:"].includes(target.protocol)) await validateExternalReferenceUrl(url);
        else if (!["data:", "blob:", "about:"].includes(target.protocol)) return this.abortRoute(route, request, evidence, "unsupported protocol blocked");
      }
      await route.continue();
    } catch (error) {
      await this.abortRoute(route, request, evidence, error instanceof Error ? error.message : "request blocked");
    }
  }

  private async abortRoute(route: Route, request: Request, evidence: BrowserEvidence, reason: string): Promise<void> {
    evidence.blockedRequests.push({ url: request.url(), method: request.method(), reason: reason.slice(0, 300) });
    await route.abort("blockedbyclient");
  }

  private async waitForReady(page: Page): Promise<void> {
    await page.waitForLoadState("domcontentloaded");
    await page.waitForFunction(() => {
      const ready = (window as Window & { __UI_AGENT_READY__?: boolean }).__UI_AGENT_READY__;
      const root = document.getElementById("root");
      return ready === true || !root || root.childElementCount > 0 || Boolean(root.textContent?.trim());
    }, undefined, { timeout: 15_000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.complete ? Promise.resolve() : new Promise<void>((resolve) => { image.addEventListener("load", () => resolve(), { once: true }); image.addEventListener("error", () => resolve(), { once: true }); })));
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
  }
}
