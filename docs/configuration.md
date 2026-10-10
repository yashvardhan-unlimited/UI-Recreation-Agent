# Configuration and workflows

Configuration is a versioned JSON document validated by `src/config/schema.ts`. The default path is `.ui-agent/config.json`; pass `--config <path>` for another file. See [the complete example](../ui-agent.config.example.json).

## Model

- `provider`: `auto` (default) tries local inference first and then Groq, `local` disables remote fallback, and `groq` skips the local probe.
- `discoveryUrl`: Ollama list endpoint; loopback-only.
- `inferenceBaseUrl`: OpenAI-compatible base, normally `http://127.0.0.1:18080/v1`; loopback-only.
- `codingModelId` and `visualModelId`: exact IDs that must be present in discovery.
- `localProbeTimeoutMs`: maximum time spent deciding whether to fall back when `provider` is `auto`.
- `groq`: names the API-key environment variable, exact coding/visual model IDs, and Groq context window. The remote base is intentionally pinned to `https://api.groq.com/openai/v1` so a configuration change cannot redirect the bearer token to another host.
- The Groq defaults deliberately use `openai/gpt-oss-20b` for coding/tool work and `qwen/qwen3.8-27b` for vision. Keeping them separate matches their supported modalities and avoids placing the full doctor matrix in one model's rate-limit bucket.
- `protocol`: `openai-completions` is implemented for Pi; `ollama-native` is reserved for adapter fallback and is not used by the current Pi session.
- `contextWindow`, `maxOutputTokens`, request timeout, retry policy, thinking level, sampling temperature, attachment count/bytes, screenshot dimensions/count, and asset width/height/pixel limits are explicit.
- Optional auth reads one named environment variable and never serializes or logs its value. At startup, the CLI loads the nearest `.env`, starting in the working project and walking upward through parent directories until the nearest Git boundary. This lets projects nested under the UI Agent repository reuse its ignored `.env` without copying secrets. The search never crosses a nested repository boundary, and an already exported environment variable takes precedence.

For automatic fallback, copy `.env.example` to `.env` and set:

```dotenv
GROQ_API_KEY=gsk_your_real_key
```

Both files are covered deliberately: `.env` is ignored by Git, while `.env.example` is safe to commit. Preview/build child processes use an allowlist and do not inherit `GROQ_API_KEY`.

Run `ui-agent doctor` after every endpoint/model change. Capability flags returned by `/api/tags` are informational only.

In an interactive Pi session, `/model` shows every discovered model registered for the active backend, and `/model <provider/model>` switches the session model. It does not change the persisted default or bypass the doctor gate for a new workflow; use `ui-agent config set model <id>` followed by `ui-agent doctor` for that. Screenshot analysis/review continues to use the separately configured `visualModelId`, which must pass both vision checks.

## Interaction

- `high`: pause for every material product/design choice.
- `balanced`: approve brief and visual direction, then pause on material uncertainty.
- `autonomous`: proceed inside the approved brief, but still stop for destructive, externally visible, legally sensitive, or ambiguous choices.

High-interaction questions are grouped into 1–4 focused prompts with selectable choices and optional free text. Image queries require approval in high mode; contact sheets render inline when the terminal supports images. Approvals and revised/superseded decisions are versioned in the run manifest.

## Create

The agent restates and approves the brief, proposes visual directions, approves IA and direction, scaffolds the pinned React/Vite baseline, creates a lockfile automatically when absent, installs, implements, runs, exercises, captures, sends rendered captures to the verified visual model for review, repairs, and verifies.

## Improve

The agent inspects framework/scripts/routes/styling/assets/Git state, establishes a build/browser baseline, creates an agent-owned checkpoint, proposes targeted changes, preserves contracts and user work, and reruns affected/final gates.

## Screenshot recreation

References are copied into the run directory before the model can access them. `inspired` transfers visual language; `close-match` requires explicit approval. Visual analysis returns observed facts, inferred behavior, ambiguity, and copying risks as separate fields.

## Authorized URL recreation

Pass both `--url` and `--authorized`. The separate reference context blocks credentials, downloads, popups, private/reserved destinations, state-changing methods, nonstandard ports, and cross-origin top-level navigation. DOM/page text is treated as untrusted data.

## Licensed imagery

The agent derives requirements, asks approval for queries in high mode, searches the pluggable Openverse adapter with caching/rate limiting, filters license/watermark/resolution/domains, builds a numbered contact sheet, obtains exact candidate approval, follows only validated public allowlisted redirects, streams within byte limits, validates MIME/magic/dimensions, generates WebP/AVIF responsive derivatives, and appends provenance history to `assets.provenance.json`. User-supplied rasters have a separate validation/authorization path.

## Artifacts and resume

`.ui-agent/runs/<run-id>/manifest.json` is the durable source of truth. `ui-agent resume` reopens the Pi JSONL session and reinjects compact structured state. Pending questions remain pending; they are not answered by a default.
