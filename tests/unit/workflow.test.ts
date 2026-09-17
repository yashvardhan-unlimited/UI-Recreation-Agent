import { describe, expect, it } from "vitest";
import { approvalRequired, normalizeQuestionBatch } from "../../src/state/approval-policy.js";
import { evaluateStop, recordRevisedDecision, transitionRun } from "../../src/state/workflow.js";
import { runManifestSchema } from "../../src/state/schema.js";

function run() {
  return runManifestSchema.parse({ schemaVersion: 1, runId: "r", kind: "create", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), immutableInput: { brief: "b", references: [] }, projectRoot: "/p", runRoot: "/r", interaction: "high", status: "running", stage: "UNDERSTAND", counters: { repairRounds: 0, stagnantRounds: 0, retries: 0 } });
}

describe("bounded workflow and human policy", () => {
  it("accepts valid transitions and rejects invalid ones", () => {
    expect(transitionRun(run(), "PLAN").stage).toBe("PLAN");
    expect(() => transitionRun(run(), "CAPTURE")).toThrow(/Invalid workflow transition/);
  });

  it("covers successful, failed, cancelled, stalled, exhausted, and blocked stops", () => {
    const base = run();
    const budget = { elapsedMs: 1, maxElapsedMs: 10, maxRepairRounds: 3, maxStagnantRounds: 2, requiredGatesPass: false };
    expect(evaluateStop(base, { ...budget, requiredGatesPass: true }).status).toBe("ready_for_review");
    expect(evaluateStop(base, { ...budget, fatalError: true }).status).toBe("failed");
    expect(evaluateStop(base, { ...budget, cancelled: true }).status).toBe("cancelled");
    expect(evaluateStop({ ...base, counters: { ...base.counters, stagnantRounds: 2 } }, budget).reason).toBe("progress_stalled");
    expect(evaluateStop({ ...base, counters: { ...base.counters, repairRounds: 3 } }, budget).reason).toBe("repair_budget_exhausted");
    expect(evaluateStop(base, { ...budget, capabilityMissing: true }).status).toBe("blocked");
  });

  it("requires high-interaction checkpoints and persists revised decisions", () => {
    expect(approvalRequired("high", "information_architecture")).toBe(true);
    expect(approvalRequired("high", "image_search_query")).toBe(true);
    expect(approvalRequired("balanced", "image_search_query")).toBe(false);
    expect(approvalRequired("autonomous", "brief")).toBe(false);
    expect(approvalRequired("autonomous", "external_image")).toBe(true);
    const first = recordRevisedDecision(run(), { id: "d1", topic: "direction", value: "A", affectedScope: ["visual"], at: "2026-01-01T00:00:00.000Z" });
    const second = recordRevisedDecision(first, { id: "d2", topic: "direction", value: "B", affectedScope: ["visual"], at: "2026-01-02T00:00:00.000Z" });
    expect(second.decisions[0]?.supersededAt).toBeTruthy();
    expect(second.decisions[1]?.supersedes).toBe("d1");
    expect(() => normalizeQuestionBatch([{ id: "x", prompt: "?", options: ["one"] }])).toThrow();
  });

  it("does not let a positive visual opinion override a failing browser gate", () => {
    expect(evaluateStop(run(), { elapsedMs: 1, maxElapsedMs: 10, maxRepairRounds: 3, maxStagnantRounds: 2, requiredGatesPass: false }).stop).toBe(false);
  });
});
