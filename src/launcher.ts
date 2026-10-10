import { readdir } from "node:fs/promises";
import type { RunManifest } from "./state/schema.js";

export function latestResumableRun(runs: RunManifest[]): RunManifest | undefined {
  return runs.find((run) => run.stage !== "COMPLETE" && run.status !== "cancelled");
}

export async function inferWorkflowKind(prompt: string, projectRoot: string): Promise<RunManifest["kind"]> {
  const normalized = prompt.toLowerCase();
  if (/\b(recreate|replicate|clone|close[- ]?match)\b|\bfrom\s+(?:an?\s+)?(?:screenshot|image|reference|url|website)\b|\b(?:screenshot|mockup)\s+(?:as\s+)?(?:a\s+)?reference\b/.test(normalized)) return "recreate";

  const asksForAudit = /\b(audit|review|inspect|evaluate|assess|check)\b/.test(normalized);
  const asksForChanges = /\b(fix|improve|redesign|update|change|add|build|create|implement|repair|polish)\b/.test(normalized);
  if (asksForAudit && !asksForChanges) return "audit";

  return await hasExistingProject(projectRoot) ? "improve" : "create";
}

async function hasExistingProject(projectRoot: string): Promise<boolean> {
  try {
    const entries = await readdir(projectRoot, { withFileTypes: true });
    return entries.some((entry) => ![".git", ".ui-agent"].includes(entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
