# UI Agent

The UI Agent of our pi-based coding agent: prompt / link / screenshot → animated website, with self-audit and fixes, on self-hosted open models.
**ARCHITECTURE.md is the source of truth.** Read the sections a task names before writing code. If the code you're about to write contradicts it, stop and ask.

## Write code like a lazy senior dev
Before writing anything, stop at the first rung that holds:
1. Does it need to exist? If not, don't write it.
2. Does it already exist in this repo? Reuse it.
3. Does Node, the browser, or an installed dependency do it? Use that.
4. Can it be one line? Make it one line.
5. Only then: the minimum code that works.

Never cut input validation, error handling at boundaries, security, or accessibility to save lines.

- Functions and plain objects. No classes (except the React error boundary in the kit), no DI, no event bus, no agent frameworks, no "manager"/"service"/"factory" layers.
- No abstraction until it is used twice.
- Respect the per-file line budgets in ARCHITECTURE.md §9. If a change would break one, delete or simplify something first, or stop and ask.
- Comments explain why, never what.
- Text sent to a model lives in `prompts/*.md`, never in TypeScript strings longer than one line.

## Dependencies
Agent: `playwright`, `typebox`, pi packages, Node built-ins. Kit: `react`, `react-dom`, `motion`, `tailwindcss`, `@tailwindcss/vite`, `vite`, `typescript`, `three`, `@react-three/fiber`, `@react-three/drei`.
Ask before adding anything else.

## Correctness rules
- Never trust model output: validate against the schema, retry once with the error, then fail that **section**, not the run.
- Deterministic checks run before any model call.
- Every gate message must say how to fix the problem.
- Never let a broken section reach `site/`.

## Before you say a task is done
- `npm run check && npm test` pass. Show the output; don't hide failures.
- If you touched anything visual, look at it with `playwright-cli` at 390px and 1440px widths.
- Summarize what changed, lines added/removed per file, and anything you were unsure about.
