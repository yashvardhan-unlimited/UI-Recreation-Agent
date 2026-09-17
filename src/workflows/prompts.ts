import type { RunManifest } from "../state/schema.js";
import { ROLE_PROMPTS } from "../pi/system-prompt.js";

export function initialWorkflowPrompt(run: RunManifest): string {
  const reference = run.immutableInput.referenceUrl ? `\nAuthorized URL candidate: ${run.immutableInput.referenceUrl}` : run.immutableInput.references.length ? `\nReference files: ${run.immutableInput.references.join(", ")}` : "";
  return `${ROLE_PROMPTS.analyst}\n\nBegin a ${run.kind} workflow for this immutable request:\n${run.immutableInput.brief}${reference}\n\nInteraction level: ${run.interaction}. First restate your understanding and material uncertainty. In high/balanced mode use the Pi-native ask_human and approve_direction tools before broad implementation. Persist the specification/plan and every workflow transition through the state tools. Then continue through the full bounded state machine using real project, build, browser, screenshot, visual, and quality evidence. Do not stop after a plan.`;
}

export function resumeWorkflowPrompt(run: RunManifest): string {
  return `Resume UI workflow ${run.runId} at ${run.stage}/${run.status}. Reload the structured run state, resolve pending input if available, then continue the bounded workflow. Preserve current user changes and never repeat completed approval gates.`;
}
