import type { RunManifest, WorkflowStage } from "./schema.js";

const transitions: Record<WorkflowStage, WorkflowStage[]> = {
  UNDERSTAND: ["PLAN"],
  PLAN: ["IMPLEMENT"],
  IMPLEMENT: ["BUILD"],
  BUILD: ["RUN", "IMPLEMENT"],
  RUN: ["EXERCISE", "IMPLEMENT"],
  EXERCISE: ["CAPTURE", "REPAIR"],
  CAPTURE: ["REVIEW"],
  REVIEW: ["REPAIR", "VERIFY"],
  REPAIR: ["BUILD"],
  VERIFY: ["REPAIR", "COMPLETE"],
  COMPLETE: []
};

export function canTransition(from: WorkflowStage, to: WorkflowStage): boolean {
  return transitions[from].includes(to);
}

export function transitionRun(run: RunManifest, to: WorkflowStage): RunManifest {
  if (!canTransition(run.stage, to)) throw new Error(`Invalid workflow transition: ${run.stage} -> ${to}`);
  return { ...run, stage: to, updatedAt: new Date().toISOString() };
}

export function chooseFinalStatus(run: RunManifest, options: { requiredGatesPass: boolean; capabilityMissing?: boolean; cancelled?: boolean; failed?: boolean; budgetExhausted?: boolean }): RunManifest["status"] {
  if (options.cancelled) return "cancelled";
  if (options.failed) return "failed";
  if (options.capabilityMissing) return "blocked";
  const severeOpen = run.defects.some((defect) => defect.status === "open" && (defect.severity === "blocker" || defect.severity === "high"));
  if (options.requiredGatesPass && !severeOpen) return "ready_for_review";
  if (options.budgetExhausted || severeOpen) return "needs_work";
  return "needs_work";
}

export function evaluateStop(run: RunManifest, budget: { elapsedMs: number; maxElapsedMs: number; maxRepairRounds: number; maxStagnantRounds: number; requiredGatesPass: boolean; capabilityMissing?: boolean; cancelled?: boolean; fatalError?: boolean }): { stop: boolean; status?: RunManifest["status"]; reason?: string } {
  if (budget.cancelled) return { stop: true, status: "cancelled", reason: "user_cancelled" };
  if (budget.fatalError) return { stop: true, status: "failed", reason: "fatal_error" };
  if (budget.capabilityMissing) return { stop: true, status: "blocked", reason: "required_capability_missing" };
  const severeOpen = run.defects.some((defect) => defect.status === "open" && ["blocker", "high"].includes(defect.severity));
  if (budget.requiredGatesPass && !severeOpen) return { stop: true, status: "ready_for_review", reason: "quality_gates_passed" };
  if (budget.elapsedMs >= budget.maxElapsedMs) return { stop: true, status: "needs_work", reason: "elapsed_budget_exhausted" };
  if (run.counters.repairRounds >= budget.maxRepairRounds) return { stop: true, status: "needs_work", reason: "repair_budget_exhausted" };
  if (run.counters.stagnantRounds >= budget.maxStagnantRounds) return { stop: true, status: "needs_work", reason: "progress_stalled" };
  return { stop: false };
}

export function recordRevisedDecision(run: RunManifest, input: { topic: string; value: unknown; affectedScope: string[]; id: string; at: string }): RunManifest {
  const previous = [...run.decisions].reverse().find((decision) => decision.topic === input.topic && !decision.supersededAt);
  const decisions = run.decisions.map((decision) => previous && decision.id === previous.id ? { ...decision, supersededAt: input.at } : decision);
  decisions.push({ id: input.id, topic: input.topic, value: input.value, affectedScope: input.affectedScope, decidedAt: input.at, ...(previous ? { supersedes: previous.id } : {}) });
  return { ...run, decisions };
}
