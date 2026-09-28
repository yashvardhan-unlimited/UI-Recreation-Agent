# Local UI Agent

Local UI Agent is a reusable frontend coding harness built on the real `@earendil-works/pi-coding-agent` SDK. It uses one persistent Pi session to collaborate on requirements and design, edit a project through narrow typed tools, run the frontend, inspect it in Playwright, capture screenshots, review them with a verified visual model, repair defects, and resume from versioned run state. It prefers local inference and can automatically fall back to Groq when the local endpoint is unavailable.

It is a frontend-only agent. It may create typed mock adapters and fixtures, but it does not create production databases, authentication, payments, or backend services.

## Current validation status

The source, typecheck, lint, build, deterministic tests, and a real generated-project acceptance test pass. The acceptance test creates a lockfile, installs with scripts disabled, builds, runs the generated Playwright test, launches a production preview, inspects/interacts at desktop and mobile sizes, audits it, captures screenshots, and cleans up. The local endpoint was unavailable during the latest validation. Automatic Groq selection, authenticated model discovery, and secret isolation are covered by deterministic tests; a real Groq doctor/model-driven run still requires a valid `GROQ_API_KEY`. See [the validation report](docs/validation-report.md).

## Install

```powershell
cd D:\PS2
npm install --ignore-scripts
npx playwright install chromium
Copy-Item .env.example .env
# Edit .env and replace the placeholder with your GROQ_API_KEY.
npm run check
npm run build
npm link
```

`npm link` makes the `ui-agent` command available. Without linking, substitute `node dist/cli.js` for `ui-agent`.

Copy [ui-agent.config.example.json](ui-agent.config.example.json) to `.ui-agent/config.json` if you want explicit project-local settings. The checked-in example names `qwen3.8:27b` only because `/api/tags` actually returned that exact ID on this machine; the runtime still rediscovers and validates exact IDs.

## Required first command

```powershell
ui-agent doctor
```

With the default `model.provider=auto`, the doctor probes the local endpoint first and falls back to `https://api.groq.com/openai/v1` only when local inference is unavailable and `GROQ_API_KEY` is present. It separately reports backend selection, discovery, `/models`, plain text, structured JSON and recovery, direct tools, a Pi tool/result continuation with a safe file round trip, single-image understanding, two-image comparison, Node/npm/port allocation, and Chromium screenshot output. A create/recreate/resume run requires the relevant checks in `.ui-agent/doctor/latest.json` to be `PASS` for the same provider, endpoint, and exact model ID.

## Commands

```powershell
ui-agent doctor
ui-agent create --brief .\fixtures\briefs\robotics.md --out .\examples\generated\robotics
ui-agent improve --project .\my-app --brief "Improve hierarchy, responsive behavior, and accessibility"
ui-agent recreate --project .\my-app --reference .\desktop.png .\mobile.png --brief "Use my content; close visible match"
ui-agent recreate --project .\my-app --url https://authorized.example --authorized --brief "Transfer this visual system with replacement content"
ui-agent audit --project .\my-app
ui-agent status <run-id>
ui-agent resume <run-id>
ui-agent config set interaction high
ui-agent config set interaction balanced
ui-agent config set interaction autonomous
ui-agent config set provider auto
ui-agent config set model qwen3.8:27b
ui-agent config set visual-model qwen3.8:27b
ui-agent config set groq-model openai/gpt-oss-20b
ui-agent config set groq-visual-model qwen/qwen3.8-27b
```

`high` is the default. In a real terminal, create/improve/recreate open Pi's TUI and use native selectors, confirms, text input, editor, notifications, widgets, the `/ui-decisions` custom overlay, and an inline contact-sheet image selector. In a non-interactive host, grouped material questions and approvals are persisted as `pending_input` rather than guessed.

## Workflow

The bounded state machine is:

```text
UNDERSTAND → PLAN → IMPLEMENT → BUILD → RUN → EXERCISE → CAPTURE → REVIEW → REPAIR → VERIFY
```

Visual repairs always render again. Deterministic failures override a favorable visual opinion. Checkpoints are ranked by functional gates, blocker/high defects, design/reference quality, then accessibility and performance.

Run artifacts live under `.ui-agent/runs/<run-id>/` and include the immutable input, copied references, manifest, Pi JSONL session, checkpoints, logs, screenshots, diffs, visual evidence, defects, approvals, and provenance. Images and repetitive raw logs are stored as artifacts rather than injected repeatedly into model context.

## Documentation

- [Simple operations guide](AGENT_OPERATIONS_GUIDE.md)
- [Architecture and Mermaid diagrams](docs/architecture.md)
- [Configuration and workflows](docs/configuration.md)
- [Security and threat model](docs/security.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Selected versions and official API sources](docs/versions.md)
- [Validation report](docs/validation-report.md)

## Important limitations

- This machine has no Docker or Podman. Preview commands receive a scrubbed environment and project-scoped cwd with process-tree cleanup, but this is not a hostile multi-tenant sandbox.
- Reference URL browsing blocks private/reserved addresses, credentials, nonstandard ports, popups, downloads, non-GET requests, and cross-origin top-level navigation. It is intentionally conservative and may block complex authorized sites.
- Openverse is the implemented live image-search adapter. Wikimedia is represented in configuration for the adapter boundary but is not yet implemented as a separate search client.
- Lighthouse is supported programmatically, but results vary by machine; use repeated median runs for release budgets.
- Live model/Pi/vision acceptance requires either the loopback server at port 18080 or a valid `GROQ_API_KEY`, followed by a passing doctor.
- Groq fallback sends model prompts and attached screenshots to Groq. Use `model.provider=local` when content must remain on-device.
