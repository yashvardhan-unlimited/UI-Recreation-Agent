# UI Agent

The UI Agent is the website-building part of our pi-based coding agent. It turns a plain-language request, a reference link or a screenshot into an animated, responsive website (Vite + React + TypeScript + Tailwind + Motion). It checks its own work in a real browser, fixes what is broken, and runs entirely on our self-hosted open models.

It plugs into [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) as one tool, `ui`, plus a `/ui` command. You talk to pi as usual; when you ask for a website, pi hands the request to the UI Agent.

- How to install and use it day to day: **[AGENT_OPERATIONS_GUIDE.md](AGENT_OPERATIONS_GUIDE.md)**
- How it is designed, and the rules the code follows: **[ARCHITECTURE.md](ARCHITECTURE.md)** (source of truth) and [CLAUDE.md](CLAUDE.md)

## Quick start (Windows)

One-time setup:

```powershell
cd D:\PS2
npm install
cd kit; npm install; cd ..          # every generated site links to this install
npx playwright install chromium     # used for screenshots and browser checks
npm link                            # installs the `uagent` command (already done on this machine)
```

`npm link` puts `uagent` next to npm's other global commands (in `%APPDATA%\npm`, which is already on PATH), so it works in every Command Prompt and PowerShell window, including ones that were already open.

Start it from the folder where the website should be created:

```bat
mkdir D:\sites\crumb
cd /d D:\sites\crumb
uagent
```

`uagent` opens pi with the UI Agent and the models on `http://127.0.0.1:18080` already set (see [Roles and models](#roles-and-models)); to change one, set the matching variable from [Configuration](#configuration) before running it.

Then ask, for example:

```text
Make a one-page website for my bakery, Crumb & Co. We're open Tuesday to Sunday and known for sourdough.
/ui make a site for a 12-room harbour hotel in St Ives
Recreate the design of https://example.com for my bakery, with my own copy
```

The tool streams progress (`✓ build Hero (round 0)`, `✓ critic Hero (round 0) — score 8`, …) and ends with a short report:

```text
Preview: http://127.0.0.1:63936/
- Hero: pass (8/10)
- Menu: fixed (7/10)
- Visit: excluded — Runtime error at 390px: …
9 model calls, 48210 tokens, 412s. Details in .ui/.
```

The preview URL stays live while pi is open. The finished site is in `site/` inside your folder.

## How it works

```text
request ──▶ intake ──▶ build flow  ─┐
            (rules;    clone flow ──┤
             model only            ▼
             for an       director: direction card, DESIGN.md, colors/fonts, 4–7 sections
             existing     assemble: tokens.css + Google Fonts check
             site)        builders: every section written in parallel (one file each)
                                    ▼
                          loop, up to UI_ROUNDS fix rounds:
                            gates  ─ lint rules, TypeScript, Vite build, 3D-chunk check
                            browser audit ─ 390 px, 1440 px, reduced motion
                            critic ─ screenshots of sections that passed and changed
                            passing sections ──▶ snapshot ──▶ promoted to site/
                            failing sections ──▶ fixed, each with only its own issues
                          after the last round: never-passed sections are left out,
                          regressed ones roll back to their last passing version
```

- **Clone flow:** for a link, Playwright captures the page at 1440 px and 390 px. It measures fonts, colors, the size scale and radii, screenshots each section, records three scroll frames per section and the main button's hover state. For a screenshot, the analyst model marks the section bands and code crops them. The analyst describes each section, and the director recreates the structure and feel with **original** copy. The critic compares each section with its reference crop.
- **Nothing broken reaches `site/`:** a section that doesn't compile is left out of the page, and only sections that passed every check are copied to `site/`.
- **Files are the shared memory:** each model call gets only what it needs (one section spec, its own issues), never another section or the chat history.

### Roles and models

| Role | What it does | Model on the server | Why this one |
|---|---|---|---|
| intake | routes a request about an existing site (edit / style / motion / audit) | `qwen3-coder:30b` | routed all test requests correctly in ~1 s |
| director | plans the site: direction, DESIGN.md, colors, fonts, sections | `qwen3.8:27b` | the most specific, on-brief plans in trials |
| analyst | describes a reference site section by section | `qwen3.8:27b` | vision model |
| builder | writes one section as a React file | `qwen3-coder:30b` | all trial sections passed every gate, 3–5× faster than the alternatives |
| showpiece | the one 3D or pinned-scroll moment | `qwen3-coder:30b` | strongest coder that fits next to the others |
| critic | reviews screenshots, scores 0–10, lists concrete fixes | `qwen3.8:27b` | concrete reviews that cite Tailwind classes; `qwen3-vl:8b` timed out |
| pi's main model | talks to you and calls the `ui` tool | `qwen3.8:27b` | passes your request through unchanged |

Both models stay loaded together on the server (~66 GB), so nothing swaps between steps. Models we tried and did not pick: `nemotron-3.5-lightning:30b`, `gpt-oss:120b`, `qwen3-vl:8b`, `devstral-2:123b`, `qwen3:235b`. The guide explains why.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `UI_LLM_URL` | `uagent`: `http://127.0.0.1:18080/v1`; otherwise `http://localhost:8000/v1` | OpenAI-compatible server for all roles; also enables pi's `selfhosted` provider |
| `UI_LLM_URL_<ROLE>` | — | different server for one role (`INTAKE`, `DIRECTOR`, `ANALYST`, `BUILDER`, `SHOWPIECE`, `CRITIC`) |
| `UI_MODEL_<ROLE>` | `uagent`: the models in the table above | model id per role (required for the roles a flow uses) |
| `UI_LLM_KEY` | `local` | bearer token for the server |
| `UI_PARALLEL` | `3` | model calls at once |
| `UI_ROUNDS` | `3` | fix rounds before giving up on a section |
| `UI_PASS_SCORE` | `7` | critic score a section needs (and no high-severity issue) |
| `UI_JANK_MS` | `120` | worst allowed frame while scrolling |
| `UI_SECTION_LINES` | `150` | line budget per generated section |
| `UI_CHROME_PATH` | Playwright's Chromium | use another Chromium |
| `UI_FONTS_URL` | `https://fonts.googleapis.com` | Google Fonts or a mirror |

## Current status

Working and tested: building a new site from a request, recreating a design from a link or a screenshot, the quality gates and browser checks, the critic, promotion and rollback, the pi tool, the `/ui` command, the `selfhosted` provider and the live preview. The eval harness (`npm run eval`) runs 20 briefs headless and writes a CSV.

Not done yet:

- **Edit, style, motion and audit requests** on an existing site are routed correctly but answered with "this flow isn't available yet".
- **3D showpieces are incomplete.** A section the director plans as a 3D or pinned showpiece fails and is left out: the showpiece prompt and its 3D browser checks are still missing. Ordinary sections can still use scroll motion.
- One page per site; images are placeholders (`/demo/photo.svg`).
- A running request can't be cancelled; each model call is capped at 10 minutes.

The repository still contains the earlier prototype (`src/cli.ts`, `src/pi/`, `src/tools/`, `tests/`, `docs/` and the `ui-agent` command with its doctor and Groq fallback). The UI Agent doesn't use any of it; its removal is pending approval.

## Development

```powershell
npm run check     # typecheck + lint + tests
npm test          # tests only (~45 s)
npm run eval -- --out evals/out/my-run    # 20 briefs against the configured models
```

Tests use an in-process mock model server (`test/mock-llm.ts`), a real Chromium and the real pi CLI. Code changes follow [CLAUDE.md](CLAUDE.md): small functions, per-file line budgets from ARCHITECTURE.md §9, and model prompts only in `prompts/*.md`.
