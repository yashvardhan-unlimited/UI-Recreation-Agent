# Troubleshooting

## Doctor cannot reach port 18080

Verify the local server is listening:

```powershell
Invoke-RestMethod http://127.0.0.1:18080/api/tags
Invoke-RestMethod http://127.0.0.1:18080/v1/models
```

Then rerun `ui-agent doctor`. A stale or failing doctor record intentionally blocks agent workflows.

## Model returns empty content with `finish_reason: length`

Thinking models can spend a small output budget entirely on reasoning. This happened in the initial live probe. Keep `model.thinking` set to `off`; Pi maps that to Ollama-compatible `reasoning_effort: "none"`. Raise `maxOutputTokens` only when the task genuinely needs it.

## Browser executable missing

```powershell
npx playwright install chromium
ui-agent doctor
```

You can set `browser.browserName` to `chrome` or `msedge` when those installed channels are preferred.

## Build starts but preview never becomes ready

Check the run's preview logs. The manager passes `--host 127.0.0.1 --port <allocated> --strictPort`, so custom scripts must forward those arguments. Preview processes are killed when readiness or tool deadlines expire.

## Recreation is blocked even though `/api/tags` says vision

This is expected. The doctor must receive correct answers for both the generated shape/text image and the two-image comparison. Merely accepting an image field does not count.

## High-mode command pauses in a non-TTY environment

Inspect `ui-agent status <run-id>`. Material questions are persisted under `pendingQuestions` (with `pendingQuestion` retained for a concise status view). Resume in a real terminal with `ui-agent resume <run-id> --interactive`, or explicitly choose `balanced`/`autonomous` before starting if that matches your intent.

## A patch reports `CONFLICT`

The file changed after the model read it or an edit anchor was ambiguous. Reread the file, preserve the new user content, and apply a new hash-guarded patch. Do not bypass the conflict.
