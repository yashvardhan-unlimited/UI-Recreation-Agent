# Local UI Agent: Operations and Troubleshooting Guide

## 1. Purpose of this guide

This document teaches an operator how to install, configure, run, pause, resume, inspect, and troubleshoot Local UI Agent. It assumes Windows PowerShell and the repository at `D:\PS2`, but the CLI commands are otherwise portable.

The agent is deliberately collaborative. In its default `high` interaction mode, a run will pause for important requirements, information architecture, design direction, external images, close-match recreation, dependency changes, or repair escalation. A pause is normally expected behavior, not a crash.

## 2. Prerequisites

Required:

- Node.js 22.12 or newer. This machine was validated with Node 24.14.0.
- npm.
- A Playwright-supported Chromium browser.
- A local Ollama-compatible inference server bound to loopback.
- At least one model returned by the discovery endpoint.

Recommended:

- Git for inspecting existing projects and tracking your own work.
- A real interactive terminal for Pi's selectors, confirmations, editor, and image chooser.
- A VM or container if generated code or dependencies are not trusted.

The default endpoints are:

```text
Discovery: http://127.0.0.1:18080/api/tags
Inference: http://127.0.0.1:18080/v1
```

Do not bind the inference service publicly merely to make the agent connect. The harness intentionally accepts only loopback model endpoints.

## 3. Installation

Open PowerShell and run:

```powershell
cd D:\PS2
npm install --ignore-scripts
npx playwright install chromium
npm run check
npm run build
npm link
```

`npm link` exposes the `ui-agent` command. If you do not want a global npm link, use `node dist/cli.js` everywhere instead:

```powershell
node dist/cli.js doctor
```

Expected validation results for the repository itself:

- `npm run check`: typecheck, lint, and 31 deterministic tests pass.
- `npm run build`: TypeScript creates `dist/` successfully.
- `npm run test:e2e`: the generated-project browser test passes; model-dependent cases skip unless the endpoint is available and explicitly enabled.

## 4. Verify the model server before using the agent

Check both endpoints directly:

```powershell
Invoke-RestMethod http://127.0.0.1:18080/api/tags
Invoke-RestMethod http://127.0.0.1:18080/v1/models
```

The configured `codingModelId` and `visualModelId` must exactly match returned IDs. Do not guess tags or rely on a model family name.

Run the full capability doctor:

```powershell
ui-agent doctor
```

For machine-readable output:

```powershell
ui-agent doctor --json
```

The report is written under `.ui-agent/doctor/<timestamp>/doctor-report.json`, and `.ui-agent/doctor/latest.json` identifies the latest evidence.

### Reading doctor results

| Status | Meaning | Operator response |
| --- | --- | --- |
| `PASS` | The capability was exercised and produced the required evidence. | Continue. |
| `FAIL` | The check ran and failed. | Read its URL, model, safe error, and suggested correction. |
| `NOT CONFIGURED` | A prerequisite was missing, so the capability was not tested. | Restore/configure the prerequisite and rerun doctor. |

Required checks include discovery, inference endpoint, plain text, structured JSON/recovery, direct tool continuation, Pi tool/file continuation, single-image understanding, two-image comparison, runtime/package/port allocation, and browser screenshot output.

A model-dependent workflow will refuse to start when the matching fresh doctor evidence is absent. This is a safety feature.

## 5. Configuration

The default configuration path is:

```text
.ui-agent/config.json
```

Start with the checked-in example:

```powershell
New-Item -ItemType Directory -Force .ui-agent
Copy-Item ui-agent.config.example.json .ui-agent\config.json
```

Show the effective configuration:

```powershell
ui-agent config show
ui-agent config show --json
```

Use a different file when necessary:

```powershell
ui-agent --config .\configs\workstation.json doctor
```

### Supported CLI configuration changes

```powershell
ui-agent config set interaction high
ui-agent config set interaction balanced
ui-agent config set interaction autonomous
ui-agent config set model qwen3.8:27b
ui-agent config set visual-model qwen3.8:27b
```

The example model ID above is valid only when `/api/tags` returns that exact ID. After any endpoint or model change, rerun `ui-agent doctor`.

Other values—timeouts, budgets, viewports, image limits, Lighthouse thresholds, and provider domains—are edited in the JSON file and validated against `schemaVersion: 1`.

### Optional local authentication

Configure only the environment-variable name, never the secret value:

```json
{
  "model": {
    "auth": {
      "headerName": "Authorization",
      "environmentVariable": "LOCAL_MODEL_AUTH"
    }
  }
}
```

Then set `LOCAL_MODEL_AUTH` in the launching environment. The run manifest and logs do not serialize its value.

## 6. Interaction modes

### High — default

Use this for design-heavy or unfamiliar work. Expect approval checkpoints for the brief, page scope, visual direction, image query/download, close matching, dependency changes, broad replacements, and severe unresolved defects.

### Balanced

Use this when the brief and desired direction are already fairly clear. The agent still confirms the brief and direction and pauses for material uncertainty.

### Autonomous

Use this only when the brief is approved and you accept routine implementation choices. It still cannot silently perform destructive, external, legal, or genuinely ambiguous actions.

An individual run can override the configured mode:

```powershell
ui-agent create --interaction balanced --brief .\brief.md --out .\new-site
```

Add `--interactive` when the host does not automatically expose a TTY but you want the Pi TUI:

```powershell
ui-agent resume <run-id> --interactive
```

## 7. Create a new frontend

Prepare a brief as either a file or inline text. A useful brief names the audience, business goal, pages, content, interactions, brand constraints, references, responsive priorities, and success criteria.

```powershell
ui-agent create `
  --brief .\fixtures\briefs\robotics.md `
  --out .\examples\generated\robotics `
  --interactive
```

Inline text is also accepted:

```powershell
ui-agent create `
  --brief "Create a responsive robotics landing page for engineering leaders." `
  --out .\robotics-site
```

The output directory must be empty. If it is not empty, use `improve` or choose a new directory.

Expected sequence:

1. The agent restates the goal, audience, pages, content, interactions, technology, constraints, and success criteria.
2. It lists assumptions and missing information.
3. It asks a focused group of questions.
4. It proposes two or three distinct design directions.
5. You choose, combine, or revise a direction.
6. It presents an editable design specification for approval.
7. It scaffolds and implements only after required approvals.
8. It builds, starts, exercises, captures, reviews, repairs, and verifies.

## 8. Improve an existing project

```powershell
ui-agent improve `
  --project .\my-app `
  --brief "Improve hierarchy, mobile navigation, keyboard accessibility, and loading states." `
  --interactive
```

Before editing, the agent should:

- Detect framework, scripts, routes, styling system, dependencies, assets, and Git state.
- Build and run the existing project to establish a baseline.
- Persist project inspection and quality evidence.
- Create an agent-owned checkpoint.
- Request approval before changing framework/major dependencies or replacing substantial user-authored design.

Do not use `create` on a non-empty existing project.

## 9. Recreate from owned screenshots

```powershell
ui-agent recreate `
  --project .\my-app `
  --reference .\references\desktop.png .\references\mobile.png `
  --brief "These are my screenshots. Preserve my content and recreate the visible responsive system." `
  --interactive
```

During review, associate each image with its page, section, viewport, and state. Choose one intent:

- `inspired`: transfer the visual language while retaining the target identity and structure.
- `close-match`: closely reproduce the visible layout and styling with authorized content/assets; this requires explicit approval.

The agent separates observed facts from inferred responsive behavior and ambiguity. A screenshot cannot prove hidden interactions, backend behavior, exact fonts, or animation timing.

Recreation is blocked until a visual model has passed both doctor vision checks.

## 10. Recreate from an authorized URL

Only use this workflow when you are authorized to analyze and recreate the site:

```powershell
ui-agent recreate `
  --project .\my-app `
  --url https://authorized.example `
  --authorized `
  --brief "Transfer the visual system using my copy and licensed replacement assets." `
  --interactive
```

`--authorized` is mandatory. The reference browser will still block private networks, credentials, nonstandard ports, state-changing requests, destructive controls, downloads, popups, and unexpected navigation.

The agent extracts a design specification. It does not copy proprietary JavaScript, tracking code, logos, protected copy, or hidden assets.

## 11. Audit a frontend

Run the general audit:

```powershell
ui-agent audit --project .\my-app --interactive
```

Provide a narrower emphasis when desired:

```powershell
ui-agent audit `
  --project .\my-app `
  --brief "Prioritize mobile overflow, focus behavior, form errors, and performance."
```

Audit does not imply permission for a broad redesign. It records evidence-backed defects and may propose targeted repairs inside the approved scope.

## 12. Status, pause, and resume

List all runs:

```powershell
ui-agent status
```

Inspect one run:

```powershell
ui-agent status <run-id>
ui-agent status <run-id> --json
```

Resume it:

```powershell
ui-agent resume <run-id> --interactive
```

If a run is `pending_input`, resume it in an interactive terminal and answer the stored questions or approval. Resume reopens the same Pi JSONL session and uses the persisted design state, decisions, defects, changes, and evidence.

Do not manually edit a run manifest while the process is active.

## 13. Pi TUI controls and custom commands

The exact terminal key bindings come from the installed Pi version and terminal, but the workflow exposes native selection, confirmation, text input, editor review, notifications, widgets, and an inline image chooser.

Useful registered commands include:

```text
/ui-status
/ui-direction
/ui-brief
/ui-decisions
```

Use `/ui-decisions` to inspect the custom decision overlay. Canceling a material question or approval records cancellation instead of silently choosing a default.

## 14. Where outputs are stored

Run artifacts:

```text
.ui-agent/runs/<run-id>/
```

Important contents include:

- `manifest.json`: authoritative run state.
- Pi session JSONL: resumable conversation/tool history.
- Copied immutable briefs and references.
- Project inspections and source-change summaries.
- Preview/build/browser logs.
- Test and quality reports.
- Viewport/state screenshots.
- Pixel comparisons and visual-review JSON.
- Defect records.
- Agent-owned checkpoints.
- Image candidate metadata, contact sheets, licenses, and provenance.

Doctor artifacts:

```text
.ui-agent/doctor/<timestamp>/doctor-report.json
.ui-agent/doctor/<timestamp>/browser-doctor.png
.ui-agent/doctor/latest.json
```

Downloaded project images are stored locally in the target project's asset directory. Provenance history is written to `assets.provenance.json`.

## 15. Common errors and how to fix them

### `CAPABILITY_MISSING`

Typical messages:

- `No local models were returned by discovery.`
- `Model ... has not passed the current text and Pi tool-roundtrip doctor checks.`
- `Recreation is refused until a local visual model passes genuine one-image and two-image doctor checks.`
- `A lockfile is required before dependency installation.`

Fixes:

1. Verify the local server is listening on port 18080.
2. Call `/api/tags` and `/v1/models` directly.
3. Configure an exact returned model ID.
4. Run `ui-agent doctor` again.
5. For installation, create or commit the project's lockfile.

### `NETWORK_BLOCKED`

Likely causes:

- A model endpoint is not loopback-only.
- A reference URL resolves to localhost, a private/reserved address, or uses credentials/nonstandard ports.
- A reference interaction looks destructive or state-changing.
- An image download is non-HTTPS or leaves permitted provider domains.
- A visual-model input attempts to use a remote URL instead of a normalized local data image.

Do not bypass the check. Correct the URL/provider policy, use a public authorized destination, or supply the asset locally.

### `APPROVAL_REQUIRED`

This usually means the agent is behaving correctly. Examples include:

- The run is waiting for grouped human input.
- Brief, information architecture, or visual direction is not approved.
- Close-match recreation was requested without explicit approval.
- An external image or search query was not approved.
- An existing project dependency change or broad replacement needs confirmation.
- The repair budget ended with blocker/high defects.

Run `ui-agent status <run-id>` and then `ui-agent resume <run-id> --interactive`.

### `CONFLICT`

Likely causes:

- A create target is not empty.
- A file changed after the agent read its SHA-256.
- An exact edit anchor occurs zero or multiple times.
- A checkpoint restore would overwrite unrecognized changes.
- The agent attempted to edit an existing project before inspection, baseline checks, or checkpoint creation.

Preserve the newer user content, reread the affected files, create the required baseline/checkpoint, and retry. Do not use a destructive Git reset to remove the conflict.

### `PATH_OUTSIDE_PROJECT`

The requested path escaped the project/run root, traversed through a symlink, or pointed evidence outside approved roots. Move the relevant file into the project or current run artifact directory and retry.

### `SECRET_FILE_BLOCKED`

The agent attempted to access a protected file such as `.env`, Git internals, SSH keys, npm credentials, or Pi authentication state. Provide a sanitized non-secret interface or fixture instead of weakening the block.

### `INVALID_INPUT`

Common causes include:

- Invalid configuration schema or interaction level.
- Configured model ID not present in discovery.
- Too many files, patch operations, screenshots, or attached images.
- Binary/oversized file access.
- Missing package script.
- Invalid image license, watermark, MIME, magic bytes, extension, dimensions, resolution, alt text, or download limit.
- Model output still not matching the required JSON schema after bounded recovery.

Read the full message; it normally identifies the violated limit or field. Correct the input or adjust a safe configuration budget deliberately.

### `NOT_FOUND`

The run, file, browser session, visible screenshot selector, defect ID, or package input does not exist. Confirm the run ID/path/selector and inspect current run status before retrying.

### `PROCESS_FAILED`

Likely causes:

- Typecheck, lint, build, or test script exited nonzero.
- Preview exited before readiness.
- The local model returned a non-retryable HTTP response.
- Openverse or an approved asset download returned an error.

Inspect the bounded stdout/stderr in the run artifacts. Fix the underlying project or provider error, then resume.

### `TIMEOUT`

The model, process, preview readiness probe, browser operation, or tool exceeded its configured deadline.

Check for a hung script or unavailable service before increasing a timeout. Relevant fields include:

```json
{
  "model": { "requestTimeoutMs": 180000 },
  "workflow": { "perToolTimeoutMs": 120000, "maxElapsedMs": 2700000 }
}
```

### `ABORTED`

The operator, Pi UI, parent workflow, or abort signal cancelled the operation. The process and browser managers attempt cleanup. Check run status and resume if cancellation was accidental.

### `UNEXPECTED`

An exception not classified by the agent's typed error system reached the CLI. The displayed message is still redacted, but it may not contain a tailored suggestion. Preserve the run ID, inspect the run's latest logs and manifest, reproduce with `node dist/cli.js ...`, and run `npm run check`. If reproducible, treat it as an implementation defect and report the command, safe error text, Node version, and relevant artifact path without attaching credentials or complete image payloads.

### CLI parsing errors

Commander may report a missing required option, unknown command, or invalid argument before a run exists. Use command-specific help to confirm the syntax:

```powershell
ui-agent --help
ui-agent create --help
ui-agent recreate --help
ui-agent resume --help
```

## 16. Symptom-based troubleshooting

### Doctor cannot reach port 18080

```powershell
Test-NetConnection 127.0.0.1 -Port 18080
Invoke-RestMethod http://127.0.0.1:18080/api/tags
Invoke-RestMethod http://127.0.0.1:18080/v1/models
ui-agent doctor
```

If both HTTP calls fail, fix or restart the inference server; changing the agent will not repair an offline endpoint.

### Model returns empty content with `finish_reason: length`

Thinking may consume the entire output budget. Keep:

```json
"thinking": "off"
```

The provider maps this to `reasoning_effort: "none"`. Increase `maxOutputTokens` only if the actual answer needs more room.

### Configured model is not installed

List the exact discovered IDs, then update the config:

```powershell
Invoke-RestMethod http://127.0.0.1:18080/api/tags
ui-agent config set model <exact-id>
ui-agent config set visual-model <exact-id>
ui-agent doctor
```

### Browser executable is missing

```powershell
npx playwright install chromium
ui-agent doctor
```

Alternatively set `browser.browserName` to `chrome` or `msedge` if that channel is installed.

### Preview never becomes ready

Inspect the run's preview logs. Custom preview scripts must accept forwarded arguments:

```text
--host 127.0.0.1 --port <allocated-port> --strictPort
```

Ensure the project has a usable `preview`, `dev`, or `start` script. Build the project manually to separate compilation failure from readiness failure.

### Windows reports `spawn npm.cmd EINVAL`

The agent's process runner already avoids this Node 24 issue by invoking npm's JavaScript CLI through `process.execPath`. If it reappears, verify you are running the current compiled `dist/`:

```powershell
npm run build
node dist/cli.js doctor
```

### Vite rejects a Windows short path

Build first and use the production `preview` script. The manager prefers production preview when `dist` exists. Do not disable Vite's strict filesystem protection as a workaround.

### TypeScript cannot resolve CSS/Vite imports

Generated projects should contain `src/vite-env.d.ts` with the Vite client declaration. Regenerate or restore that file, then rerun typecheck/build.

### Recreation is blocked although `/api/tags` advertises vision

This is expected. The doctor requires correct single-image and two-image answers. Advertising or accepting an image field does not prove image understanding.

### High-mode run pauses in CI or another non-TTY host

```powershell
ui-agent status <run-id> --json
ui-agent resume <run-id> --interactive
```

Answer the pending checkpoint in a real terminal. Use `balanced` or `autonomous` for future runs only when that interaction policy genuinely matches your intent.

### Lighthouse fails but the page looks correct

Treat Lighthouse as a deterministic budget signal, not a visual opinion. Check asset size, blocking scripts, animation cost, and environment stability. For release enforcement, use repeated runs and a median rather than weakening the threshold after one noisy measurement.

### Image candidate is rejected

Check:

- License is in `acceptedLicenses`.
- License confidence is high.
- Candidate is not watermarked.
- Source/download hosts are permitted.
- Download is HTTPS.
- Raster MIME and decoded magic bytes agree.
- Image is at least 640×360 and within configured byte/dimension/pixel limits.
- Functional images have useful alt text; decorative images use empty alt text.

Never download a search-engine thumbnail or bypass a watermark/license failure.

### A run says progress stalled

The workflow stops after the configured number of stagnant rounds. Inspect recorded defects and comparisons. If the remaining problem is subjective, revise/approve the direction. If it is deterministic, fix the identified component and start a new bounded verification round.

## 17. Cleanup and recovery

Normal session shutdown closes browser contexts and preview process trees. If the terminal was killed abruptly:

1. Check whether the recorded preview port is still listening.
2. Identify only the process associated with that run and project.
3. Stop that specific process; do not terminate every Node process on the machine.
4. Inspect the run manifest and preview log.
5. Resume the run.

Do not delete `.ui-agent/runs/<run-id>` if you need resume, evidence, checkpoints, or provenance. Archive it after completion if long-term traceability matters.

## 18. Recommended operating checklist

Before a run:

- Confirm the model server is loopback-only and online.
- Run `ui-agent doctor` after endpoint/model changes.
- Confirm the target project and command type.
- Commit or back up important user work independently.
- Use an interactive terminal for high mode.
- Ensure references and assets are owned or authorized.

During a run:

- Read the restated brief and assumptions carefully.
- Choose or revise a real design direction.
- Approve only scopes and assets you understand.
- Do not bypass capability, authorization, license, or conflict errors.
- Review screenshots at desktop, tablet, and mobile sizes.

After a run:

- Inspect `ui-agent status <run-id>`.
- Confirm builds, interactions, accessibility, and browser evidence passed.
- Review unresolved defects and stop reason.
- Inspect image provenance and required attribution.
- Review source changes before shipping.
- Do not call the result production-ready while required live checks remain blocked.

For internal design and implementation details, see [`PROJECT_IN_DEPTH.md`](PROJECT_IN_DEPTH.md).
