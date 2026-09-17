import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RunStore } from "../../src/state/store.js";

describe("run persistence and pending-input resume", () => {
  it("preserves immutable input and pending questions across reload", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ui-agent-store-"));
    const store = new RunStore(root);
    const run = await store.create({ kind: "create", brief: "immutable", projectRoot: root, interaction: "high" });
    await store.save({ ...run, status: "pending_input", pendingQuestion: { id: "direction", prompt: "Choose", options: ["A", "B"], createdAt: new Date().toISOString() } });
    const resumed = await store.load(run.runId);
    expect(resumed.immutableInput.brief).toBe("immutable");
    expect(resumed.pendingQuestion?.id).toBe("direction");
  });

  it("copies supplied references into immutable run artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ui-agent-refs-"));
    const source = path.join(root, "owned-reference.svg");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(source, "<svg xmlns='http://www.w3.org/2000/svg'/>", "utf8"));
    const store = new RunStore(root);
    const run = await store.create({ kind: "recreate", brief: "owned", projectRoot: root, interaction: "high", references: [source] });
    expect(run.immutableInput.references[0]).toContain(path.join(run.runRoot, "references"));
    expect(run.immutableInput.references[0]).not.toBe(source);
  });
});
