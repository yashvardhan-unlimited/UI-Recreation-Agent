import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DoctorReport } from "../doctor.js";
import type { AppConfig } from "../config/schema.js";
import { ensureTrailingSlash } from "./discovery.js";

export async function loadLatestDoctorReport(workspaceRoot: string): Promise<DoctorReport | undefined> {
  try {
    return JSON.parse(await readFile(path.join(workspaceRoot, ".ui-agent", "doctor", "latest.json"), "utf8")) as DoctorReport;
  } catch {
    return undefined;
  }
}

export function hasPassingCheck(report: DoctorReport | undefined, name: string, modelId?: string): boolean {
  return report?.checks.some((check) => check.name === name && check.status === "PASS" && (!modelId || check.modelId === modelId)) ?? false;
}

export function verifiedVisualModel(report: DoctorReport | undefined, candidateId?: string): string | undefined {
  if (!report || !candidateId) return undefined;
  return hasPassingCheck(report, "vision_single", candidateId) && hasPassingCheck(report, "vision_compare", candidateId) ? candidateId : undefined;
}

export function doctorMatchesConfig(report: DoctorReport | undefined, config: AppConfig, codingModelId: string, maximumAgeMs = 24 * 60 * 60_000): boolean {
  if (!report || report.selectedCodingModel !== codingModelId) return false;
  if (Date.now() - Date.parse(report.createdAt) > maximumAgeMs) return false;
  const discovery = report.checks.find((check) => check.name === "discovery" && check.status === "PASS");
  const inference = report.checks.find((check) => check.name === "inference_endpoint" && check.status === "PASS");
  return discovery?.testedUrl === config.model.discoveryUrl && inference?.testedUrl === new URL("models", ensureTrailingSlash(config.model.inferenceBaseUrl)).toString();
}
