# Architecture

## Chosen shape

The harness uses one persistent Pi agent session per run. “Analyst,” “designer,” “implementer,” “browser tester,” “visual reviewer,” and “repair planner” are prompt-scoped roles inside that session, not uncontrolled child agents. Pi owns messages, tool calls, streaming events, cancellation, session JSONL, retry, and compaction. A separate versioned run manifest holds durable product decisions and test evidence so compaction never needs to retain huge logs or images.

The CLI is intentionally a control plane, not a second agent loop.

```mermaid
flowchart LR
  U[Human] <--> T[Pi interactive TUI]
  C[ui-agent CLI] --> R[Run manifest and artifacts]
  C --> P[One Pi AgentSession]
  T <--> P
  P --> X[Typed Pi extension tools]
  X --> F[Project files and checkpoints]
  X --> V[Preview process]
  X --> B[Restricted Playwright]
  X --> M[Verified active model<br/>local or Groq]
  V --> B
  B --> A[Screenshots and browser evidence]
  A --> M
  X --> R
```

## Detailed flow

```mermaid
flowchart TD
  CLI[Commander CLI] --> CFG[Zod config v1]
  CLI --> DOC[Capability doctor]
  DOC --> ROUTE[Local-first backend selection]
  ROUTE --> TAGS[GET loopback /api/tags + /v1/models]
  ROUTE -->|local unavailable + key present| GROQ[GET Groq /openai/v1/models]
  DOC --> CAPS[Text · JSON · tools · Pi continuation · 1/2 image]
  DOC --> BROW[Chromium/runtime/port/screenshot]
  CAPS --> DCACHE[doctor/latest.json]

  CLI --> STORE[RunStore]
  STORE --> MAN[manifest.json v1]
  STORE --> REFS[Immutable copied references]
  STORE --> SESS[Pi JSONL sessions]

  CLI --> MRT[Pi ModelRuntime]
  MRT --> LOCAL[local-ollama provider<br/>openai-completions]
  MRT --> GROQP[groq provider<br/>openai-completions]
  CLI --> ASR[AgentSessionRuntime]
  ASR --> SESSION[Persistent AgentSession]
  SESSION --> EXT[Inline ui-agent Pi extension]
  EXT --> UI[select · confirm · input · editor<br/>notify · widget · custom overlay]
  EXT --> TOOLS[22 narrow typed tools]

  TOOLS --> PATH[Canonical project/run path policy]
  PATH --> PATCH[Hash-guarded UI patches]
  PATH --> CHECK[Agent-owned checkpoints]
  TOOLS --> PREV[Lockfile install/build/start/stop]
  PREV --> PROC[Scrubbed child env + bounded logs<br/>process-tree cleanup]
  TOOLS --> PB[Preview browser context]
  TOOLS --> RB[Reference browser context]
  RB --> SSRF[DNS/IP/port/method/navigation guards]
  PB --> QA[console · network · overflow · images<br/>axe · interactions · screenshots]
  QA --> DIFF[pixelmatch localization]
  DIFF --> VLM[verified two-image VLM review]
  TOOLS --> IMG[Openverse adapter + cache/rate limit<br/>inline contact sheet + approval<br/>bounded download + derivatives + provenance]
  QA --> MAN
  VLM --> MAN
  IMG --> MAN
```

## Workflow state machine

```mermaid
stateDiagram-v2
  [*] --> UNDERSTAND
  UNDERSTAND --> PLAN: brief/questions approved
  PLAN --> IMPLEMENT: IA + direction approved
  IMPLEMENT --> BUILD
  BUILD --> IMPLEMENT: compile failure
  BUILD --> RUN: build passes
  RUN --> IMPLEMENT: readiness failure
  RUN --> EXERCISE
  EXERCISE --> REPAIR: interaction failure
  EXERCISE --> CAPTURE
  CAPTURE --> REVIEW
  REVIEW --> REPAIR: defects remain
  REVIEW --> VERIFY: no proposed repair
  REPAIR --> BUILD
  VERIFY --> REPAIR: final gates fail
  VERIFY --> COMPLETE: gates pass, no blocker/high defect
  COMPLETE --> [*]
```

Terminal statuses are `ready_for_review`, `needs_work`, `blocked`, `failed`, and `cancelled`. Budgets cover elapsed time, repair rounds, tool/model timeouts, attachment sizes/counts, and stagnant rounds.

## Pi integration details

- `ModelRuntime.registerProvider()` registers the selected `openai-completions` provider after exact model discovery. `auto` prefers loopback inference; if that probe fails and `GROQ_API_KEY` is available, it uses the pinned official Groq endpoint.
- `createAgentSessionServices()` and `createAgentSessionFromServices()` construct cwd-bound services and the persistent session.
- `createAgentSessionRuntime()` supports session replacement/resume, while `InteractiveMode` supplies Pi's real TUI.
- An inline extension registers every project/browser/human tool and commands such as `/ui-status`, `/ui-direction`, `/ui-brief`, and `/ui-decisions`.
- `session_before_compact` stores an authoritative compact summary containing the current design specification, decisions, approvals, unresolved defects, source changes, checkpoints, and evidence paths.
- `session_shutdown` closes preview process trees and browser contexts.

## Tool boundary

Tools use TypeBox parameter schemas and return structured details plus bounded human-readable content. Canonical paths are enforced against the project/run roots, with secret-file and binary-read blocks. Model code never receives a general shell. Preview scripts are limited to named package scripts and dependency installation requires a lockfile; the scaffold can create a lockfile with scripts disabled.

## Trade-offs

- A single session makes decisions and evidence coherent and resumable, at the cost of requiring disciplined compaction.
- OpenAI compatibility provides one bounded client path for both local inference and Groq; provider, endpoint, and model ID are bound into doctor evidence before a workflow can start.
- Pixel metrics locate changes but never become a fabricated “accuracy score.” Visual judgment stays structured and cannot override deterministic gates.
- Local-process isolation works on this Windows host without Docker, but it is not safe for hostile untrusted code. See [security.md](security.md).
