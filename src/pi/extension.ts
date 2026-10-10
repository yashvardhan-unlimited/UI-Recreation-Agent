import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { AppConfig } from "../config/schema.js";
import type { RunManifest } from "../state/schema.js";
import { RunStore } from "../state/store.js";
import { inspectProject } from "../tools/inspect-project.js";
import { applyUiPatch, readRelevantFiles, type UiPatchOperation } from "../tools/files.js";
import { PreviewManager } from "../tools/preview.js";
import { BrowserManager } from "../tools/browser.js";
import { analyzeReference, compareScreenshots, reviewScreenshot } from "../tools/visual.js";
import { createCheckpoint, restoreCheckpoint } from "../tools/checkpoint.js";
import { createAssetContactSheet, downloadApprovedImage, listAssets, registerSuppliedImage, type ImageCandidate } from "../tools/assets.js";
import { searchImages } from "../tools/image-search.js";
import { runQualityChecks } from "../tools/quality.js";
import { toolFailure, toolSuccess } from "../tools/result.js";
import { UiAgentError } from "../utils/errors.js";
import { DecisionView } from "./decision-view.js";
import { reactViteScaffold } from "../templates/react-vite.js";
import { evaluateStop, recordRevisedDecision, transitionRun } from "../state/workflow.js";
import { timestampForPath, writeJsonAtomic } from "../utils/fs.js";
import { ImageSelectionView } from "./image-selection-view.js";
import { deadlineSignal } from "../utils/abort.js";

export interface UiExtensionDependencies {
  config: AppConfig;
  runStore: RunStore;
  run: RunManifest;
  preview: PreviewManager;
  browser: BrowserManager;
  visualModelId?: string;
}

const imageCandidateParameters = Type.Object({
  id: Type.String(),
  provider: Type.Union([Type.Literal("openverse"), Type.Literal("wikimedia")]),
  title: Type.String(), previewUrl: Type.String(), assetUrl: Type.String(), sourcePage: Type.String(), creator: Type.String(),
  creatorUrl: Type.Optional(Type.String()), width: Type.Optional(Type.Number()), height: Type.Optional(Type.Number()), fileType: Type.Optional(Type.String()),
  license: Type.String(), licenseUrl: Type.Optional(Type.String()), attributionRequired: Type.Boolean(), watermarked: Type.Boolean(),
  licenseConfidence: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")])
});

export function createUiAgentExtension(deps: UiExtensionDependencies): ExtensionFactory {
  let currentRun = deps.run;
  const saveRun = async (next: RunManifest): Promise<void> => { currentRun = { ...next, updatedAt: new Date().toISOString() }; await deps.runStore.save(currentRun); };
  const recordToolDuration = async (durationMs: number): Promise<void> => saveRun({ ...currentRun, durationsMs: { ...currentRun.durationsMs, toolsTotal: (currentRun.durationsMs.toolsTotal ?? 0) + Math.round(durationMs) } });
  const persistJsonArtifact = async (kind: string, folder: string, value: unknown, metadata: Record<string, unknown> = {}): Promise<string> => {
    const filePath = path.join(currentRun.runRoot, folder, `${timestampForPath()}-${randomUUID().slice(0, 6)}.json`);
    await writeJsonAtomic(filePath, value);
    await saveRun({ ...currentRun, artifacts: [...currentRun.artifacts, { kind, path: filePath, createdAt: new Date().toISOString(), metadata }] });
    return filePath;
  };
  const guarded = <P, R>(operation: (params: P, signal?: AbortSignal) => Promise<R>) => async (_id: string, params: P, signal: AbortSignal | undefined) => {
    const started = performance.now();
    try {
      if (currentRun.status === "pending_input") throw new UiAgentError("APPROVAL_REQUIRED", "The workflow is paused for recorded human input; resume that checkpoint before other tools run.");
      const value = await operation(params, deadlineSignal(deps.config.workflow.perToolTimeoutMs, signal));
      await recordToolDuration(performance.now() - started);
      return toolSuccess(value, started);
    } catch (error) {
      await recordToolDuration(performance.now() - started);
      return toolFailure(error, started);
    }
  };

  return (pi: ExtensionAPI) => {
    pi.on("session_start", async (_event, ctx) => {
      ctx.ui.setStatus("ui-agent", `${currentRun.stage} · ${currentRun.runId}`);
      ctx.ui.setWidget("ui-agent", [`UI Agent · ${currentRun.kind} · interaction=${currentRun.interaction}`, `Run: ${currentRun.runId} · Stage: ${currentRun.stage} · Status: ${currentRun.status}`]);
      ctx.ui.notify(`UI workflow ${currentRun.runId} resumed at ${currentRun.stage}.`, "info");
    });
    pi.on("session_shutdown", async () => { await deps.preview.cleanup(); await deps.browser.close(); });
    pi.on("before_agent_start", async (event) => ({ systemPrompt: `${event.systemPrompt}\n\nCURRENT STRUCTURED RUN STATE\n${compactRunState(currentRun)}` }));
    pi.on("session_before_compact", async (event) => ({
      compaction: {
        summary: `UI agent compacted state. Preserve this verbatim as authoritative:\n${compactRunState(currentRun)}\nRecent conversation details may be discarded; artifacts and raw logs remain under ${currentRun.runRoot}.`,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore
      }
    }));

    pi.registerTool({
      name: "inspect_project", label: "Inspect project", description: "Inspect the project framework, scripts, routes, styling, assets, dependencies, and Git state.",
      parameters: Type.Object({}),
      execute: guarded(async (_params: Record<string, never>, signal) => {
        const inspection = await inspectProject(currentRun.projectRoot, signal);
        await persistJsonArtifact("project_inspection", "project", inspection, { framework: inspection.framework, dirty: inspection.git.dirty });
        return inspection;
      })
    });
    pi.registerTool({
      name: "read_relevant_files", label: "Read project files", description: "Read a bounded set of non-secret text files inside the project root.",
      parameters: Type.Object({ paths: Type.Array(Type.String(), { minItems: 1, maxItems: 30 }) }),
      execute: guarded(async (params: { paths: string[] }) => readRelevantFiles(currentRun.projectRoot, params.paths))
    });
    pi.registerTool({
      name: "scaffold_frontend", label: "Scaffold frontend", description: "Create the pinned React, strict TypeScript, Vite, Tailwind, Motion, and Playwright baseline in an empty create target.",
      parameters: Type.Object({ stack: Type.Literal("react-vite") }),
      execute: guarded(async () => {
        if (currentRun.kind !== "create") throw new UiAgentError("INVALID_INPUT", "Scaffolding is only available in create workflows.");
        if (currentRun.interaction !== "autonomous") {
          const missing = (["brief", "information_architecture", "design_direction"] as const).filter((kind) => !currentRun.approvals.some((approval) => approval.kind === kind && approval.approved));
          if (missing.length) throw new UiAgentError("APPROVAL_REQUIRED", `Approve ${missing.join(", ")} before scaffolding.`);
        }
        const result = await applyUiPatch(currentRun.projectRoot, reactViteScaffold());
        await saveRun({ ...currentRun, sourceChanges: [...currentRun.sourceChanges, { at: new Date().toISOString(), summary: "Created pinned React/Vite frontend scaffold.", files: result.files.map((file) => file.path) }] });
        return result;
      })
    });
    pi.registerTool({
      name: "apply_ui_patch", label: "Apply UI patch", description: "Create, replace, or make an exact anchored edit to project files. Paths are project-scoped and sensitive files are blocked.",
      promptGuidelines: ["Read files before editing and provide expectedSha256 for conflict detection.", "Create an agent checkpoint before broad edits."],
      parameters: Type.Object({ operations: Type.Array(Type.Object({ path: Type.String(), action: Type.Union([Type.Literal("create"), Type.Literal("replace"), Type.Literal("edit")]), content: Type.Optional(Type.String()), find: Type.Optional(Type.String()), replace: Type.Optional(Type.String()), expectedSha256: Type.Optional(Type.String()) }), { minItems: 1, maxItems: 50 }) }),
      execute: guarded(async (params: { operations: Parameters<typeof applyUiPatch>[1] }) => {
        const modifiesExisting = params.operations.some((operation) => operation.action !== "create");
        if ((currentRun.kind !== "create" || modifiesExisting) && currentRun.checkpoints.length === 0) throw new UiAgentError("CONFLICT", "Create an agent-owned checkpoint before modifying an existing project or scaffold.");
        if (["improve", "recreate", "audit"].includes(currentRun.kind) && !currentRun.artifacts.some((artifact) => artifact.kind === "project_inspection")) throw new UiAgentError("CONFLICT", "Inspect and persist the existing project state before editing.");
        if (["improve", "recreate", "audit"].includes(currentRun.kind) && !currentRun.artifacts.some((artifact) => artifact.kind === "quality_report")) throw new UiAgentError("CONFLICT", "Run and persist baseline quality checks before editing the existing project.");
        if (currentRun.kind !== "create" && await changesDependencies(currentRun.projectRoot, params.operations) && !currentRun.approvals.some((approval) => approval.kind === "dependency_change" && approval.approved)) throw new UiAgentError("APPROVAL_REQUIRED", "Dependency changes in an existing project require explicit approval.");
        const broadReplacement = currentRun.kind !== "create" && (params.operations.length > 10 || params.operations.some((operation) => operation.action === "replace" && (operation.content?.length ?? 0) > 100_000));
        if (broadReplacement && !currentRun.approvals.some((approval) => approval.kind === "replacement" && approval.approved)) throw new UiAgentError("APPROVAL_REQUIRED", "Broad replacement of an existing design requires explicit approval.");
        const result = await applyUiPatch(currentRun.projectRoot, params.operations);
        await saveRun({ ...currentRun, sourceChanges: [...currentRun.sourceChanges, { at: new Date().toISOString(), summary: `Applied ${result.files.length} targeted file operation(s).`, files: result.files.map((file) => file.path) }] });
        return result;
      })
    });
    pi.registerTool({
      name: "manage_preview", label: "Manage preview", description: "Generate a safe npm lockfile when needed, install dependencies with lifecycle scripts disabled, build, start, stop, inspect logs, or run a declared package script in the isolated preview process boundary. Use install for a new scaffold; it generates package-lock.json before npm ci when no lock exists.",
      parameters: Type.Object({ action: Type.Union([Type.Literal("lock"), Type.Literal("install"), Type.Literal("build"), Type.Literal("start"), Type.Literal("stop"), Type.Literal("status"), Type.Literal("script")]), script: Type.Optional(Type.String()), args: Type.Optional(Type.Array(Type.String(), { maxItems: 20 })) }),
      execute: guarded(async (params: { action: string; script?: string; args?: string[] }, signal) => {
        let result: unknown;
        if (params.action === "lock") result = await deps.preview.createLockfile(currentRun.projectRoot, signal);
        else if (params.action === "install") result = await deps.preview.install(currentRun.projectRoot, signal);
        else if (params.action === "build") result = await deps.preview.build(currentRun.projectRoot, signal);
        else if (params.action === "start") result = await deps.preview.start(currentRun.projectRoot, { signal });
        else if (params.action === "stop") result = await deps.preview.stop(currentRun.projectRoot);
        if (params.action === "script") {
          if (!params.script) throw new UiAgentError("INVALID_INPUT", "script action requires a script name.");
          result = await deps.preview.runScript(currentRun.projectRoot, params.script, params.args ?? [], signal);
        }
        result ??= deps.preview.status(currentRun.projectRoot);
        await persistJsonArtifact("preview_log", "logs", result, { action: params.action, ...(params.script ? { script: params.script } : {}) });
        return result;
      })
    });
    pi.registerTool({
      name: "browser_inspect", label: "Inspect in browser", description: "Open or inspect a restricted real-browser session. Reference mode requires recorded URL authorization.",
      parameters: Type.Object({ action: Type.Union([Type.Literal("open"), Type.Literal("inspect"), Type.Literal("close")]), sessionId: Type.Optional(Type.String()), url: Type.Optional(Type.String()), mode: Type.Optional(Type.Union([Type.Literal("preview"), Type.Literal("reference")])), width: Type.Optional(Type.Number({ minimum: 240, maximum: 7680 })), height: Type.Optional(Type.Number({ minimum: 240, maximum: 7680 })), selector: Type.Optional(Type.String()) }),
      execute: guarded(async (params: { action: string; sessionId?: string; url?: string; mode?: "preview" | "reference"; width?: number; height?: number; selector?: string }, signal) => {
        if (params.action === "open") {
          if (!params.url || !params.mode) throw new UiAgentError("INVALID_INPUT", "Open requires url and mode.");
          if (params.mode === "reference" && !currentRun.approvals.some((approval) => approval.kind === "url_authorization" && approval.approved)) throw new UiAgentError("APPROVAL_REQUIRED", "Authorized URL confirmation is required before opening a reference site.");
          return { sessionId: await deps.browser.createSession({ url: params.url, mode: params.mode, width: params.width ?? 1440, height: params.height ?? 900, signal }) };
        }
        if (!params.sessionId) throw new UiAgentError("INVALID_INPUT", `${params.action} requires sessionId.`);
        if (params.action === "close") { await deps.browser.closeSession(params.sessionId); return { closed: true }; }
        const inspection = await deps.browser.inspect(params.sessionId, params.selector);
        await persistJsonArtifact("browser_inspection", "browser", inspection, { sessionId: params.sessionId, selector: params.selector ?? "body" });
        return inspection;
      })
    });
    pi.registerTool({
      name: "browser_interact", label: "Exercise interface", description: "Perform one bounded browser interaction such as click, type, hover, focus, key press, scroll, or selection.",
      parameters: Type.Object({ sessionId: Type.String(), kind: Type.Union([Type.Literal("click"), Type.Literal("type"), Type.Literal("hover"), Type.Literal("focus"), Type.Literal("press"), Type.Literal("scroll"), Type.Literal("select")]), selector: Type.Optional(Type.String()), value: Type.Optional(Type.String()), key: Type.Optional(Type.String()), x: Type.Optional(Type.Number()), y: Type.Optional(Type.Number()) }),
      execute: guarded(async (params: Parameters<BrowserManager["interact"]>[1] & { sessionId: string }) => deps.browser.interact(params.sessionId, params))
    });
    pi.registerTool({
      name: "capture_screenshot", label: "Capture screenshot", description: "Capture deterministic stable-comparison or live-motion screenshots with artifact metadata.",
      parameters: Type.Object({ sessionId: Type.String(), name: Type.String(), fullPage: Type.Optional(Type.Boolean()), selector: Type.Optional(Type.String()), mode: Type.Optional(Type.Union([Type.Literal("stable"), Type.Literal("live")])) }),
      execute: guarded(async (params: { sessionId: string; name: string; fullPage?: boolean; selector?: string; mode?: "stable" | "live" }) => {
        const result = await deps.browser.capture(params.sessionId, params);
        await saveRun({ ...currentRun, artifacts: [...currentRun.artifacts, { kind: "screenshot", path: result.path, createdAt: new Date().toISOString(), metadata: result }] });
        return result;
      })
    });
    pi.registerTool({
      name: "analyze_reference", label: "Analyze reference", description: "Send normalized actual image bytes to the verified visual model and separate observed facts from inference.",
      parameters: Type.Object({ imagePath: Type.String(), intent: Type.Union([Type.Literal("inspired"), Type.Literal("close-match")]) }),
      execute: guarded(async (params: { imagePath: string; intent: "inspired" | "close-match" }, signal) => {
        if (!deps.visualModelId) throw new UiAgentError("CAPABILITY_MISSING", "No verified visual model is configured.");
        if (params.intent === "close-match" && !currentRun.approvals.some((approval) => approval.kind === "close_match" && approval.approved)) throw new UiAgentError("APPROVAL_REQUIRED", "Close-match recreation requires explicit approval; use inspired intent otherwise.");
        const analysis = await analyzeReference({ imagePath: assertEvidencePath(params.imagePath, currentRun), intent: params.intent, modelId: deps.visualModelId, config: deps.config, signal });
        await persistJsonArtifact("reference_analysis", "visual", analysis, { imagePath: params.imagePath, intent: params.intent, modelId: deps.visualModelId });
        return analysis;
      })
    });
    pi.registerTool({
      name: "compare_screenshots", label: "Compare screenshots", description: "Compare target and render with pixel metrics plus a structured two-image visual review.",
      parameters: Type.Object({ targetPath: Type.String(), renderedPath: Type.String(), name: Type.String(), page: Type.String(), viewport: Type.String() }),
      execute: guarded(async (params: { targetPath: string; renderedPath: string; name: string; page: string; viewport: string }, signal) => {
        if (!deps.visualModelId) throw new UiAgentError("CAPABILITY_MISSING", "Two-image comparison is unavailable without a verified visual model.");
        const outputPath = path.join(currentRun.runRoot, "comparisons", `${params.name.replace(/[^a-zA-Z0-9._-]/g, "-")}.png`);
        const comparison = await compareScreenshots({ ...params, targetPath: assertEvidencePath(params.targetPath, currentRun), renderedPath: assertEvidencePath(params.renderedPath, currentRun), outputPath, modelId: deps.visualModelId, config: deps.config, signal });
        await persistJsonArtifact("screenshot_comparison", "comparisons", comparison, { targetPath: params.targetPath, renderedPath: params.renderedPath, diffPath: comparison.diffPath, page: params.page, viewport: params.viewport });
        return comparison;
      })
    });
    pi.registerTool({
      name: "review_screenshot", label: "Review screenshot", description: "Send a captured rendered screenshot to the verified visual model for a structured single-image UI review. Use after capture for every workflow; use compare_screenshots as well when an approved visual target exists.",
      parameters: Type.Object({ imagePath: Type.String(), page: Type.String(), viewport: Type.String() }),
      execute: guarded(async (params: { imagePath: string; page: string; viewport: string }, signal) => {
        if (!deps.visualModelId) throw new UiAgentError("CAPABILITY_MISSING", "Screenshot review is unavailable without a verified visual model.");
        const review = await reviewScreenshot({
          imagePath: assertEvidencePath(params.imagePath, currentRun),
          modelId: deps.visualModelId,
          config: deps.config,
          page: params.page,
          viewport: params.viewport,
          requirements: visualReviewContext(currentRun),
          signal
        });
        await persistJsonArtifact("screenshot_review", "visual", review, { imagePath: params.imagePath, page: params.page, viewport: params.viewport, modelId: deps.visualModelId });
        return review;
      })
    });
    pi.registerTool({
      name: "run_quality_checks", label: "Run quality checks", description: "Run configured deterministic scripts and browser checks. Browser failures override a positive visual review.",
      parameters: Type.Object({ previewUrl: Type.Optional(Type.String()) }),
      execute: guarded(async (params: { previewUrl?: string }, signal) => {
        const report = await runQualityChecks({ projectRoot: currentRun.projectRoot, ...(params.previewUrl ? { previewUrl: params.previewUrl } : {}), browser: deps.browser, artifactRoot: currentRun.runRoot, config: deps.config, signal });
        await persistJsonArtifact("quality_report", "quality", report, { passed: report.passed, previewUrl: params.previewUrl ?? "" });
        return report;
      })
    });
    pi.registerTool({
      name: "checkpoint_project", label: "Checkpoint project", description: "Create or conflict-safely restore an agent-owned project checkpoint without touching Git metadata or dependency trees.",
      parameters: Type.Object({ action: Type.Union([Type.Literal("create"), Type.Literal("restore")]), checkpointPath: Type.Optional(Type.String()), expectedCurrentHashes: Type.Optional(Type.Record(Type.String(), Type.String())) }),
      execute: guarded(async (params: { action: string; checkpointPath?: string; expectedCurrentHashes?: Record<string, string> }) => {
        if (params.action === "restore") {
          if (!params.checkpointPath) throw new UiAgentError("INVALID_INPUT", "Restore requires checkpointPath.");
          return restoreCheckpoint({ projectRoot: currentRun.projectRoot, checkpointRoot: path.join(currentRun.runRoot, "checkpoints"), checkpointPath: params.checkpointPath, expectedCurrentHashes: params.expectedCurrentHashes ?? {} });
        }
        const result = await createCheckpoint(currentRun.projectRoot, currentRun.runRoot);
        await saveRun({ ...currentRun, checkpoints: [...currentRun.checkpoints, { id: result.id, path: result.path, at: new Date().toISOString(), summary: `Checkpoint with ${result.files} files`, verified: false }] });
        return result;
      })
    });
    pi.registerTool({ name: "list_assets", label: "List assets", description: "List safe image and font assets with dimensions and formats.", parameters: Type.Object({}), execute: guarded(async () => listAssets(currentRun.projectRoot)) });
    pi.registerTool({
      name: "search_images", label: "Search licensed images", description: "Search configured documented media APIs and return normalized candidate metadata without selecting or downloading.",
      parameters: Type.Object({ query: Type.String({ minLength: 2, maxLength: 200 }) }),
      execute: guarded(async (params: { query: string }, signal) => {
        if (currentRun.interaction === "high" && !currentRun.approvals.some((approval) => approval.kind === "image_search_query" && approval.approved && approval.summary.includes(params.query))) throw new UiAgentError("APPROVAL_REQUIRED", `High interaction requires approval of image search query: ${params.query}`);
        const candidates = await searchImages({ query: params.query, config: deps.config, signal });
        await persistJsonArtifact("image_search", "assets", { query: params.query, candidates }, { query: params.query, count: candidates.length });
        return candidates;
      })
    });
    pi.registerTool({
      name: "create_asset_contact_sheet", label: "Create contact sheet", description: "Download bounded previews only and create a numbered local candidate contact sheet.",
      parameters: Type.Object({ candidates: Type.Array(imageCandidateParameters, { minItems: 1, maxItems: 20 }), name: Type.String() }),
      async execute(_id, params: { candidates: ImageCandidate[]; name: string }, signal, _update, ctx) {
        const started = performance.now();
        try {
          const contactSheetPath = await createAssetContactSheet({ candidates: params.candidates, outputPath: path.join(currentRun.runRoot, "assets", `${params.name.replace(/[^a-zA-Z0-9._-]/g, "-")}.png`), config: deps.config, signal: deadlineSignal(deps.config.workflow.perToolTimeoutMs, signal) });
          await saveRun({ ...currentRun, artifacts: [...currentRun.artifacts, { kind: "asset_contact_sheet", path: contactSheetPath, createdAt: new Date().toISOString(), metadata: { candidates: params.candidates.map((candidate) => candidate.id) } }] });
          if (!ctx.hasUI) {
            if (currentRun.interaction === "high") {
              const pending = { id: `image_selection:${params.name}`, prompt: `Choose an image from ${contactSheetPath}`, options: [...params.candidates.slice(0, 9).map((candidate) => candidate.id), "search-again", "supply-own", "reject-all"], createdAt: new Date().toISOString() };
              await saveRun({ ...currentRun, status: "pending_input", pendingQuestion: pending, pendingQuestions: [pending] });
            }
            await recordToolDuration(performance.now() - started);
            return toolSuccess({ path: contactSheetPath, selection: null, pendingInput: currentRun.interaction === "high" }, started);
          }
          const image = await readFile(contactSheetPath);
          const selection = await ctx.ui.custom<string | undefined>((_tui, theme, _keys, done) => new ImageSelectionView(image.toString("base64"), params.candidates, theme, done), { overlay: true });
          if (selection) {
            const next = recordRevisedDecision(currentRun, { id: randomUUID(), topic: `image_selection:${params.name}`, value: selection, affectedScope: ["imagery", "asset_provenance"], at: new Date().toISOString() });
            await saveRun({ ...next, status: "running", pendingQuestion: undefined, pendingQuestions: [] });
          }
          await recordToolDuration(performance.now() - started);
          return toolSuccess({ path: contactSheetPath, selection: selection ?? null }, started);
        } catch (error) {
          await recordToolDuration(performance.now() - started);
          return toolFailure(error, started);
        }
      }
    });
    pi.registerTool({
      name: "download_approved_image", label: "Download approved image", description: "Download only the exactly approved licensed candidate, validate and optimize it, and update provenance.",
      parameters: Type.Object({ candidate: imageCandidateParameters, approvedCandidateId: Type.String(), destination: Type.String(), usedBy: Type.Array(Type.String(), { maxItems: 30 }), altText: Type.String(), decorative: Type.Boolean() }),
      execute: guarded(async (params: { candidate: ImageCandidate; approvedCandidateId: string; destination: string; usedBy: string[]; altText: string; decorative: boolean }, signal) => {
        const approved = currentRun.approvals.some((approval) => approval.kind === "external_image" && approval.approved && approval.summary.includes(params.approvedCandidateId));
        if (!approved) throw new UiAgentError("APPROVAL_REQUIRED", "No matching external-image approval exists in run state.");
        const provenance = await downloadApprovedImage({ ...params, projectRoot: currentRun.projectRoot, config: deps.config, signal });
        await persistJsonArtifact("asset_provenance", "assets", provenance, { candidateId: params.approvedCandidateId, localPath: provenance.localPath });
        return provenance;
      })
    });
    pi.registerTool({
      name: "register_supplied_asset", label: "Register user-supplied image", description: "Validate a project-local user-supplied raster image and record authorization, checksum, usage, and contextual alt text without inventing license metadata.",
      parameters: Type.Object({ assetPath: Type.String(), usedBy: Type.Array(Type.String(), { maxItems: 30 }), altText: Type.String(), decorative: Type.Boolean() }),
      execute: guarded(async (params: { assetPath: string; usedBy: string[]; altText: string; decorative: boolean }) => {
        const provenance = await registerSuppliedImage({ ...params, projectRoot: currentRun.projectRoot, config: deps.config });
        await persistJsonArtifact("asset_provenance", "assets", provenance, { authorization: "user-supplied", localPath: provenance.localPath });
        return provenance;
      })
    });
    pi.registerTool({
      name: "record_design_spec", label: "Record design specification", description: "Persist normalized requirements, design specification, assumptions, missing information, and acceptance criteria without changing the immutable brief.",
      parameters: Type.Object({
        normalizedRequirements: Type.Record(Type.String(), Type.Unknown()),
        plan: Type.Array(Type.Object({ id: Type.String(), description: Type.String(), status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("complete"), Type.Literal("blocked")]) }), { maxItems: 100 }),
        designSpec: Type.Record(Type.String(), Type.Unknown()),
        acceptanceCriteria: Type.Array(Type.String(), { maxItems: 50 }),
        assumptions: Type.Array(Type.String(), { maxItems: 50 }),
        missingInformation: Type.Array(Type.String(), { maxItems: 50 })
      }),
      execute: guarded(async (params: Pick<RunManifest, "normalizedRequirements" | "plan" | "designSpec" | "acceptanceCriteria" | "assumptions" | "missingInformation">) => {
        await saveRun({ ...currentRun, ...params });
        return { recorded: true, planItems: params.plan.length, acceptanceCriteria: params.acceptanceCriteria.length, unresolvedQuestions: params.missingInformation.length };
      })
    });
    pi.registerTool({
      name: "record_defects", label: "Record or resolve defects", description: "Persist evidence-backed visual/functional defects or resolve existing defect IDs after verification.",
      parameters: Type.Object({
        add: Type.Optional(Type.Array(Type.Object({
          severity: Type.Union([Type.Literal("blocker"), Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
          page: Type.String(), viewport: Type.String(), interactionState: Type.String(), evidence: Type.Array(Type.String(), { maxItems: 20 }),
          observedProblem: Type.String(), likelySource: Type.Optional(Type.String()), proposedRepair: Type.String(), verificationMethod: Type.String()
        }), { maxItems: 50 })),
        resolve: Type.Optional(Type.Array(Type.Object({ id: Type.String(), status: Type.Union([Type.Literal("fixed"), Type.Literal("accepted"), Type.Literal("superseded")]) }), { maxItems: 50 }))
      }),
      execute: guarded(async (params: { add?: Array<Omit<RunManifest["defects"][number], "id" | "status">>; resolve?: Array<{ id: string; status: "fixed" | "accepted" | "superseded" }> }) => {
        const resolutions = new Map((params.resolve ?? []).map((item) => [item.id, item.status]));
        const unknown = [...resolutions.keys()].filter((id) => !currentRun.defects.some((defect) => defect.id === id));
        if (unknown.length) throw new UiAgentError("NOT_FOUND", `Unknown defect IDs: ${unknown.join(", ")}`);
        const defects = currentRun.defects.map((defect) => resolutions.has(defect.id) ? { ...defect, status: resolutions.get(defect.id)! } : defect);
        for (const defect of params.add ?? []) defects.push({ ...defect, id: randomUUID(), status: "open" });
        await saveRun({ ...currentRun, defects });
        return { added: params.add?.length ?? 0, resolved: params.resolve?.length ?? 0, open: defects.filter((defect) => defect.status === "open").length };
      })
    });
    pi.registerTool({
      name: "advance_workflow", label: "Advance workflow", description: "Advance one valid state-machine edge, update bounded counters, or record an evidence-based terminal outcome.",
      parameters: Type.Object({
        nextStage: Type.Optional(Type.Union([Type.Literal("UNDERSTAND"), Type.Literal("PLAN"), Type.Literal("IMPLEMENT"), Type.Literal("BUILD"), Type.Literal("RUN"), Type.Literal("EXERCISE"), Type.Literal("CAPTURE"), Type.Literal("REVIEW"), Type.Literal("REPAIR"), Type.Literal("VERIFY"), Type.Literal("COMPLETE")])),
        repairDelta: Type.Optional(Type.Integer({ minimum: 0, maximum: 1 })),
        stagnantDelta: Type.Optional(Type.Integer({ minimum: 0, maximum: 1 })),
        retryDelta: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
        finish: Type.Optional(Type.Object({ requiredGatesPass: Type.Boolean(), capabilityMissing: Type.Optional(Type.Boolean()), cancelled: Type.Optional(Type.Boolean()), fatalError: Type.Optional(Type.Boolean()) })),
        stopReason: Type.Optional(Type.String())
      }),
      execute: guarded(async (params: { nextStage?: RunManifest["stage"]; repairDelta?: number; stagnantDelta?: number; retryDelta?: number; finish?: { requiredGatesPass: boolean; capabilityMissing?: boolean; cancelled?: boolean; fatalError?: boolean }; stopReason?: string }) => {
        let next: RunManifest = { ...currentRun, counters: { repairRounds: currentRun.counters.repairRounds + (params.repairDelta ?? 0), stagnantRounds: currentRun.counters.stagnantRounds + (params.stagnantDelta ?? 0), retries: currentRun.counters.retries + (params.retryDelta ?? 0) } };
        if (params.nextStage && params.nextStage !== currentRun.stage) next = transitionRun(next, params.nextStage);
        if (params.finish) {
          const outcome = evaluateStop(next, { elapsedMs: Date.now() - Date.parse(next.createdAt), maxElapsedMs: deps.config.workflow.maxElapsedMs, maxRepairRounds: deps.config.workflow.maxRepairRounds, maxStagnantRounds: deps.config.workflow.maxStagnantRounds, ...params.finish });
          if (!outcome.stop || !outcome.status) throw new UiAgentError("INVALID_INPUT", "The supplied evidence does not meet a configured stopping condition.");
          const severeOpen = next.defects.some((defect) => defect.status === "open" && (defect.severity === "blocker" || defect.severity === "high"));
          if (outcome.status === "needs_work" && severeOpen && !next.approvals.some((approval) => approval.kind === "repair_escalation" && approval.approved)) throw new UiAgentError("APPROVAL_REQUIRED", "Repair budget exhaustion with blocker/high defects requires a human escalation checkpoint.");
          next = { ...next, status: outcome.status, stopReason: params.stopReason ?? outcome.reason };
          if (outcome.status === "ready_for_review" && next.stage !== "COMPLETE") next = transitionRun(next, "COMPLETE");
        }
        await saveRun(next);
        return { stage: next.stage, status: next.status, counters: next.counters, stopReason: next.stopReason };
      })
    });
    pi.registerTool({
      name: "ask_human", label: "Ask focused questions", description: "Use Pi-native selectors and free-text input for a small grouped set of material questions, recording each decision.",
      parameters: Type.Object({ questions: Type.Array(Type.Object({ id: Type.String(), prompt: Type.String(), options: Type.Array(Type.String(), { minItems: 2, maxItems: 4 }), allowFreeText: Type.Optional(Type.Boolean()) }), { minItems: 1, maxItems: 4 }) }),
      async execute(_id, params: { questions: Array<{ id: string; prompt: string; options: string[]; allowFreeText?: boolean }> }, _signal, _update, ctx) {
        const started = performance.now();
        try {
          const questions = currentRun.status === "pending_input" && currentRun.pendingQuestions.length ? currentRun.pendingQuestions.map((question) => ({ ...question, allowFreeText: true })) : params.questions;
          if (!ctx.hasUI) {
            const pendingQuestions = questions.map((question) => ({ id: question.id, prompt: question.prompt, options: question.options, createdAt: new Date().toISOString() }));
            const first = pendingQuestions[0]!;
            await saveRun({ ...currentRun, status: "pending_input", pendingQuestion: first, pendingQuestions });
            throw new UiAgentError("APPROVAL_REQUIRED", "Interactive Pi UI is unavailable; the run was paused with pending input.");
          }
          const answers: Record<string, string> = {};
          for (const question of questions) {
            const freeLabel = "Write a different answer…";
            const selected = await ctx.ui.select(question.prompt, question.allowFreeText ? [...question.options, freeLabel] : question.options);
            if (!selected) throw new UiAgentError("ABORTED", "Question cancelled by user.");
            answers[question.id] = selected === freeLabel ? (await ctx.ui.input(question.prompt, "Type your preference"))?.trim() || "" : selected;
          }
          let next = currentRun;
          for (const [topic, value] of Object.entries(answers)) next = recordRevisedDecision(next, { id: randomUUID(), topic, value, affectedScope: [], at: new Date().toISOString() });
          await saveRun({ ...next, status: "running", pendingQuestion: undefined, pendingQuestions: [] });
          ctx.ui.notify("Material decisions saved to the run manifest.", "info");
          return toolSuccess({ answers }, started);
        } catch (error) { return toolFailure(error, started); }
      }
    });
    pi.registerTool({
      name: "approve_direction", label: "Approve direction", description: "Show an editable design brief and Pi-native confirmation, then persist the approval checkpoint.",
      parameters: Type.Object({ kind: Type.Union([Type.Literal("brief"), Type.Literal("information_architecture"), Type.Literal("design_direction"), Type.Literal("image_search_query"), Type.Literal("external_image"), Type.Literal("dependency_change"), Type.Literal("replacement"), Type.Literal("close_match"), Type.Literal("design_deviation"), Type.Literal("repair_escalation"), Type.Literal("url_authorization")]), summary: Type.String(), editableBrief: Type.Optional(Type.String()) }),
      async execute(_id, params: { kind: RunManifest["approvals"][number]["kind"]; summary: string; editableBrief?: string }, _signal, _update, ctx) {
        const started = performance.now();
        try {
          if (currentRun.status === "pending_input" && currentRun.pendingQuestion && currentRun.pendingQuestion.id !== `approval:${params.kind}`) throw new UiAgentError("APPROVAL_REQUIRED", `The pending checkpoint is ${currentRun.pendingQuestion.id}, not approval:${params.kind}.`);
          if (!ctx.hasUI) {
            const pending = { id: `approval:${params.kind}`, prompt: params.summary, options: ["Approve", "Revise", "Decline"], createdAt: new Date().toISOString() };
            await saveRun({ ...currentRun, status: "pending_input", pendingQuestion: pending, pendingQuestions: [pending] });
            throw new UiAgentError("APPROVAL_REQUIRED", "Approval requires interactive Pi UI; the checkpoint was persisted for resume.");
          }
          const edited = params.editableBrief !== undefined ? await ctx.ui.editor(`Review ${params.kind}`, params.editableBrief) : undefined;
          if (params.editableBrief !== undefined && edited === undefined) throw new UiAgentError("ABORTED", "Approval review cancelled.");
          const summary = edited ?? params.summary;
          const approved = await ctx.ui.confirm(`Approve ${params.kind.replaceAll("_", " ")}?`, summary);
          const approval = { id: randomUUID(), kind: params.kind, approved, summary, at: new Date().toISOString() };
          await saveRun({ ...currentRun, status: "running", pendingQuestion: undefined, pendingQuestions: [], approvals: [...currentRun.approvals, approval], ...(params.kind === "brief" && approved ? { designSpec: { ...currentRun.designSpec, approvedBrief: summary } } : {}) });
          ctx.ui.notify(approved ? "Approval recorded." : "Declined; the workflow will revise or pause.", approved ? "info" : "warning");
          return toolSuccess(approval, started);
        } catch (error) { return toolFailure(error, started); }
      }
    });

    pi.registerCommand("ui-status", { description: "Show structured UI-agent run status", handler: async (_args, ctx) => { currentRun = await deps.runStore.load(currentRun.runId); ctx.ui.notify(`${currentRun.stage} · ${currentRun.status} · ${currentRun.defects.filter((d) => d.status === "open").length} open defects`, "info"); } });
    pi.registerCommand("ui-decisions", { description: "Open the UI-agent decisions and defects view", handler: async (_args, ctx) => { currentRun = await deps.runStore.load(currentRun.runId); await ctx.ui.custom<void>((_tui, theme, _keys, done) => new DecisionView(currentRun, theme, done), { overlay: true }); } });
    pi.registerCommand("ui-direction", { description: "Choose or revise a design direction", handler: async (_args, ctx) => { const choice = await ctx.ui.select("Design direction", ["Editorial precision", "Technical confidence", "Expressive motion", "Combine or revise…"]); if (!choice) return; const value = choice.endsWith("…") ? await ctx.ui.input("Describe the combined direction") : choice; if (!value) return; await saveRun({ ...currentRun, decisions: [...currentRun.decisions, { id: randomUUID(), topic: "design_direction", value, affectedScope: ["visual_system", "motion", "imagery"], decidedAt: new Date().toISOString() }] }); ctx.ui.notify("Direction saved; ask for approval before broad implementation.", "info"); } });
    pi.registerCommand("ui-brief", { description: "Edit the current design brief", handler: async (_args, ctx) => { const approvedBrief = currentRun.designSpec.approvedBrief; const prefill = typeof approvedBrief === "string" ? approvedBrief : currentRun.immutableInput.brief; const edited = await ctx.ui.editor("Edit design brief", prefill); if (!edited) return; await saveRun({ ...currentRun, designSpec: { ...currentRun.designSpec, draftBrief: edited } }); ctx.ui.notify("Draft brief updated.", "info"); } });
  };
}

function assertEvidencePath(input: string, run: RunManifest): string {
  const resolved = path.resolve(input);
  const roots = [path.resolve(run.projectRoot), path.resolve(run.runRoot)];
  if (!roots.some((root) => { const relative = path.relative(root, resolved); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); })) throw new UiAgentError("PATH_OUTSIDE_PROJECT", "Visual evidence path must be inside the project or current run artifact directory.");
  return resolved;
}

function visualReviewContext(run: RunManifest): string {
  return JSON.stringify({
    brief: run.immutableInput.brief,
    acceptanceCriteria: run.acceptanceCriteria,
    designSpec: run.designSpec,
    decisions: run.decisions.map(({ topic, value }) => ({ topic, value }))
  }).slice(0, 16_000);
}

function compactRunState(run: RunManifest): string {
  return JSON.stringify({
    runId: run.runId, kind: run.kind, stage: run.stage, status: run.status, interaction: run.interaction,
    brief: run.immutableInput.brief, requirements: run.normalizedRequirements, plan: run.plan, designSpec: run.designSpec,
    assumptions: run.assumptions, missingInformation: run.missingInformation,
    currentDecisions: run.decisions.filter((decision) => !decision.supersededAt), approvals: run.approvals,
    openDefects: run.defects.filter((defect) => defect.status === "open"), sourceChanges: run.sourceChanges.slice(-20),
    artifacts: run.artifacts.slice(-30), checkpoints: run.checkpoints.slice(-10), counters: run.counters,
    pendingQuestion: run.pendingQuestion, pendingQuestions: run.pendingQuestions
  }, null, 2);
}

async function changesDependencies(projectRoot: string, operations: UiPatchOperation[]): Promise<boolean> {
  const operation = operations.find((candidate) => candidate.path.replaceAll("\\", "/") === "package.json");
  if (!operation || operation.action === "create") return false;
  let before: string;
  try { before = await readFile(path.join(projectRoot, "package.json"), "utf8"); } catch { return false; }
  const after = operation.action === "replace" ? operation.content : operation.find !== undefined && operation.replace !== undefined ? before.replace(operation.find, operation.replace) : before;
  if (after === undefined) return false;
  try {
    const oldPackage = JSON.parse(before) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const newPackage = JSON.parse(after) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return JSON.stringify({ dependencies: oldPackage.dependencies ?? {}, devDependencies: oldPackage.devDependencies ?? {} }) !== JSON.stringify({ dependencies: newPackage.dependencies ?? {}, devDependencies: newPackage.devDependencies ?? {} });
  } catch { return true; }
}
