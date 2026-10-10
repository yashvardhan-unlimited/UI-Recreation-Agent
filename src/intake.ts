import Type from "typebox";
import { prompt } from "./agents.js";
import { ask, type Usage } from "./llm.js";
import { loadPlan } from "./store.js";

export type Intent = { kind: "build" | "clone" | "edit" | "style" | "motion" | "audit"; targets: string[]; instruction: string; ref?: string };
const kinds = ["build", "clone", "edit", "style", "motion", "audit"] as const;
const Schema = Type.Object({ kind: Type.Union(kinds.map((k) => Type.Literal(k))), targets: Type.Array(Type.String()), instruction: Type.String({ minLength: 1 }) });

/** §5.1: rules first; only a request about an existing site reaches the intake model, which sees just section ids and headings. */
export async function intake(dir: string, request: string, ref?: string): Promise<{ intent: Intent; usage?: Usage }> {
  const withRef = ref === undefined ? {} : { ref };
  const plan = await loadPlan(dir);
  // With no site yet, a reference means clone and anything else means build.
  if (!plan) return { intent: { kind: ref === undefined ? "build" : "clone", targets: [], instruction: request, ...withRef } };
  const sections = plan.pages.flatMap((p) => p.sections);
  const list = sections.map((s) => `- ${s.id}: ${s.copy.split("\n")[0]!.slice(0, 80)}`).join("\n");
  const user = `## Sections\n${list}\n\n## Request\n${request}${ref === undefined ? "" : `\n\n## Attached reference\n${ref}`}`;
  const check = (v: Omit<Intent, "ref">) => {
    const unknown = v.targets.filter((t) => !sections.some((s) => s.id === t));
    return unknown.length ? `Unknown section ids: ${unknown.join(", ")}. Use ids from the list, or [] for the whole site.` : undefined;
  };
  const reply = await ask<Omit<Intent, "ref">>("intake", { system: await prompt("intake"), user: [user], schema: Schema, check });
  return { intent: { ...reply.value, ...withRef }, usage: reply.usage };
}
