# Validation report

Date: 2026-09-17 (Asia/Calcutta)

## Update: 2026-09-24 Groq fallback

- Added `auto`, `local`, and `groq` provider selection. `auto` preserves local-first behavior and falls back only after the loopback discovery/inference probe fails.
- Added optional workspace `.env` loading through Node's native dotenv support. Groq authentication reads `GROQ_API_KEY` (or the configured environment-variable name); the value is not serialized, logged, or inherited by preview/build child processes.
- Groq traffic is restricted to the exact official `https://api.groq.com/openai/v1` base. The configured coding and visual IDs must be returned by `/models` before use.
- Current deterministic result: 15 test files / 44 tests pass, including local preference, fallback on both discovery and inference-endpoint errors, authenticated Groq fallback, nearest-ancestor dotenv loading with repository-boundary protection, missing-key diagnostics, credential-host pinning, provider-bound doctor caching, `Retry-After` handling, Groq reasoning-level compatibility, and child-process secret isolation.
- Typecheck, lint, production build, dependency audit (0 vulnerabilities), and the generated-project acceptance test pass. The acceptance run reports 1 pass and 4 conditional live-model skips.
- A real Groq doctor passes with `openai/gpt-oss-20b` for text, strict JSON, direct tools, and the Pi tool/file continuation, plus `qwen/qwen3.8-27b` for genuine one-image understanding and two-image comparison. Runtime/port and Chromium screenshot checks also pass. Evidence: `.ui-agent/doctor/2026-09-24T08-07-37-441Z/doctor-report.json`.
- `UI_AGENT_LIVE_MODEL=1 npm run test:live` passes (1 test). The longer full create/repair/recreation live-E2E suite was not run and is not claimed as passed.

## Passed

- Repository/environment inspection: empty starting workspace, no Git repository or applicable `AGENTS.md`, Node 24.14.0, npm, Git, Chrome, Edge, and Playwright browser files present; Docker/Podman absent.
- Initial live discovery: `GET http://127.0.0.1:18080/api/tags` returned the five exact IDs and selection metadata below. All reported `gguf` format; only `qwen3.8:27b` reported a non-empty parent (`qwen3.8:27b-q4_K_M`). `/v1/models` returned the same IDs. Advertised capabilities are recorded but never treated as proof.

| Exact model ID | Modified (`+05:30`) | Bytes | Digest | Family / parameters / quantization | Context / embedding | Advertised capabilities |
| --- | --- | ---: | --- | --- | --- | --- |
| `qwen3.8:27b` | `2026-09-16T12:10:57` | 17,741,872,154 | `22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643` | `qwen35` / 27.3B / Q4_K_M | 262,144 / 5,120 | completion, tools, thinking, vision |
| `qwen3-coder:latest` | `2026-09-15T21:50:44` | 18,556,700,761 | `06c1097efce0431c2045fe7b2e5108366e43bee1b4603a7aded8f21689e90bca` | `qwen3moe` / 30.5B / Q4_K_M | 262,144 / 2,048 | completion, tools |
| `qwen3:235b` | `2026-09-13T01:54:28` | 142,154,087,123 | `754a872f1290d6a685e7be7997962d6518823c32036358794b650db505f6bf99` | `qwen3moe` / 235.1B / Q4_K_M | 262,144 / 4,096 | completion, tools, thinking |
| `gpt-oss:120b` | `2026-09-05T23:21:29` | 65,369,818,941 | `a951a23b46a1f6093dafee2ea481d634b4e31ac720a8a16f3f91e04f5a40ecd9` | `gptoss` / 116.8B / MXFP4 | 131,072 / 2,880 | completion, tools, thinking |
| `qwen3-coder:30b` | `2026-09-05T23:06:32` | 18,556,700,761 | `06c1097efce0431c2045fe7b2e5108366e43bee1b4603a7aded8f21689e90bca` | `qwen3moe` / 30.5B / Q4_K_M | 262,144 / 2,048 | completion, tools |
- Initial direct text probe: the exact discovered `qwen3.8:27b` returned `LOCAL_MODEL_OK` in about 1.1 seconds with `reasoning_effort: none`.
- Harness verification: strict TypeScript, ESLint, and production build pass.
- Deterministic automated suite: 14 test files / 31 tests pass. Coverage includes discovery/selection, request retry/timeout/cancellation/malformed envelopes, structured recovery, path/secret/traversal protection, atomic hash-guarded edits, workflow terminal states, revised decisions, doctor gating, checkpoint ranking/restore conflicts, environment scrubbing, URL/prompt-injection safeguards, image search/license filtering, safe image optimization/provenance, browser evidence, and deterministic gate precedence.
- Real generated-project acceptance: `npm run test:e2e` reports 1 passed and 4 explicitly skipped live-model cases. The passing case scaffolds the pinned React project, creates a lockfile, installs with lifecycle scripts disabled, builds, runs its generated Playwright test, starts a production preview, exercises it in real Chromium, audits desktop/mobile layouts, writes stable screenshots, and cleans up its process tree.
- Final offline doctor runtime/browser checks pass: Node v24.14.0, npm 11.9.0, loopback port allocation, Playwright Chromium launch, and real screenshot output. Evidence: `.ui-agent/doctor/2026-09-16T19-04-14-539Z/doctor-report.json` (UTC artifact timestamp).
- The earlier post-install `npm audit` reported 0 vulnerabilities.

## Failed during investigation and repaired

- A 32-token default-thinking request returned empty content with `finish_reason: length`; mapping Pi `off` to `reasoning_effort: none` fixed direct text output.
- Windows Node 24 rejected direct `npm.cmd` spawn with `EINVAL`; the runner now invokes npm's JavaScript CLI through `process.execPath`.
- The first scaffold build exposed a missing Vite client declaration under TypeScript 6; `src/vite-env.d.ts` was added.
- Vite 8 rejected Windows 8.3 short-name paths in dev serving; the lifecycle now prefers the built production preview when `dist` and a preview script exist, without disabling Vite's strict filesystem policy.
- Early nested Zod defaults were incomplete; strict typecheck/build caught and corrected them.

## Blocked by external state

The server at `http://127.0.0.1:18080` stopped listening before the completed doctor implementation could run its full live matrix. The final doctor records exactly:

- `FAIL`: discovery and `/v1/models` inference endpoint.
- `NOT_CONFIGURED` because their prerequisites were offline: plain text, structured JSON/recovery, direct tool continuation, Pi tool/file round trip, genuine single-image understanding, and genuine two-image comparison.
- `PASS`: runtime/package/port and Chromium screenshot.

Consequently the completed harness has **not** live-validated Pi tool continuation, image understanding, or the full model-driven screenshot-review/repair loop. Start the server and rerun `ui-agent doctor`; workflows intentionally remain locked until a fresh matching report passes.

## Mocked or fixture-backed

- Model retry, timeout, cancellation, malformed envelope, remote-image rejection, and structured-recovery cases use controlled fetch fixtures.
- Openverse normalization/license/watermark/domain filtering and the approved download stream use controlled provider responses; Sharp performs real decode, WebP/AVIF generation, checksums, and provenance writes.
- Workflow terminal states, grouped pending input, revised decisions, checkpoint ordering, and failure precedence are deterministic tests.
- Repository-owned desktop/mobile references and the deliberate overflow project are real local fixtures, but their model-driven scenarios are conditionally skipped while the endpoint is offline.

## Untested live demonstrations

- Full polished React generation from a brief through the local model.
- Deliberate layout-defect repair through the local model.
- Desktop/mobile screenshot recreation through the verified VLM.
- Authorized public URL visual-system recreation.
- Live Openverse search followed by human inline selection, explicit approval, provider download, and rendered-use verification.
- Pausing in the Pi TUI for design approval and resuming with the selected direction.

Conditional scenarios live under `tests/live/` and `tests/e2e/`; representative owned inputs live under `fixtures/`. They must not be reported as successful until run with the endpoint online and any required human/URL authorization.
