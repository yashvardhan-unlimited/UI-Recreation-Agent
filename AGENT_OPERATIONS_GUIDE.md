# UI Agent: Operations Guide

This guide is for using the UI Agent day to day: setting it up, asking for websites, reading what it reports, and fixing common problems. For how it is designed, see [ARCHITECTURE.md](ARCHITECTURE.md); for a short overview, see [README.md](README.md).

## The short version

1. One-time: install the agent and its site kit, and the browser it uses for checks.
2. Once: make the `uagent` command available.
3. Type `uagent` in the folder where the site should live, and ask for what you want.

## 1. One-time setup

You need Node.js 22.19 or newer (`node -v`) and access to the model server at `http://127.0.0.1:18080`.

```powershell
cd D:\PS2
npm install
cd kit
npm install        # the site template; every generated site links to this install
cd ..
npx playwright install chromium
```

Check that the model server answers:

```powershell
Invoke-RestMethod http://127.0.0.1:18080/api/tags | Select-Object -ExpandProperty models | Select-Object name
```

You should see `qwen3.8:27b` and `qwen3-coder:30b` in the list. If you add or rename models on the server, see "Changing models" below.

## 2. Make the `uagent` command available

`uagent` starts pi with the UI Agent loaded and the models on `http://127.0.0.1:18080` already chosen (table below), so you don't have to set anything else. Install it once, from the agent's folder:

```bat
cd /d D:\PS2
npm link
```

This is already done on this machine. `npm link` puts `uagent` (and the older `ui-agent`) next to npm's other global commands in `%APPDATA%\npm`, which is on your PATH, so it works straight away in every Command Prompt, PowerShell and Windows Terminal window, including ones that were already open. Check:

```bat
where uagent
uagent --version
```

The first should print `C:\Users\<you>\AppData\Roaming\npm\uagent.cmd`, the second pi's version (for example `0.85.1`). The command runs `D:\PS2\bin\uagent.mjs`; edit that file to change its default models for everyone on this machine.
### Changing models

The launcher's choices are defaults. Any of these variables, set before you run `uagent`, takes precedence: `UI_LLM_URL`, `UI_MODEL_INTAKE`, `UI_MODEL_DIRECTOR`, `UI_MODEL_ANALYST`, `UI_MODEL_BUILDER`, `UI_MODEL_SHOWPIECE`, `UI_MODEL_CRITIC`. For example, to try another critic for one session:

```bat
set UI_MODEL_CRITIC=qwen3-vl:8b
uagent
```

(In PowerShell: `$env:UI_MODEL_CRITIC = "qwen3-vl:8b"`.) Use `setx` instead of `set` to keep a choice for all new windows. The other settings (`UI_PARALLEL`, `UI_ROUNDS`, …) are listed in the README's Configuration table.

### Which model does what, and why

| Role | Model | What it does |
|---|---|---|
| pi's main model | `qwen3.8:27b` | talks to you and hands website requests to the `ui` tool |
| intake | `qwen3-coder:30b` | decides what kind of change you want on an existing site |
| director | `qwen3.8:27b` | plans the site: direction, DESIGN.md, colors, fonts, sections |
| analyst | `qwen3.8:27b` | describes a reference site section by section (vision) |
| builder | `qwen3-coder:30b` | writes each section as one React file |
| showpiece | `qwen3-coder:30b` | the single 3D or pinned-scroll moment (not finished yet; see Limits) |
| critic | `qwen3.8:27b` | looks at desktop and mobile screenshots and scores each section (vision) |

These came from trials on the server using the agent's real code:

- **Director:** `qwen3.8:27b` produced the most specific plans with copy that fit the brief. `gpt-oss:120b`'s plans were valid but generic, and once its copy contradicted the brief. `nemotron-3.5-lightning:30b` failed both test briefs (it missed the contrast rule twice, then hit the 10-minute limit).
- **Builder:** all three tested models passed every check. `qwen3-coder:30b` took 12–49 s per section; `qwen3.8:27b` took 40–186 s and `gpt-oss:120b` 118–302 s.
- **Critic:** `qwen3.8:27b` gave concrete, class-level fixes. `qwen3-vl:8b` hit the 10-minute limit on its first review.
- **Main model:** `qwen3.8:27b` called the `ui` tool with your words unchanged. `qwen3-coder:30b` didn't call the tool; it tried to write the site itself, in a tool-call format the server doesn't recognise. `gpt-oss:120b` rewrote the request (adding its own colors and frameworks).
- **Too big:** `devstral-2:123b` (171 GB once loaded) and `qwen3:235b` don't fit on the server next to the other roles.

`qwen3.8:27b` and `qwen3-coder:30b` fit on the server together (~66 GB), so there are no model swaps between steps. If you host a new model, check pi sees it with `uagent --list-models selfhosted` and try it in one role at a time.

## 3. Use it

Open a terminal in the folder where the site should be created (a new, empty folder is best) and type `uagent`:

```bat
mkdir D:\sites\crumb
cd /d D:\sites\crumb
uagent
```

pi opens with the UI Agent loaded. Type your request at its prompt; quit pi with Ctrl+C twice (or `/quit`).

Ask in plain words. Mention what the site is for, what must be on it, and any style you want:

```text
Make a one-page website for my bakery, Crumb & Co. We're open Tuesday to Sunday,
known for 48-hour sourdough, and take cake orders four days in advance.
```

```text
/ui make a site for a 12-room harbour hotel in St Ives with prices and a booking form
```

`/ui <request>` asks pi's main model to pass your request to the `ui` tool unchanged. Plain messages work too, because the main model is told to use the `ui` tool for any website request.

To **recreate a design**, include the link or a screenshot path:

```text
Recreate the design of https://example.com for my bakery, using my own copy.
Recreate the design in D:\refs\landing.png for my hotel.
```

The agent recreates structure, rhythm, type scale, colors and motion, and writes original copy. Its prompts forbid reusing the reference's logos, brand names, product names or photos, and the director never sees the reference's text.

To **ask for a style**, say it in the request ("make it feel like a printed magazine", "dark and technical", "bold and colorful"); the director plans around it. (The three style presets in `presets/` are used by the eval harness; the `ui` tool doesn't pick them automatically yet.)

To **use your own photos**, put them (JPEG, PNG, WebP or AVIF; any size) in an `images` folder inside the project folder before asking for the site. The agent shrinks each to at most 1600 px wide, has the vision model describe it once, and the director places each photo where it fits. Any image slot without a fitting photo of yours gets a free stock photo from [Openverse](https://openverse.org) (CC0 or public domain only, so no credit line is needed), and the plain placeholder only if nothing is found or there is no internet. Photos are picked up on the next build request; edits to an existing site aren't available yet. iPhone HEIC files can't be read: export them as JPEG first.

### What happens while it works

On the model server, a five-section site took about 11 minutes in testing: about 2 minutes of planning, under a minute to write the sections, then 3–5 minutes per check-and-fix round. Sites whose sections pass in the first round finish sooner. You'll see progress lines like:

```text
… planning the site: direction, design tokens and sections (often 2–4 min)
✓ direct
… building 5 section(s), 3 at a time
✓ build Hero (round 0)
… checking: type-check, build, then the browser at 390 and 1440px (round 0)
✗ gates (round 0) — 1 issues, 5 mounted: Menu/runtime: <div class="w-[900px]"> sticks out 510px past the vi…
… critic reviewing 4 section(s) (round 0)
✓ critic Hero (round 0) — score 8
⏳ 1m 20s since the last update · the model is writing
```

Lines starting with `…` say what just started; `✓`/`✗` say what finished. The last line ticks every 5 seconds, so you can always tell it is alive:
- **"the model is writing"**: a model is producing output (the director often thinks for 2–4 minutes); just wait.
- **"no model output for 3m …: the model server is busy (another session?) or loading a model"**: your request is queued on the model server, usually behind another pi session using the same model. It carries on by itself when the server answers. To see what the server is doing, open `http://127.0.0.1:18080/api/ps`. Closing the other session helps now; letting Ollama keep both models loaded and answer several requests at once (`OLLAMA_MAX_LOADED_MODELS=2`, `OLLAMA_NUM_PARALLEL=3` on the server) fixes it for good.

1. The **director** commits to a direction, writes `DESIGN.md`, picks colors (checked for readable contrast) and Google Fonts (checked that they exist), and plans 4–7 sections.
2. **Builders** write all sections in parallel.
3. Every round, the **gates** check each section, a **browser** opens the page at phone (390 px) and desktop (1440 px) width and with reduced motion, and the **critic** reviews screenshots of sections that passed.
4. Sections that pass are copied into `site/` straight away. Sections that fail get one fix per round, each with only its own problems, for up to 3 rounds.

### The report

```text
Preview: http://127.0.0.1:63936/
- Hero: pass (8/10)
- Menu: fixed (7/10)
- Visit: excluded — Runtime error at 390px: …
9 model calls, 48210 tokens, 412s. Details in .ui/.
```

| Status | Meaning |
|---|---|
| `pass` | passed on the first try |
| `fixed` | passed after one or more fixes |
| `rolled_back` | passed once, a later change failed, so the last passing version is live |
| `excluded` | never passed; it is not on the page, and the reason is shown |

The score is the critic's (8+ means a top studio would ship it). The preview URL works while pi stays open. To view the site later, run it yourself:

```powershell
cd D:\sites\crumb\site
npm run dev
```

### What the checks look for

- **Code rules:** imports only React, Motion and the kit; colors only from the design tokens; images with `alt`, `width` and `height`; animation of position and opacity only (no width, height or margin animation); `min-h-svh` instead of `h-screen`; no filler words (unleash, elevate, seamless…); at most 150 lines per section.
- **Build:** TypeScript errors, the Vite build, and 3D code kept out of the first download.
- **Browser, at 390 px and 1440 px:** content sticking out past the screen edge, text that never becomes visible, layout shift, scroll jank, long main-thread tasks, runtime errors, slow first paint, and text hidden when reduced motion is on.
- **Critic:** hierarchy, typography, spacing, contrast, mobile layout, fidelity to the plan or reference, and generic "AI-looking" patterns.

## 4. Files it creates

Inside your project folder:

| Path | What it is |
|---|---|
| `site/` | the live website (Vite + React + TypeScript + Tailwind + Motion). Only passing sections are in it. |
| `DESIGN.md` | the design document the director wrote |
| `.ui/plan.json` | the plan: direction card, tokens, sections |
| `.ui/stage/` | the work area, including attempts that failed |
| `.ui/green/` | the last passing version of each section |
| `.ui/runs/<time>.jsonl` | one line per model call and gate round: model, tokens, time, issues found |
| `.ui/shots/<round>/<390 or 1440>/<Section>.png` | the screenshots the critic saw |
| `.ui/ref/` | the captured reference (clone only): facts, section crops, scroll frames, hover |
| `images/` | your photos (you create this folder; the agent only reads it) |
| `site/public/images/` | the photos the site uses: yours, resized, and the stock photos it downloaded |
| `.ui/images.json` | each photo's size and description, and the source page of every stock photo |

`site/node_modules` is a link to the agent's kit install, so a new site needs no download. To give a site its own copy (for example before moving it elsewhere), run `npm install` inside `site/`.

To start a site over, delete `site/`, `.ui/` and `DESIGN.md`. Running a new build request in the same folder replans the site and replaces the live sections as the new ones pass.

## 5. Evaluating models and prompts

The eval harness runs 20 varied briefs (portfolio, SaaS, restaurant, event, editorial and more; 5 ask for motion or 3D) headless against whatever models are configured:

```powershell
npm run eval -- --out evals/out/my-run
npm run eval -- --out evals/out/my-run --only restaurant-ramen,devtool-cli
```

It writes `results.csv` after every brief and prints a summary table with, per brief: first-round gate pass rate, rounds to green, mean critic score, slop findings, rollbacks, excluded sections, model calls, tokens in/out and wall time. Each brief's full output stays in its own folder. Running again with the same `--out` skips briefs that already finished, so an interrupted run resumes.

Reference recreation is evaluated too once you fill in the URLs in `evals/refs.json`; entries without a URL are skipped. Change prompts or models only when the eval numbers improve.

## 6. Troubleshooting

**"'uagent' is not recognized as an internal or external command"**: the command isn't installed on this machine yet. Run `npm link` in `D:\PS2` (step 2); `where uagent` should then print a path in `%APPDATA%\npm`. In PowerShell, if it says running scripts is disabled, use the same window type where `ui-agent` works, or run `uagent.cmd`. Typing `uagent` in the Start menu or Run box won't work; it's a terminal command.

**"Set UI_MODEL_DIRECTOR to the model id…"**: a role has no model set. Set the variable from step 2 in this terminal.

**"Unknown provider selfhosted", or a warning that `…/models` didn't answer**: pi lists the server's models once when it starts. If the server was unreachable then (or `UI_LLM_URL` wasn't set in this terminal), check the server with the `Invoke-RestMethod` line from step 1 and start pi again.

**"model '…' not found" (HTTP 404)**: the model id doesn't exist on the server. List the exact ids with `Invoke-RestMethod http://127.0.0.1:18080/api/tags` or `uagent --list-models selfhosted`.

**"… reply was invalid twice: …"**: the model's answer didn't match the required format twice in a row. Only that section (or step) fails; the reason is in the report and in `.ui/runs/`. If one model does this often, try another for that role.

**"The operation was aborted due to timeout"**: one model call took more than 10 minutes, usually because the server is overloaded or the model is too slow. Lower `UI_PARALLEL`, or use a faster model for that role.

**"The edit flow isn't available yet"**: changing an existing site (edit, style, motion, audit) isn't built yet. Start a new build in a new folder, or ask for the whole site again.

**A section is always `excluded`**: read the reason in the report. If the director planned it as a 3D or pinned **showpiece**, it fails until the showpiece builder is finished. Ask for the site again without 3D, or ask for scroll motion instead.

**The main model writes files itself instead of calling the UI Agent**: use `qwen3.8:27b` as pi's main model. To allow only the UI Agent, start it with `uagent --no-builtin-tools`.

**Fonts look different from the plan**: the agent couldn't reach Google Fonts, so it used system fonts and logged a `fonts` line. Allow internet access, or set `UI_FONTS_URL` to a mirror.

**"Executable doesn't exist" / browser missing**: run `npx playwright install chromium`, or set `UI_CHROME_PATH` to an installed Chromium.

**The preview URL stopped working**: it closes with pi. Run `npm run dev` inside `site/`.

**`pi -p "…"` hangs in a script**: pi waits for piped input. Close stdin, for example `$null | & D:\PS2\node_modules\.bin\pi.cmd -p "…"`.

## 7. Limits to know about

- New sites and recreations work. Edits, restyles, motion changes and audits of an existing site are not available yet.
- 3D showpieces are unfinished: a section planned as a showpiece is left out.
- One page per site. Images come from your `images/` folder, then Openverse stock, then the placeholder (`/demo/photo.svg`); swapping photos on an existing site needs a new build until the edit flow exists.
- A request can't be cancelled once started; each model call is limited to 10 minutes.
- Generated copy is the director's; review it before publishing.
- The older prototype (`ui-agent` command, `ui-agent doctor`, Groq fallback, `.ui-agent/` folder) is still in the repository but no longer used by the UI Agent. Its removal is pending approval.
