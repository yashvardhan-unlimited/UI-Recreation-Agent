import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inferWorkflowKind, latestResumableRun } from "../../src/launcher.js";
import { resolveLauncherSubmission } from "../../src/pi/launcher-ui.js";
import { RunStore } from "../../src/state/store.js";

describe("unified launcher", () => {
  it("infers work from one natural-language prompt and the current folder", async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), "ui-agent-launcher-empty-"));
    expect(await inferWorkflowKind("Build a portfolio site", empty)).toBe("create");

    const existing = await mkdtemp(path.join(os.tmpdir(), "ui-agent-launcher-existing-"));
    await writeFile(path.join(existing, "package.json"), "{}", "utf8");
    expect(await inferWorkflowKind("Polish the settings page", existing)).toBe("improve");
    expect(await inferWorkflowKind("Audit keyboard navigation", existing)).toBe("audit");
    expect(await inferWorkflowKind("Recreate this from a screenshot", existing)).toBe("recreate");
  });

  it("ignores agent metadata when deciding whether a folder is a new project", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ui-agent-launcher-metadata-"));
    await mkdir(path.join(root, ".ui-agent"));
    expect(await inferWorkflowKind("Create a landing page", root)).toBe("create");
  });

  it("offers the newest unfinished session for resume", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ui-agent-launcher-resume-"));
    const store = new RunStore(root);
    const older = await store.create({ kind: "create", brief: "old", projectRoot: root, interaction: "high" });
    const latest = await store.create({ kind: "improve", brief: "latest", projectRoot: root, interaction: "high" });
    expect(latestResumableRun([latest, older])?.runId).toBe(latest.runId);
    expect(latestResumableRun([{ ...latest, stage: "COMPLETE" }])).toBeUndefined();
  });

  it("accepts natural-language work or resumes from the launch composer", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ui-agent-launcher-composer-"));
    const previous = await new RunStore(root).create({ kind: "improve", brief: "old", projectRoot: root, interaction: "high" });

    expect(resolveLauncherSubmission("  Build a dashboard  ", previous)).toEqual({ kind: "prompt", prompt: "Build a dashboard" });
    expect(resolveLauncherSubmission("/resume", previous)).toEqual({ kind: "resume", runId: previous.runId });
    expect(resolveLauncherSubmission("   ", previous)).toBeUndefined();
  });
});
