# Configuration and workflows

Configuration is a versioned JSON document validated by `src/config/schema.ts`. The default path is `.ui-agent/config.json`; pass `--config <path>` for another file. See [the complete example](../ui-agent.config.example.json).

## Model

- `discoveryUrl`: Ollama list endpoint; loopback-only.
- `inferenceBaseUrl`: OpenAI-compatible base, normally `http://127.0.0.1:18080/v1`; loopback-only.
- `codingModelId` and `visualModelId`: exact IDs that must be present in discovery.
- `protocol`: `openai-completions` is implemented for Pi; `ollama-native` is reserved for adapter fallback and is not used by the current Pi session.
- `contextWindow`, `maxOutputTokens`, request timeout, retry policy, thinking level, sampling temperature, attachment count/bytes, screenshot dimensions/count, and asset width/height/pixel limits are explicit.
- Optional auth reads one named environment variable and never serializes or logs its value.

Run `ui-agent doctor` after every endpoint/model change. Capability flags returned by `/api/tags` are informational only.

## Interaction

- `high`: pause for every material product/design choice.
- `balanced`: approve brief and visual direction, then pause on material uncertainty.
- `autonomous`: proceed inside the approved brief, but still stop for destructive, externally visible, legally sensitive, or ambiguous choices.

High-interaction questions are grouped into 1–4 focused prompts with selectable choices and optional free text. Image queries require approval in high mode; contact sheets render inline when the terminal supports images. Approvals and revised/superseded decisions are versioned in the run manifest.

## Create

The agent restates and approves the brief, proposes visual directions, approves IA and direction, scaffolds the pinned React/Vite baseline, creates a lockfile, installs, implements, runs, exercises, captures, reviews, repairs, and verifies.

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
