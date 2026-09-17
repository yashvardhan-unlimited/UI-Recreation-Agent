import { z } from "zod";
import { interactionLevelSchema } from "../config/schema.js";

export const runStatusSchema = z.enum(["pending_input", "running", "ready_for_review", "needs_work", "blocked", "failed", "cancelled"]);
export const workflowStageSchema = z.enum(["UNDERSTAND", "PLAN", "IMPLEMENT", "BUILD", "RUN", "EXERCISE", "CAPTURE", "REVIEW", "REPAIR", "VERIFY", "COMPLETE"]);
export const severitySchema = z.enum(["blocker", "high", "medium", "low"]);

export const defectSchema = z.object({
  id: z.string(),
  severity: severitySchema,
  page: z.string(),
  viewport: z.string(),
  interactionState: z.string(),
  evidence: z.array(z.string()),
  observedProblem: z.string(),
  likelySource: z.string().optional(),
  proposedRepair: z.string(),
  verificationMethod: z.string(),
  status: z.enum(["open", "fixed", "accepted", "superseded"]).default("open")
});

export const decisionSchema = z.object({
  id: z.string(),
  topic: z.string(),
  value: z.unknown(),
  affectedScope: z.array(z.string()).default([]),
  decidedAt: z.string().datetime(),
  supersedes: z.string().optional(),
  supersededAt: z.string().datetime().optional()
});

export const approvalSchema = z.object({
  id: z.string(),
  kind: z.enum(["brief", "information_architecture", "design_direction", "image_search_query", "external_image", "dependency_change", "replacement", "close_match", "design_deviation", "repair_escalation", "url_authorization"]),
  approved: z.boolean(),
  summary: z.string(),
  at: z.string().datetime()
});

export const runManifestSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string(),
  kind: z.enum(["create", "improve", "recreate", "audit"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  immutableInput: z.object({
    brief: z.string(),
    references: z.array(z.string()).default([]),
    referenceUrl: z.string().url().optional()
  }),
  projectRoot: z.string(),
  runRoot: z.string(),
  interaction: interactionLevelSchema,
  status: runStatusSchema,
  stage: workflowStageSchema,
  stopReason: z.string().optional(),
  normalizedRequirements: z.record(z.string(), z.unknown()).default({}),
  plan: z.array(z.object({ id: z.string(), description: z.string(), status: z.enum(["pending", "in_progress", "complete", "blocked"]) })).default([]),
  designSpec: z.record(z.string(), z.unknown()).default({}),
  acceptanceCriteria: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  missingInformation: z.array(z.string()).default([]),
  pendingQuestion: z.object({
    id: z.string(),
    prompt: z.string(),
    options: z.array(z.string()),
    createdAt: z.string().datetime()
  }).optional(),
  pendingQuestions: z.array(z.object({
    id: z.string(),
    prompt: z.string(),
    options: z.array(z.string()),
    createdAt: z.string().datetime()
  })).default([]),
  decisions: z.array(decisionSchema).default([]),
  approvals: z.array(approvalSchema).default([]),
  defects: z.array(defectSchema).default([]),
  artifacts: z.array(z.object({ kind: z.string(), path: z.string(), createdAt: z.string().datetime(), metadata: z.record(z.string(), z.unknown()).default({}) })).default([]),
  checkpoints: z.array(z.object({ id: z.string(), path: z.string(), at: z.string().datetime(), summary: z.string(), score: z.number().optional(), verified: z.boolean() })).default([]),
  sourceChanges: z.array(z.object({ at: z.string().datetime(), summary: z.string(), files: z.array(z.string()) })).default([]),
  model: z.object({ provider: z.string(), codingModelId: z.string(), visualModelId: z.string().optional(), protocol: z.string(), endpoint: z.string() }).optional(),
  piSessionFile: z.string().optional(),
  counters: z.object({ repairRounds: z.number().int().nonnegative(), stagnantRounds: z.number().int().nonnegative(), retries: z.number().int().nonnegative() }),
  durationsMs: z.record(z.string(), z.number().nonnegative()).default({})
});

export type RunManifest = z.infer<typeof runManifestSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type WorkflowStage = z.infer<typeof workflowStageSchema>;
export type Defect = z.infer<typeof defectSchema>;
