import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCheckpoint, restoreCheckpoint, selectBestCheckpoint } from "../../src/tools/checkpoint.js";
import { sha256 } from "../../src/tools/files.js";

describe("best checkpoint selection", () => {
  it("prioritizes functional gates before appearance scores", () => {
    const best = selectBestCheckpoint([
      { id: "pretty-broken", requiredGatesPass: false, blockerDefects: 0, highDefects: 0, designQuality: 100, accessibility: 100, performance: 100 },
      { id: "working", requiredGatesPass: true, blockerDefects: 0, highDefects: 1, designQuality: 70, accessibility: 90, performance: 80 },
      { id: "working-clean", requiredGatesPass: true, blockerDefects: 0, highDefects: 0, designQuality: 65, accessibility: 80, performance: 75 }
    ]);
    expect(best?.id).toBe("working-clean");
  });

  it("restores only agent-owned checkpoints and refuses unrecognized user changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ui-agent-checkpoint-"));
    const projectRoot = path.join(root, "project");
    const runRoot = path.join(root, "run");
    await mkdir(projectRoot);
    const file = path.join(projectRoot, "App.tsx");
    await writeFile(file, "original");
    await writeFile(path.join(projectRoot, ".env"), "MODEL_SECRET=never-copy");
    const checkpoint = await createCheckpoint(projectRoot, runRoot);
    expect(checkpoint.files).toBe(1);
    await writeFile(file, "agent edit");
    await expect(restoreCheckpoint({ projectRoot, checkpointRoot: path.join(runRoot, "checkpoints"), checkpointPath: checkpoint.path, expectedCurrentHashes: {} })).rejects.toMatchObject({ code: "CONFLICT" });
    await restoreCheckpoint({ projectRoot, checkpointRoot: path.join(runRoot, "checkpoints"), checkpointPath: checkpoint.path, expectedCurrentHashes: { "App.tsx": sha256(Buffer.from("agent edit")) } });
    expect(await readFile(file, "utf8")).toBe("original");
    await expect(restoreCheckpoint({ projectRoot, checkpointRoot: path.join(runRoot, "checkpoints"), checkpointPath: root, expectedCurrentHashes: {} })).rejects.toMatchObject({ code: "PATH_OUTSIDE_PROJECT" });
  });
});
