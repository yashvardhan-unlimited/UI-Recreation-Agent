import type { InteractionLevel } from "../config/schema.js";
import type { RunManifest } from "./schema.js";

export type MaterialAction = RunManifest["approvals"][number]["kind"];

export function approvalRequired(level: InteractionLevel, action: MaterialAction): boolean {
  const always = new Set<MaterialAction>(["external_image", "dependency_change", "replacement", "close_match", "design_deviation", "repair_escalation", "url_authorization"]);
  if (action === "image_search_query") return level === "high";
  if (always.has(action)) return true;
  if (level === "high") return true;
  if (level === "balanced") return ["brief", "information_architecture", "design_direction"].includes(action);
  return false;
}

export function hasApproval(run: RunManifest, action: MaterialAction, summaryIncludes?: string): boolean {
  return [...run.approvals].reverse().some((approval) => approval.kind === action && approval.approved && (!summaryIncludes || approval.summary.includes(summaryIncludes)));
}

export function normalizeQuestionBatch(questions: Array<{ id: string; prompt: string; options: string[] }>): Array<{ id: string; prompt: string; options: string[] }> {
  if (questions.length === 0 || questions.length > 4) throw new Error("Ask 1–4 focused questions per batch.");
  const ids = new Set<string>();
  for (const question of questions) {
    if (ids.has(question.id)) throw new Error(`Duplicate question id: ${question.id}`);
    ids.add(question.id);
    if (question.options.length < 2 || question.options.length > 4) throw new Error(`Question ${question.id} must have 2–4 choices.`);
  }
  return questions;
}
