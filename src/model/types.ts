import { z } from "zod";

export const ollamaModelSchema = z.object({
  name: z.string(),
  model: z.string(),
  modified_at: z.string(),
  size: z.number(),
  digest: z.string(),
  details: z.object({
    parent_model: z.string().optional().default(""),
    format: z.string().optional(),
    family: z.string().optional(),
    families: z.array(z.string()).optional(),
    parameter_size: z.string().optional(),
    quantization_level: z.string().optional(),
    context_length: z.number().optional(),
    embedding_length: z.number().optional()
  }).passthrough(),
  capabilities: z.array(z.string()).optional().default([])
});

export const ollamaTagsSchema = z.object({ models: z.array(ollamaModelSchema) });
export type OllamaModel = z.infer<typeof ollamaModelSchema>;

export const openAiModelsSchema = z.object({
  object: z.literal("list").optional(),
  data: z.array(z.object({ id: z.string(), object: z.string().optional(), created: z.number().optional(), owned_by: z.string().optional() }))
});

export type CapabilityName = "text" | "tools" | "structured_json" | "vision_single" | "vision_compare";

export interface CapabilityEvidence {
  capability: CapabilityName;
  passed: boolean;
  latencyMs: number;
  modelId: string;
  endpoint: string;
  evidence: string;
  error?: string;
}

export interface SelectedModels {
  coding: OllamaModel;
  visual?: OllamaModel;
}

export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<Record<string, unknown>> | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}
