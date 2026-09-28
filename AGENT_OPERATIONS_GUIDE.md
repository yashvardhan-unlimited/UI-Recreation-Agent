# Local UI Agent: Simple Operations Guide

Local UI Agent is meant to feel like a normal coding agent. Most users should set it up once, run the doctor once, and then describe the work they want.

You do **not** need to run the repository test suite, inspect model endpoints manually, or edit JSON configuration for ordinary use. Those are maintainer and troubleshooting tasks.

## The short version

One-time setup:

```powershell
cd D:\PS2
npm install --ignore-scripts
npx playwright install chromium
Copy-Item .env.example .env
notepad .env
npm run build
npm link
ui-agent config set provider auto
ui-agent config set interaction balanced
ui-agent doctor
```

Put your Groq key in `.env`:

```dotenv
GROQ_API_KEY=gsk_your_key_here
```

Daily use from a project directory:

```powershell
ui-agent improve --project . --brief "Improve this interface and fix responsive and accessibility problems"
```

That is the normal workflow. `provider auto` tries the configured local endpoint first and automatically uses Groq if local discovery or inference is unavailable.

## Everyday commands

### Work on the current project

```powershell
ui-agent improve --project . --brief "Add a polished settings page and verify it on mobile"
```

### Create a new project

Run this from the directory that should contain the new project:

```powershell
ui-agent create --out .\new-site --brief "Create a responsive robotics landing page for engineering leaders"
```

The output directory must be empty.

### Audit without requesting a redesign

```powershell
ui-agent audit --project .
```

Add a focus when useful:

```powershell
ui-agent audit --project . --brief "Focus on mobile overflow, keyboard navigation, form errors, and performance"
```

### Resume a paused run

```powershell
ui-agent status
ui-agent resume <run-id> --interactive
```

### Recreate from screenshots you own

```powershell
ui-agent recreate `
  --project . `
  --reference .\references\desktop.png .\references\mobile.png `
  --brief "Recreate this responsive visual system using my content"
```

### Recreate from an authorized public URL

```powershell
ui-agent recreate `
  --project . `
  --url https://authorized.example `
  --authorized `
  --brief "Transfer the visible design system using replacement content and licensed assets"
```

Only use `--authorized` when you have permission to analyze and recreate the referenced site.

## Groq and local models

The default provider mode is `auto`:

```text
Try local /api/tags and /v1/models
            |
            +-- both work --> use the exact local model
            |
            +-- missing/error --> load GROQ_API_KEY and use Groq
```

The hosted fallback is restricted to Groq's official OpenAI-compatible endpoint:

```text
https://api.groq.com/openai/v1
```

Default Groq models:

- Coding, structured output, and tools: `openai/gpt-oss-20b`
- Screenshot and image understanding: `qwen/qwen3.8-27b`

The agent loads the nearest `.env`, starting in the current project and walking upward only as far as the nearest Git repository boundary. For example, a command run from `D:\PS2\test_folder_1` can use `D:\PS2\.env` without copying the key into the child project.

Choose provider behavior explicitly when needed:

```powershell
ui-agent config set provider auto   # local first, Groq fallback
ui-agent config set provider groq   # always use Groq
ui-agent config set provider local  # never send model data remotely
```

Change the hosted model IDs only when Groq currently returns those exact IDs:

```powershell
ui-agent config set groq-model openai/gpt-oss-20b
ui-agent config set groq-visual-model qwen/qwen3.8-27b
ui-agent doctor
```

API-key values are never stored in `.ui-agent/config.json`, doctor reports, or run manifests. Generated build and preview processes do not inherit `GROQ_API_KEY`.

When Groq is active, prompts, tool context, and attached screenshots are sent to Groq. Use `provider local` for work that must remain on-device.

## When to run the doctor

Run:

```powershell
ui-agent doctor
```

Use `--json` only when you need machine-readable diagnostics:

```powershell
ui-agent doctor --json
```

You normally run the doctor:

- After initial installation.
- After changing provider, endpoint, API key, or model IDs.
- When a workflow reports missing model capability.
- After updating the agent or Playwright browser.

You do not need to run it before every task. A successful report is stored in `.ui-agent/doctor/latest.json` and reused while it remains current and matches the provider, endpoint, and model.

The command is `ui-agent doctor`, not `ui-agent-doctor`.

## Interaction level

For a Codex- or Claude Code-like experience, use `balanced`:

```powershell
ui-agent config set interaction balanced
```

Available modes:

- `balanced`: recommended for normal use; asks about material uncertainty and important design choices.
- `autonomous`: makes routine implementation decisions with fewer pauses.
- `high`: asks for approval at more design and workflow checkpoints.

Set autonomous mode when the task and permissions are already clear:

```powershell
ui-agent config set interaction autonomous
```

Even autonomous mode still stops for destructive actions, authorization issues, conflicts, and genuinely ambiguous decisions.

## One-time installation versus daily operation

These are setup or maintainer commands, not daily commands:

```powershell
npm install --ignore-scripts
npx playwright install chromium
npm run build
npm link
```

Repository contributors can validate all deterministic code gates with:

```powershell
npm run check
npm run test:e2e
```

Ordinary operators do not need to run these tests before asking the agent to work.

## Common problems

### `Groq fallback requires GROQ_API_KEY`

The agent could not use the local endpoint and did not find a key. Put the key in the nearest applicable `.env`:

```dotenv
GROQ_API_KEY=gsk_your_key_here
```

Then rerun:

```powershell
ui-agent doctor
```

Do not put a real key in `.env.example`; that file is safe to commit and must contain only a placeholder.

### Local inference fails even though Groq is configured

Confirm provider mode:

```powershell
ui-agent config show --json
ui-agent config set provider auto
ui-agent doctor
```

In `auto` mode, an unreachable local discovery endpoint, an HTTP error from local discovery, or an error from local `/v1/models` causes Groq fallback. In `local` mode, fallback is intentionally disabled.

### Browser executable is missing

```powershell
npx playwright install chromium
ui-agent doctor
```

### The run pauses or says `pending_input`

This is usually an approval or clarification, not a crash:

```powershell
ui-agent status
ui-agent resume <run-id> --interactive
```

Use `balanced` or `autonomous` if `high` mode pauses more often than you want.

### The target directory is not empty

Use `improve` for an existing project:

```powershell
ui-agent improve --project . --brief "Describe the change"
```

Use `create` only with a new or empty output directory.

### Model or rate-limit error

Groq rate limits are retried using the provider's `Retry-After` response. If the limit persists, wait briefly and rerun the command. If a configured model ID has been removed, select an exact ID currently returned by Groq and rerun the doctor.

### Windows reports `spawn EPERM`

Close processes that may be locking Node or Chromium, confirm endpoint protection is not blocking child processes, and try:

```powershell
npm run build
ui-agent doctor
```

If only the runtime or browser check fails while all model checks pass, the Groq fallback is working; resolve the local process-launch restriction separately.

## Status and files

Useful commands:

```powershell
ui-agent status
ui-agent status <run-id>
ui-agent status <run-id> --json
```

Run state and evidence are stored under:

```text
.ui-agent/runs/<run-id>/
```

Doctor evidence is stored under:

```text
.ui-agent/doctor/<timestamp>/
.ui-agent/doctor/latest.json
```

Do not manually edit an active run manifest. Resume the run through the CLI so the Pi session, decisions, approvals, defects, and evidence remain consistent.

## Safety boundaries worth knowing

- Local model endpoints must remain loopback-only.
- Groq credentials can only be sent to the pinned official Groq endpoint.
- `.env`, Git internals, SSH keys, and common credential files are protected from model file tools.
- Preview child processes receive a scrubbed environment.
- URL recreation requires explicit `--authorized` confirmation.
- External imagery requires acceptable licensing and provenance.
- Agent checkpoints do not replace your own Git commits or backups.

For configuration details, see [`docs/configuration.md`](docs/configuration.md). For architecture and implementation details, see [`PROJECT_IN_DEPTH.md`](PROJECT_IN_DEPTH.md).
