# Security and threat model

## Protected boundaries

- Local model URLs are restricted to loopback hosts. The optional Groq fallback is restricted to the exact official `https://api.groq.com/openai/v1` base, uses `GROQ_API_KEY` from the process environment, and cannot be configured to send that bearer token to another host. The harness never opens a public listener for inference.
- Project tools canonicalize paths, reject traversal/symlink escape, block `.git`, `.env*`, SSH keys, npm credentials, Pi auth, binary reads, oversized reads/writes, and stale optimistic hashes.
- Generated apps receive a scrubbed environment without model keys, home-directory variables, SSH agents, cloud/cluster credentials, or container/runtime sockets.
- Preview processes use a project cwd, bounded stdout/stderr, readiness deadlines, and process-tree termination on cancellation/failure/shutdown.
- Preview browsers block all non-preview network traffic. Reference browsers apply DNS/IP SSRF checks before every public HTTP(S) request and use a separate context with no credentials, permissions, downloads, or service workers.
- Reference methods are GET/HEAD only; popups, sensitive/destructive controls, password fields, Enter submission, and unexpected top-level navigation are blocked and recorded.
- Image downloads require an exact recorded approval, an accepted known license, a permitted redirect host, raster MIME, safe decoded dimensions, and no watermark flag. Final projects use local files, never search thumbnails/hotlinks.
- Error/log output redacts common secret fields, bearer values, and base64 image payloads.
- `.env` files are ignored by Git, API-key values are never written to config/run/doctor artifacts, and generated preview/build processes do not inherit model credentials.

## Remote inference boundary

When Groq fallback is active, prompts, tool schemas/results, and any attached screenshots are transmitted to Groq for inference. Set `model.provider` to `local` when project content must remain on-device. Consult your Groq account's data-handling terms before using confidential material.

## Honest limitation

This Windows host has Chrome/Edge/Playwright but no Docker or Podman. A scrubbed child process is a useful accident boundary, not a complete sandbox against malicious packages or generated code. Dependency lifecycle scripts are disabled during lockfile/install operations. Do not use this harness as a hostile multi-tenant executor.

For stronger isolation, run the whole agent in a dedicated VM/container with no host credentials, mount only the target project and artifact directory, deny outbound network except approved media/reference domains, and retain loopback-only inference inside that boundary.

## Authorization and copyright

URL recreation requires an explicit authorization record. The agent extracts a design specification; it does not copy proprietary JavaScript, tracking code, hidden assets, logos, trademarks, paid previews, proprietary text, or reference-site media. “Publicly accessible” is not treated as a reuse license.
