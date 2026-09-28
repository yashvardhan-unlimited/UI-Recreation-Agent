# Selected versions and verified APIs

Versions were queried from npm on 2026-09-16 and pinned rather than floated.

| Component | Selected version | API/decision |
|---|---:|---|
| `@earendil-works/pi-coding-agent` | 0.85.1 | SDK `createAgentSession*`, `ModelRuntime`, `SessionManager`, `InteractiveMode`, inline extensions, TypeBox tools, lifecycle/compaction |
| `@earendil-works/pi-ai` / core / TUI | 0.85.1 | Model types, provider compatibility, TUI custom view |
| Groq OpenAI-compatible API | current hosted service | Optional local-first fallback at pinned `https://api.groq.com/openai/v1`; bearer key from `GROQ_API_KEY` |
| Node.js | >=22.12; tested 24.14.0 | Vite 8 and Lighthouse 13 compatible |
| TypeScript | 6.0.3 | Newest stable version accepted by `typescript-eslint` 8.70.0 |
| React / React DOM | 19.3.0 | Strict TypeScript client UI scaffold |
| Vite | 8.3.0 | React/Vite frontend and explicit production build |
| Tailwind CSS / Vite plugin | 4.3.3 | CSS-first `@theme` project tokens |
| Playwright | 1.63.0 | Browser contexts, interactions, ARIA snapshots, screenshots |
| Motion | 13.3.0 | Optional normal UI/layout/gesture animation; import from `motion/react` |
| axe-core / Playwright | 4.13.0 | Local rendered-content accessibility audit |
| Lighthouse | 13.4.1 | Programmatic performance/accessibility categories |
| Vitest | 5.0.1 | Unit/integration/live-e2e separation |
| Sharp | 0.35.4 | Decode limits, normalization, optimization, contact sheets |

GSAP and React Three Fiber were reviewed conceptually but not selected for the base harness or neutral scaffold. They should be added only after an approved brief requires sequenced scroll choreography or meaningful 3D.

Official sources consulted before implementation:

- [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md), [extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), [sessions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md), [prompt templates](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/prompt-templates.md), [compaction](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md), and [custom models](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md).
- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility), [chat](https://docs.ollama.com/api/chat), [thinking](https://docs.ollama.com/capabilities/thinking), and [structured outputs](https://docs.ollama.com/capabilities/structured-outputs).
- [Groq OpenAI compatibility](https://console.groq.com/docs/openai), [models](https://console.groq.com/docs/models), [tool use](https://console.groq.com/docs/tool-use/overview), [structured outputs](https://console.groq.com/docs/structured-outputs), and [vision](https://console.groq.com/docs/vision).
- [Node.js native `.env` loading](https://nodejs.org/api/process.html#processloadenvfilepath).
- [React TypeScript](https://react.dev/learn/typescript), [Vite guide](https://vite.dev/guide/), [Playwright web server](https://playwright.dev/docs/test-webserver), [Playwright ARIA snapshots](https://playwright.dev/docs/aria-snapshots), [Tailwind theme variables](https://tailwindcss.com/docs/theme), [Motion for React](https://motion.dev/docs/react), [Motion reduced motion](https://motion.dev/docs/react-use-reduced-motion), [axe API](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md), and [Lighthouse programmatic API](https://github.com/GoogleChrome/lighthouse/blob/main/docs/readme.md).
- [Openverse API client](https://docs.openverse.org/packages/js/api_client/index.html) and [media fields](https://docs.openverse.org/meta/media_properties/api.html).
