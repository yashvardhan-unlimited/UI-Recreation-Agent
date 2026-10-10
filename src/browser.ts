import { spawn } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import type { Issue } from "./gates.js";

type Pass = { name: string; width: number; height: number; reduce: boolean };
type Found = {
  hidden: [string, string, number][]; overflow: [string, string, number][]; jank: Record<string, number>;
  timeline: [number, string][]; cls: Record<string, number>; long: { t: number; ms: number }[]; lcp: number;
};

const passes: Pass[] = [
  { name: "390", width: 390, height: 844, reduce: false },
  { name: "1440", width: 1440, height: 900, reduce: false },
  { name: "390-reduced", width: 390, height: 844, reduce: true },
];

// Bundlers may inject `__name(...)` into serialized functions; define it so the page doesn't throw.
export const inPage = (fn: (...args: never[]) => unknown, arg?: unknown) => `(() => { const __name = (f) => f; return (${fn.toString()})(${JSON.stringify(arg) ?? ""}); })()`;
export const launch = () => chromium.launch(process.env.UI_CHROME_PATH ? { executablePath: process.env.UI_CHROME_PATH } : {});

function observe() {
  const ui = { cls: {} as Record<string, number>, long: [] as { t: number; ms: number }[], lcp: 0 };
  (window as unknown as { __ui: typeof ui }).__ui = ui;
  const sectionOf = (n?: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest("[data-section]")?.getAttribute("data-section") ?? "_app";
  new PerformanceObserver((list) => {
    for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean; sources?: { node?: Node }[] }[]) {
      if (e.hadRecentInput) continue;
      const id = sectionOf(e.sources?.[0]?.node);
      ui.cls[id] = (ui.cls[id] ?? 0) + e.value;
    }
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((list) => { for (const e of list.getEntries()) ui.long.push({ t: e.startTime, ms: e.duration }); }).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((list) => { for (const e of list.getEntries()) ui.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
}

// Scrolls like a user (so entrance animations fire), recording each text's best opacity, frame times and what overflows.
async function scrollThrough() {
  const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
  const sectionOf = (e: Element | null) => e?.closest("[data-section]")?.getAttribute("data-section") ?? "_app";
  const texts = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,a,button,li,dt,dd,span,label")].filter(
    (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()) && !e.closest('[aria-hidden="true"],.sr-only'),
  );
  const best = new Map(texts.map((e) => [e, 0]));
  const measure = () => {
    for (const e of texts) {
      const r = e.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || !r.width) continue;
      let o = 1;
      for (let n: Element | null = e; n; n = n.parentElement) o *= getComputedStyle(n).visibility === "hidden" ? 0 : Number(getComputedStyle(n).opacity);
      best.set(e, Math.max(best.get(e) ?? 0, o));
    }
  };
  const jank: Record<string, number> = {};
  const timeline: [number, string][] = [];
  // Real scrolling ends LCP; scripted scrolling doesn't, so read it before we start.
  const ui = (window as unknown as { __ui: { lcp: number } }).__ui;
  const lcp = ui.lcp;
  measure();
  for (let step = 0; step < 500 && scrollY + innerHeight < document.documentElement.scrollHeight - 1; step++) {
    let last = await frame();
    for (let i = 0; i < 4; i++) {
      scrollBy(0, innerHeight / 16);
      const t = await frame();
      const id = sectionOf(document.elementFromPoint(innerWidth / 2, innerHeight / 2));
      jank[id] = Math.max(jank[id] ?? 0, t - last);
      timeline.push([t, id]);
      last = t;
    }
    await new Promise((r) => setTimeout(r, 150));
    measure();
  }
  const overflow: [string, string, number][] = [];
  for (const section of document.querySelectorAll("[data-section]")) {
    for (const e of section.querySelectorAll("*")) {
      const r = e.getBoundingClientRect();
      const past = Math.max(r.right - innerWidth, -r.left);
      if (past <= 1) continue;
      let clipped = false;
      for (let n = e.parentElement; n && n !== section.parentElement && !clipped; n = n.parentElement) clipped = /hidden|clip/.test(getComputedStyle(n).overflowX);
      if (clipped) continue;
      overflow.push([sectionOf(section), `<${e.tagName.toLowerCase()} class="${e.getAttribute("class") ?? ""}">`, Math.round(past)]);
      break;
    }
  }
  const hidden = texts.filter((e) => (best.get(e) ?? 0) < 0.05).map((e): [string, string, number] => [sectionOf(e), (e.textContent ?? "").trim().slice(0, 60), best.get(e) ?? 0]);
  return { hidden, overflow, jank, timeline, ...ui, lcp };
}

async function runPass(browser: Browser, url: string, pass: Pass, sections: string[], shots: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  const at = `at ${pass.width}px${pass.reduce ? " with reduced motion" : ""}`;
  const once = new Set<string>();
  const add = (id: string, source: "runtime" | "perf", kind: string, fix: string) => {
    const section = sections.includes(id) ? id : "_app";
    if (once.has(section + kind)) return;
    once.add(section + kind);
    issues.push({ section, source, severity: source === "perf" ? "medium" : "high", fix });
  };
  const onError = (text: string) =>
    add(/\[section (\w+)\]/.exec(text)?.[1] ?? "_app", "runtime", "error", `Runtime error ${at}: ${text.slice(0, 300)}. Fix the code that throws; the section stays hidden until it renders cleanly.`);
  const context = await browser.newContext({ viewport: { width: pass.width, height: pass.height }, reducedMotion: pass.reduce ? "reduce" : "no-preference" });
  try {
    const page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error") onError(m.text()); });
    page.on("pageerror", (e) => onError(e.message));
    await page.addInitScript(inPage(observe));
    await page.goto(url, { waitUntil: "networkidle" });
    const found = (await page.evaluate(inPage(scrollThrough))) as Found;
    const jankMs = Number(process.env.UI_JANK_MS ?? 120);

    for (const [id, text, o] of found.hidden)
      add(id, "runtime", "hidden", `"${text}" never became visible ${at} (opacity peaked at ${o.toFixed(2)}). ` +
        (pass.reduce ? "With reduced motion, content must render visible: use kit primitives (they skip the hidden start) instead of a custom opacity-0 start." : "Don't start text at opacity 0; reveal it with a kit primitive (Reveal, TextReveal, Stagger) that fires on enter."));
    for (const [id, el, px] of found.overflow)
      add(id, "runtime", "overflow", `${el} sticks out ${px}px past the viewport edge ${at}; constrain it (max-w-full, min-w-0, flex-wrap, break-words) or clip its container with overflow-hidden.`);
    for (const [id, cls] of Object.entries(found.cls))
      if (cls > 0.05) add(id, "perf", "cls", `Layout shift ${cls.toFixed(3)} ${at} (limit 0.05): reserve space for anything that loads late (width/height on images, aspect-ratio on media) and don't animate layout properties.`);
    for (const [id, ms] of Object.entries(found.jank))
      if (ms > jankMs) add(id, "perf", "jank", `A ${Math.round(ms)}ms frame while scrolling ${at} (limit ${jankMs}ms): remove scroll handlers and heavy blur/shadow effects; animate only transform/opacity via kit primitives.`);
    for (const task of found.long.filter((l) => l.ms > 200)) {
      const id = found.timeline.findLast(([t]) => t <= task.t)?.[1] ?? "_app";
      add(id, "perf", "long", `A ${Math.round(task.ms)}ms main-thread task ${at} (limit 200ms): lazy-load heavy parts and avoid large synchronous work during render.`);
    }
    if (pass.name === "1440" && found.lcp > 2500)
      add("_app", "perf", "lcp", `Largest contentful paint took ${Math.round(found.lcp)}ms (limit 2500ms): render the hero heading/image immediately (no opacity-0 start on it) and give the hero image explicit dimensions.`);

    if (!pass.reduce) {
      await mkdir(join(shots, pass.name), { recursive: true });
      for (const id of sections) {
        const section = page.locator(`[data-section="${id}"]`);
        if ((await section.boundingBox())?.height) await section.screenshot({ path: join(shots, pass.name, `${id}.png`), scale: "css" });
      }
    }
  } finally {
    await context.close();
  }
  return issues;
}

/** Starts vite on a free local port (`preview` serves the build, `dev` serves source with HMR) and resolves once it answers; the caller stops it. */
export async function serve(root: string, command: "preview" | "dev") {
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
  // vite dev only serves files under the real path; a Windows 8.3 short path (C:\Users\NAME~1) or a link would get 403s.
  const cwd = await realpath(root);
  const vite = join(cwd, "node_modules", "vite", "bin", "vite.js");
  // Our own Node runs vite's bin directly (no npx, no shell), so kill() stops vite itself.
  const child = spawn(process.execPath, [vite, command, "--port", String(port), "--strictPort", "--host", "127.0.0.1"], { cwd, stdio: "ignore" });
  const url = `http://127.0.0.1:${port}/`;
  try {
    for (let waited = 0; !(await fetch(url).then((r) => r.ok, () => false)); waited += 100) {
      if (child.exitCode !== null) throw new Error(`vite ${command} exited with code ${child.exitCode}; run "node ${vite} ${command}" in ${root} to see why.`);
      if (waited > 15_000) throw new Error(`vite ${command} did not answer on ${url} within 15 s${command === "preview" ? `; check that ${root}/dist exists (run the build gate first)` : ""}.`);
      await new Promise((r) => setTimeout(r, 100));
    }
    return { url, child };
  } catch (e) {
    child.kill();
    throw e;
  }
}

/** Runs the §6.3 browser checks on the built stage at 390 and 1440 px plus a reduced-motion pass, with per-section screenshots. */
export async function audit(stage: string, { sections, shots }: { sections: string[]; shots: string }): Promise<Issue[]> {
  const server = await serve(stage, "preview");
  const browser = await launch().catch((e: unknown) => { server.child.kill(); throw e; });
  try {
    const issues: Issue[] = [];
    for (const pass of passes) issues.push(...(await runPass(browser, server.url, pass, sections, shots)));
    return issues;
  } finally {
    await browser.close();
    server.child.kill();
  }
}