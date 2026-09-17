import { access, cp, mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/config/schema.js";
import { consoleLogger } from "../../src/utils/log.js";
import { RunStore } from "../../src/state/store.js";
import { startWorkflow } from "../../src/workflows/orchestrator.js";
import { runDoctor } from "../../src/doctor.js";
import { applyUiPatch } from "../../src/tools/files.js";
import { reactViteScaffold } from "../../src/templates/react-vite.js";

const enabled = process.env.UI_AGENT_LIVE_E2E === "1";

describe.skipIf(!enabled)("live Pi agent acceptance workflows", () => {
  it("creates a React project through the real Pi/model/tool/browser/repair loop", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ui-agent-live-workspace-"));
    const projectRoot = path.join(workspaceRoot, "robotics");
    const config = { ...defaultConfig, interaction: "autonomous" as const, quality: { ...defaultConfig.quality, lighthouse: { ...defaultConfig.quality.lighthouse, enabled: false } } };
    await runDoctor(config, workspaceRoot);
    const runId = await startWorkflow({
      kind: "create",
      brief: "Create a polished responsive robotics landing page with working navigation, an accessible inquiry interaction, restrained motion, deterministic mock content, and desktop/mobile verification.",
      projectRoot,
      workspaceRoot,
      config,
      logger: consoleLogger,
      interactive: false
    });
    const run = await new RunStore(workspaceRoot).load(runId);
    expect(["ready_for_review", "needs_work"]).toContain(run.status);
    expect(run.artifacts.some((artifact) => artifact.kind === "screenshot")).toBe(true);
    await access(path.join(projectRoot, "package.json"));
  }, 1_800_000);

  it("detects and repairs the deliberate responsive overflow fixture", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ui-agent-repair-workspace-"));
    const projectRoot = path.join(workspaceRoot, "layout-defect");
    await cp(path.join(process.cwd(), "fixtures", "projects", "layout-defect"), projectRoot, { recursive: true });
    const config = { ...defaultConfig, interaction: "autonomous" as const, quality: { ...defaultConfig.quality, lighthouse: { ...defaultConfig.quality.lighthouse, enabled: false } } };
    await runDoctor(config, workspaceRoot);
    const runId = await startWorkflow({ kind: "improve", brief: await readFile(path.join(process.cwd(), "fixtures", "briefs", "repair-layout.md"), "utf8"), projectRoot, workspaceRoot, config, logger: consoleLogger, interactive: false });
    const run = await new RunStore(workspaceRoot).load(runId);
    expect(run.sourceChanges.length).toBeGreaterThan(0);
    expect(run.defects.filter((defect) => defect.status === "open" && ["blocker", "high"].includes(defect.severity))).toHaveLength(0);
  }, 1_800_000);

  it("restyles from repository-owned desktop and mobile references", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ui-agent-reference-workspace-"));
    const projectRoot = path.join(workspaceRoot, "restyled");
    await mkdir(projectRoot);
    await applyUiPatch(projectRoot, reactViteScaffold());
    const config = { ...defaultConfig, interaction: "autonomous" as const, quality: { ...defaultConfig.quality, lighthouse: { ...defaultConfig.quality.lighthouse, enabled: false } } };
    await runDoctor(config, workspaceRoot);
    const runId = await startWorkflow({
      kind: "recreate", brief: "Inspired recreation using replacement copy and local artwork.", projectRoot, workspaceRoot, config, logger: consoleLogger, interactive: false,
      references: [path.join(process.cwd(), "fixtures", "references", "robotics-desktop.svg"), path.join(process.cwd(), "fixtures", "references", "robotics-mobile.svg")]
    });
    const run = await new RunStore(workspaceRoot).load(runId);
    expect(run.immutableInput.references).toHaveLength(2);
    expect(run.artifacts.some((artifact) => artifact.kind === "reference_analysis")).toBe(true);
  }, 1_800_000);

  it.runIf(Boolean(process.env.UI_AGENT_AUTHORIZED_URL))("analyzes only an explicitly supplied authorized public URL", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ui-agent-url-workspace-"));
    const projectRoot = path.join(workspaceRoot, "restyled");
    await mkdir(projectRoot);
    const config = { ...defaultConfig, interaction: "autonomous" as const, quality: { ...defaultConfig.quality, lighthouse: { ...defaultConfig.quality.lighthouse, enabled: false } } };
    await runDoctor(config, workspaceRoot);
    const runId = await startWorkflow({
      kind: "recreate",
      brief: "Extract the visible design system and recreate it with replacement copy and assets; do not copy proprietary code or media.",
      projectRoot,
      workspaceRoot,
      referenceUrl: process.env.UI_AGENT_AUTHORIZED_URL!,
      urlAuthorized: true,
      config,
      logger: consoleLogger,
      interactive: false
    });
    const run = await new RunStore(workspaceRoot).load(runId);
    expect(run.approvals.some((approval) => approval.kind === "url_authorization" && approval.approved)).toBe(true);
  }, 1_800_000);
});
