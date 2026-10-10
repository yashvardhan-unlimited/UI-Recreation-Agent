# UI Agent — Architecture

The UI Agent is the part of our pi-based coding agent that designs, builds, audits and fixes websites. It runs on **self-hosted open models**. This file is the source of truth; if code and this file disagree, the code is wrong or this file needs an explicit update.

---

## 1. Goals and non-goals

**Goals**
1. Prompt → polished, animated website that does not look AI-generated.
2. Recreate the *design* of a site from a **link or screenshot**.
3. **Self-audit**: screenshot and measure our own site, find broken UI, fix it.
4. **Smooth UX**: no jank, no layout shift, no overflow, works with reduced motion, on mobile and desktop.
5. **Motion and 3D on request**: scroll stories, interactive elements, a real 3D scene, without hurting performance.
6. **Lean codebase**: the agent itself stays ~1,300 lines of TypeScript (excluding the site kit and tests), written like a lazy senior dev.
7. Works with weaker open models: small contexts, strict output formats, no long tool-calling loops.

**Non-goals (for now)**
- Backends, auth, databases, CMS. The UI Agent produces front-end sites; other agents in our system own back-end work.
- Pixel-perfect cloning or copying brand assets. We recreate layout, rhythm, type scale, palette mood and motion — never logos, brand names, product names, photos or copy.
- Arbitrary frameworks. One stack (§8), on purpose.

---

## 2. Principles

1. **Code orchestrates, models do one job each.** Ordering, parallelism, retries, rollback and verification are plain TypeScript. Every model call is: one input → one output with a strict schema. No agent decides "what to do next" except Intake, and Intake only classifies.
2. **Files are the shared memory.** Agents communicate through the project folder (`.ui/plan.json`, `DESIGN.md`, section files, screenshots, issues). No agent receives another agent's chat history.
3. **Shrink the space of possible mistakes.** Fixed stack + design tokens + a vetted motion/3D kit. A builder that can only use tested primitives and token colors cannot produce janky animation or off-palette colors.
4. **Measure before you judge.** Deterministic checks (lint, types, build, browser measurements) run first and are free. The vision critic only sees sections that already passed them.
5. **Never regress, never show broken.** Every section has a last-known-good snapshot. The user's preview only ever shows promoted (green) sections.
6. **Least code that works** (ponytail ladder) — for the agent's own codebase *and* for the code it generates.

---

## 3. System context

```
 user ──▶ main pi agent (router, any model)
              │  one tool: ui({ request, ref?, dir? })   +   /ui command
              ▼
        ┌──────────── UI Agent (this project) ────────────┐
        │ Intake → flows → loop → promote → report         │
        │ state on disk: site/ (live) + .ui/ (stage, plan) │
        └──────────────────────────────────────────────────┘
              │ calls
              ▼
   self-hosted model servers (OpenAI-compatible)   Chromium (Playwright)
```

- The main agent sees **one tool** (`ui`) instead of many. Fewer tool schemas = fewer tokens and fewer wrong tool choices for weak main models. Intake inside the UI Agent does the routing.
- The tool streams progress lines and returns a short report (§7.6), never transcripts.
- Other agents on the team only depend on this tool contract.

---

## 4. The flow

### 4.1 Overview

```
                 ┌──────────┐
 request ───────▶│  INTAKE  │  small model: classify intent + target sections
                 └────┬─────┘
      ┌───────────────┼──────────────────────┬──────────────────┬─────────────┐
   build           clone                   edit              style         audit
      │               │                      │                  │             │
      │        ┌──────▼──────┐               │                  │             │
      │        │ REFERENCE   │ Playwright +  │                  │             │
      │        │ ANALYST     │ vision model  │                  │             │
      │        └──────┬──────┘               │                  │             │
      ▼               ▼                      │                  ▼             │
 ┌─────────────────────────┐                 │         ┌────────────────┐     │
 │ ART DIRECTOR (vision)   │                 │         │ DIRECTOR,      │     │
 │ DESIGN.md, tokens, plan │                 │         │ retoken mode   │     │
 └────────────┬────────────┘                 │         └───────┬────────┘     │
              ▼                              ▼                 │              │
 ┌──────────────────────────────────────────────────┐          │              │
 │ BUILDERS ×N (coder, parallel) + SHOWPIECE (3D)    │◀─┐       │              │
 └────────────┬─────────────────────────────────────┘  │       │              │
              ▼                                        │       │              │
 ┌──────────────────────────────┐                      │       │              │
 │ ASSEMBLE (code): tokens,     │◀─────────────────────┼───────┘              │
 │ fonts, registry of sections  │                      │                      │
 │ that compile                 │                      │ issues               │
 └────────────┬─────────────────┘                      │ (≤3 rounds)          │
              ▼                                        │                      │
 ┌──────────────────────────────┐                      │                      │
 │ GATES (code, no LLM)         │◀─────────────────────┼──────────────────────┘
 │ lint · types · build ·       │──── fail ────────────┤
 │ browser audit · perf         │                      │
 └────────────┬─────────────────┘                      │
              ▼ pass                                   │
 ┌──────────────────────────────┐                      │
 │ CRITIC (vision)              │──── fail ────────────┘
 │ screenshots → score, slop,   │
 │ concrete fixes               │
 └────────────┬─────────────────┘
              ▼ pass / out of rounds
 ┌──────────────────────────────┐
 │ PROMOTE or ROLL BACK (code)  │──▶ live preview  ──▶ report to main agent
 └──────────────────────────────┘
```

### 4.2 Step by step

| # | Step | Who | Reads | Writes |
|---|---|---|---|---|
| 1 | Intake | small model | user request, list of section ids + headings | `Intent` (§7.1) |
| 2 | Reference capture (clone only) | Playwright | URL or image | `.ui/ref/facts.json`, section crops, motion frames |
| 3 | Reference analysis (clone only) | vision model | facts + crops + frames | per-section descriptions inside the plan |
| 4 | Direction + plan | vision model (director) | brief, preset, reference analysis | `DESIGN.md`, `.ui/plan.json` (§7.2) |
| 5 | Build | coder model ×N in parallel | `DESIGN.md`, kit API, one `SectionSpec` | `stage/src/sections/<Id>.tsx` |
| 6 | Showpiece (if planned) | strongest coder model | `DESIGN.md`, 3D/scroll kit API, showpiece spec | one lazy-loaded section |
| 7 | Assemble | code | plan tokens, section files | `tokens.css`, fonts, `sections/index.ts` (only sections that compile) |
| 8 | Gates | code + Chromium | stage build | `Issue[]` per section, screenshots |
| 9 | Critic | vision model | 2–3 images per section, spec, DESIGN.md | `Verdict` (§7.4) |
| 10 | Fix | builder in fix mode | current file + its issues only | updated section file |
| 11 | Loop | code | issues | back to 7 for failing sections, max `UI_ROUNDS` (default 3) |
| 12 | Promote / roll back | code | green set, snapshots | copies green sections + tokens into `site/`; restores last-good for the rest |
| 13 | Report | code | everything | `Report` (§7.6) to the main agent |

### 4.3 The six flows

| Intent | Entry point | What runs | Model calls (6-section site) |
|---|---|---|---|
| **build** — "make a site for…" | 4 | director → builders → loop | ~1 + 6 + fixes + ~6 critic |
| **clone** — link or screenshot | 2 | capture → analysis → director → builders → loop; critic also gets the reference crop | same + 1 analysis |
| **edit** — "make the pricing section darker", user clicks an element in the preview | 10 | builder (fix mode) on the targeted sections → loop on those only | 1–2 + 1 critic each |
| **style** — "warmer colors", "use a serif" | 4 (retoken mode) | director rewrites tokens/`DESIGN.md` only → assemble → gates + critic on all sections; builders only for sections that now fail | 1 + critic calls |
| **motion** — "add a 3D product view", "make the story scroll" | 4 (section update) | director updates the targeted `SectionSpec` (motion tier, showpiece) → builder/showpiece → loop | 1 + 1–2 + critic |
| **audit** — "check my site" | 8 | gates + critic, no fixes; then offer to fix. Also works on any external URL (runtime checks + critic only, report only) | critic calls |

Clicking in the preview: every section is wrapped in `[data-section="<Id>"]`, so a click maps to a section id without any model call.

### 4.4 The loop (the heart of "doesn't break")

```
round = 0
loop:
  assemble(stage)                      # registry mounts only sections that compile
  issues = gates(stage)                # lint, types, build, browser audit, perf
  judged = critic(sections that passed gates AND changed since last pass)
  green  = sections with no issues → snapshot to .ui/green/, promote to site/
  bad    = sections with issues
  if no bad or round == UI_ROUNDS: break
  builders fix bad sections in parallel, each with only its own issues
  round++
for each still-bad section: restore last green snapshot (or leave it excluded if it never passed)
report
```

Properties:
- The page always builds: a section that doesn't compile is excluded from the registry, not allowed to break the bundle.
- The preview never shows a regression: only green sections are promoted to `site/`.
- Passed sections are not re-judged: saves vision tokens every round.
- A model failure (timeout, bad output after one retry) fails that **section**, never the run.

---

## 5. Agents

All prompts live in `prompts/*.md`. Code never contains prose aimed at a model.

### 5.1 Intake — small fast model
- **In:** user message, attachments (URLs, image paths), `plan.json` section ids with their headings.
- **Out:** `Intent` JSON (§7.1). Must choose exactly one `kind`. For edit/motion it lists target section ids; if it cannot map the request, `targets: []` and the flow asks the user which section.
- Rule-based shortcuts first: a URL or image attachment + no existing site → `clone`; a preview click → `edit` with that id. Only ambiguous requests hit the model.

### 5.2 Reference analyst — Playwright + vision model
- **Capture (code):** open the URL at 1440 px, scroll like a user (so lazy content and entrance animations fire), then:
  - **Measure** from computed styles: top fonts, text and background colors, font-size scale, radii, headings with size/weight, section boxes.
  - **Screenshot** the fold plus **one image per section** (never one compressed full-page board).
  - **Motion frames**: for each section, 3 screenshots at scroll offsets entering the viewport, and hover state of the primary CTA. This is how a vision model "sees" motion.
  - Also capture at 390 px for mobile layout.
- **Screenshot-only input:** the vision model returns section bands (y-ranges) for the image; code crops them. Facts are estimated (no computed styles), which the analyst marks as such.
- **Analysis (vision model):** for each section, a short structured description: layout, hierarchy, type sizes, spacing feel, motion seen, signature components. Measured facts beat guesses; the prompt says so.
- **Ethics rule (in prompt and critic):** recreate structure and feel; write original copy; no logos, brand names, product names or photos.

### 5.3 Art director — vision model
- **In:** brief; optional preset `DESIGN.md` (§10); optional reference analysis; motion kit API; showpiece kit API.
- **Out:** `DESIGN.md` (≤50 lines, compact Stitch-style sections) + `Plan` (§7.2).
- Must commit to a **direction card** before planning sections (anti-slop, from taste-skill): theme, type pairing, hero archetype, section rhythm, 3–4 signature components, motion energy. Stored in the plan; the critic checks the site against it.
- Allocates motion by tier (§6.3): at most **one showpiece** per page, scroll-linked motion at most every other section, hero gets the strongest moment.
- **Retoken mode** (style flow): outputs only `tokens` + a `DESIGN.md` patch.

### 5.4 Section builder — coder model, N in parallel
- **In (prompt order matters for prefix caching, §11):** system prompt → `DESIGN.md` → kit API → (fix mode: current file + issues) → `SectionSpec`.
- **Out:** exactly one ```tsx block: one file, default-export component, imports only `react`, `motion/react`, `../kit/*`.
- Follows the ponytail ladder: skip → kit primitive → HTML/CSS → minimal custom code. Never cuts accessibility, responsiveness or semantics.
- Section line budget (default 150). Exceeding it is a lint issue.

### 5.5 Showpiece builder — strongest coder model
- For tier-4 moments: 3D scenes (react-three-fiber via the kit's `Scene3D`) and pinned scroll stories (`PinnedScroll`).
- Same contract as the builder plus the showpiece rules in §6.4. Output is a section that lazy-loads its heavy part behind a static poster.

### 5.6 Critic — vision model
- **In:** desktop crop, mobile crop, (reference crop if cloning), `SectionSpec`, `DESIGN.md`, direction card.
- **Out:** `Verdict` (§7.4): score 0–10, slop findings, ≤5 issues each with a concrete code-level fix ("h1 to text-5xl on mobile; it wraps to 5 lines"), never "improve X".
- Judges only what eyes judge: hierarchy, typography, spacing rhythm, contrast, mobile layout, fidelity to spec/reference, slop. Everything measurable is already done by gates.
- Pass = score ≥ `UI_PASS_SCORE` (default 7) and no high-severity issue.

---

## 6. Quality system

Five layers. Each catches what the previous one missed.

### 6.1 Constrain
- One stack (§8), tokens as the only source of colors/fonts/radii, kit primitives for motion and 3D.
- Builders may import only `react`, `motion/react`, `../kit/*`.

### 6.2 Isolate
- One section = one file = one builder.
- Each section mounts inside `[data-section]` + an error boundary that renders nothing and logs `[section <Id>]` on crash.
- Registry mounts only sections that compile.
- Showpieces are lazy-loaded with a poster fallback.
- Two workspaces: agents work in `.ui/stage/`; the user previews `site/`, which only receives green sections.

### 6.3 Verify (deterministic gates — no LLM)

**Static (regex over the section file, milliseconds):**
| Rule | Why |
|---|---|
| imports only `react`, `motion/react`, `../kit/*` | no surprise deps, no `framer-motion` |
| no animating `width/height/top/left/margin/padding` | layout animation = jank |
| no raw hex/rgb, no arbitrary color values | tokens only |
| `<img>` has `alt`, `width`, `height` | a11y, no layout shift |
| no `h-screen` (use `min-h-svh`) | mobile browser bars |
| slop patterns: purple/indigo gradient utilities, banned copy words (unleash, elevate, revolutionize, seamless, next-gen), "Acme"/"Lorem" | cheap anti-slop |
| file ≤ line budget | lean output |

**Type check:** `tsc --noEmit`, errors grouped per section file.

**Build:** `vite build` of stage. Also check the build manifest: three.js / R3F must not be in the entry chunk (showpieces must be lazy).

**Browser audit** (production build via `vite preview`, Chromium, at 390 and 1440 px), per section:
| Check | How | Fail threshold (default) |
|---|---|---|
| horizontal overflow | element right edge > viewport, not clipped by a parent inside the section | any |
| invisible text | h1–h3/p/a/button with effective opacity < 0.05 after scrolling through | any |
| layout shift | `layout-shift` PerformanceObserver, attributed to section | CLS > 0.05 per section |
| scroll jank | frame-by-frame scripted scroll, worst frame while section is centered | > `UI_JANK_MS` (120 headless; tune per machine) |
| long tasks | `longtask` observer during load + scroll | any > 200 ms |
| runtime errors | console errors / page errors, attributed via `[section <Id>]` | any |
| reduced motion | repeat with `prefers-reduced-motion: reduce`; all text visible | any hidden |
| page LCP (lab) | `largest-contentful-paint` | > 2.5 s desktop |

Every gate message tells the builder **how** to fix it, not just what failed.

### 6.4 Motion and 3D rules

**Motion tiers** (director allocates, kit implements):
| Tier | Kit primitives | Budget |
|---|---|---|
| T1 entrance | `Reveal`, `Stagger`/`Item`, `TextReveal`, `ImageReveal` | any section |
| T2 scroll-linked | `Parallax`, `ZoomOnScroll`, `PinnedScroll` | at most every other section |
| T3 interactive | `Magnetic`, `Tilt`, `Marquee`, `Counter` | sparingly, purposeful |
| T4 showpiece | `Scene3D`, long `PinnedScroll` stories | max 1 per page |

Kit guarantees: animate only transform/opacity; fire once on enter; `MotionConfig reducedMotion="user"` at the root; scroll-linked and pointer effects disable themselves under reduced motion; no infinite animation except `Marquee` (pauses on hover and reduced motion).

**3D (`Scene3D`) guarantees:**
- Lazy `import()` behind `Suspense` with a static poster image of the same aspect ratio (no layout shift).
- DPR capped at 1.5; render loop pauses when offscreen; `frameloop="demand"` unless the scene animates.
- Reduced motion → poster only. Low-power/mobile → poster or reduced quality.
- No real-time shadows or post-processing by default. Prefer drei primitives and simple materials over loaded models; if a model is used, it must be a small `.glb`.
- Must stay out of the entry chunk (gate checks the manifest).

### 6.5 Judge (critic) and anti-slop

The critic's slop checklist (also in the director's "don't" list):
- generic SaaS template layout; same left-text/right-image block repeated
- cards inside cards; giant rounded wrapper around everything
- filler pills, fake stats, fake logos, pseudo-technical labels
- purple-blue AI gradients, floating blobs, glassmorphism stacks
- centered everything; no focal point; hero headline > 3 lines
- copy that could describe any product
- motion everywhere with no hierarchy

### 6.6 Recover
- Snapshot each section when it first passes (`.ui/green/<Id>.tsx`).
- After the last round, still-failing sections are restored from their snapshot. If one never passed, it stays excluded and the report says why.
- Edits get the same guarantee: an edit that never passes is rejected and the previous version stays live.

---

## 7. Contracts

These shapes are the real architecture. Agents can be swapped; contracts change only deliberately. Validate every model output against its schema.

### 7.1 Intent
```ts
type Intent = {
  kind: "build" | "clone" | "edit" | "style" | "motion" | "audit";
  targets: string[];          // section ids; [] = whole site (or unknown → ask)
  instruction: string;        // the user's request, cleaned up
  ref?: string;               // URL or image path (clone, or "match this" edits)
};
```

### 7.2 Plan
```ts
type Plan = {
  name: string;
  direction: {
    theme: string; typePairing: string; hero: string; rhythm: string;
    signature: string[];                    // 3–4 signature components
    motionEnergy: "calm" | "lively" | "bold";
  };
  tokens: {
    colors: { bg: string; fg: string; muted: string; surface: string; accent: string; line: string };
    fonts: { display: string; body: string };   // Google Fonts names, verified at assemble time
    radius: string;
  };
  pages: { path: string; sections: SectionSpec[] }[];   // single-page sites have one page "/"
};

type SectionSpec = {
  id: string;                 // PascalCase, unique site-wide
  goal: string;               // what the visitor should feel/do
  layout: { desktop: string; mobile: string };
  copy: string;               // final text, original
  motion: string[];           // kit primitive names only (validated)
  showpiece?: { kind: "3d" | "pinned"; idea: string; poster: string };
  ref?: number;               // index of reference crop to follow
};
```

### 7.3 Issue
```ts
type Issue = {
  section: string;            // or "_app" for page-level
  source: "lint" | "type" | "build" | "runtime" | "perf" | "critic";
  severity: "high" | "medium" | "low";
  fix: string;                // an instruction the builder can apply
};
```

### 7.4 Verdict
```ts
type Verdict = { score: number; slop: string[]; issues: Issue[] };
```

### 7.5 Run log (one line per event, `.ui/runs/<timestamp>.jsonl`)
```ts
type Event = { t: number; step: string; role?: string; model?: string; section?: string;
               round?: number; tokensIn?: number; tokensOut?: number; ms: number; ok: boolean; note?: string };
```

### 7.6 Report (returned to the main agent)
```ts
type Report = {
  previewUrl: string;
  sections: Record<string, { status: "pass" | "fixed" | "rolled_back" | "excluded"; score?: number; open: string[] }>;
  app: string[];              // page-level issues
  usage: { calls: number; tokensIn: number; tokensOut: number; seconds: number };
};
```

---

## 8. Generated site stack (the kit)

- Vite + React + TypeScript (strict) + Tailwind v4 (`@theme` tokens) + Motion (`motion/react`).
- 3D: `three`, `@react-three/fiber`, `@react-three/drei` — only inside `kit/Scene3D` and showpiece sections, always lazy.
- Tokens become Tailwind theme variables, so builders write `bg-bg text-fg text-muted bg-surface text-accent bg-accent border-line font-display font-body rounded-card`.
- Kit files (each export has a one-line `/** doc */`; the builder prompt's "kit API" is generated from these lines, so the kit is the single source of truth):
  - `kit/motion.tsx` — T1–T3 primitives + `PinnedScroll`
  - `kit/Scene3D.tsx` — lazy R3F wrapper with poster, DPR cap, offscreen pause, reduced-motion fallback
  - `kit/Safe.tsx` — per-section error boundary
- `main.tsx` mounts `sections` from the generated registry inside `MotionConfig reducedMotion="user"`.

---

## 9. Codebase layout and line budgets

The agent is functions and plain objects. No classes (except the React error boundary in the kit), no DI, no event bus, no agent framework.

```
ui-agent/
  CLAUDE.md               rules for Claude Code
  ARCHITECTURE.md         this file
  src/
    index.ts              pi extension: `ui` tool, /ui command, provider          ≤ 100
    intake.ts             rule shortcuts + intake model call → Intent              ≤ 60
    flows.ts              build / clone / edit / style / motion / audit             ≤ 150
    loop.ts               assemble → gates → critic → fix → promote/rollback       ≤ 130
    agents.ts             director, builder, showpiece, critic calls + validation  ≤ 150
    llm.ts                OpenAI-compatible client, schema output, 1 retry, usage  ≤ 70
    gates.ts              lint rules, tsc per section, build, manifest check       ≤ 120
    browser.ts            reference capture + audit (Playwright)                    ≤ 220
    store.ts              paths, plan load/save, stage/site sync, snapshots, log   ≤ 80
  prompts/                intake.md director.md analyst.md builder.md showpiece.md critic.md
  presets/                compact DESIGN.md presets (style starting points)
  kit/                    template copied into each new site (not counted in budget)
  test/                   mock model server + e2e (not counted)
  evals/                  briefs, reference URLs, runner (not counted)
```

Total budget for `src/`: **~1,100–1,300 lines**. If a change would break a file budget, delete or simplify something first.

---

## 10. Presets and the shared repos

| Source | How we use it |
|---|---|
| **ponytail** | Claude Code plugin while *we* build the agent; its ladder is also in `prompts/builder.md` so *generated* code is lean too. `/ponytail-audit` before each release. |
| **taste-skill / image-to-code** | Condensed into the director's direction card and the critic's slop checklist; "one readable image per section" rule for references. |
| **awesome-design-md** | `DESIGN.md` format; `presets/` holds compact presets the director can start from ("make it feel like Linear"). Presets are inputs to the director, never sent to builders directly. |
| **vercel web-design-guidelines** | Folded into lint rules (semantics, alt, focus) and the critic rubric (contrast, tap targets). |
| **playwright-cli** | Installed as a Claude Code skill so Claude Code can look at the UI while building the agent. The agent itself uses the Playwright library for measurements. |
| **motion-primitives** | Style and ideas for `kit/motion.tsx`. New primitives are added to the kit with a one-line doc and become available to builders automatically. |
| **graphify** | Optional, for **brownfield** mode (an existing codebase): query the component graph to derive `DESIGN.md` from existing Tailwind config/components instead of inventing one. |

---

## 11. Self-hosted model strategy

| Role | Model type | Notes |
|---|---|---|
| intake | small instruct model | JSON only, low temperature |
| director, analyst, critic | vision-language model | can share one server |
| builder | coder model | temperature ~0.2 |
| showpiece | strongest coder you can host | rare calls |

- **Structured output:** request JSON with a schema (vLLM/SGLang guided decoding, `response_format` json_schema). Fall back to "extract first `{…}` + validate + retry once" for servers without it.
- **Prefix caching:** put stable content first (system prompt → `DESIGN.md` → kit API) and the variable part (section spec, issues) last. Parallel builders then share a cached prefix on vLLM/SGLang.
- **One URL per role** (`UI_LLM_URL_<ROLE>`, `UI_MODEL_<ROLE>`) or a single router URL.
- **Concurrency** (`UI_PARALLEL`) is set to what the GPUs sustain, not to the number of sections.
- Strip `<think>…</think>` from reasoning models' output.
- Context per call stays under ~12k tokens; the system must work with 32k-context models.

---

## 12. Token economy

- A builder never sees other sections, the plan, or history.
- Fix calls send the current file + only its issues.
- Screenshots are per-section crops, downscaled to ≤1440 px wide.
- The critic only sees sections that passed gates and changed since they last passed.
- Style changes are token edits: zero builder calls unless a section then fails.
- Intake uses rule shortcuts before any model call.
- Reference facts are captured once and cached in `.ui/ref/`.
- The main agent gets a short report, not logs; details live in `.ui/`.

---

## 13. Observability and evals

- Every model call and gate result appends an `Event` (§7.5). Screenshots are kept per round under `.ui/shots/<round>/`.
- `evals/briefs.json` (~20 briefs) and `evals/refs.json` (~10 reference URLs) are run headless. Metrics per model/prompt version:
  - first-round gate pass rate
  - rounds to green
  - mean critic score and slop findings per site
  - rollbacks
  - tokens and wall time per site
- Change prompts or models only when evals improve.

---

## 14. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `UI_LLM_URL`, `UI_LLM_URL_<ROLE>` | `http://localhost:8000/v1` | server per role (INTAKE, DIRECTOR, ANALYST, BUILDER, SHOWPIECE, CRITIC) |
| `UI_MODEL_<ROLE>` | — | model id per role |
| `UI_LLM_KEY` | `local` | bearer token |
| `UI_PARALLEL` | 3 | concurrent model calls |
| `UI_ROUNDS` | 3 | fix rounds before rollback |
| `UI_PASS_SCORE` | 7 | critic pass score |
| `UI_JANK_MS` | 120 | worst allowed frame while scrolling |
| `UI_SECTION_LINES` | 150 | builder output line budget |
| `UI_CHROME_PATH` | Playwright Chromium | use an existing browser |

---

## 15. Open decisions

1. **Single page vs multi-page.** The plan supports `pages[]`; start with one page and add routing only when needed.
2. **Images.** Placeholder service vs user-provided assets vs a self-hosted image model. Builders always reserve fixed aspect-ratio slots so swapping images never shifts layout.
3. **Main agent model.** If it is also self-hosted, keep its tool surface to the single `ui` tool.
4. **Preview surface.** `vite dev` on `site/` with HMR is the default; promotion copies files, so the preview updates without ever seeing stage.
