import { z } from "zod";

export const DEFAULT_OPENROUTER_MODELS = [
  "deepseek/deepseek-v4.1-flash-1017",
  "xiaomi/mimo-v2.6-flash",
  "z-ai/glm-5.3-flash",
] as const;

export const GEMINI_FALLBACK_MODEL = "gemini-3.8-flash" as const;

export const GEMINI_FALLBACK_JOB_NAME =
  `llm-fallback:${GEMINI_FALLBACK_MODEL}` as const;

export type SummaryProvider = "openai" | "anthropic" | "openrouter";

export interface LlmCategoryInput {
  id?: string;
  slug: string;
  name: string;
  description?: string | null;
}

export interface LlmLegislationInput {
  id: string;
  title: string;
  text: string | null;
  kind?: "bill" | "executiveOrder";
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

export const SummaryAndCategoryItemSchema = z.object({
  id: z.string().min(1),
  summary: z
    .string()
    .trim()
    .refine((value) => countWords(value) >= 20, {
      message: "Summary must be at least 20 words",
    }),
  keyPoints: z.array(z.string().trim().min(1)).default([]),
  impactAreas: z.array(z.string().trim().min(1)).default([]),
  categories: z.array(z.string().trim().min(1)).max(3).default([]),
  confidence: z.number().min(0).max(1).nullish(),
});

export const SummaryAndCategoryResultSchema = SummaryAndCategoryItemSchema;
export const BatchSummaryItemSchema = SummaryAndCategoryItemSchema;

export const SummaryAndCategoryBatchSchema = z.object({
  items: z.array(SummaryAndCategoryItemSchema),
});

export const CategorizeOnlySchema = z.object({
  categories: z.array(z.string().trim().min(1)).max(3),
});

export type BatchSummaryOutputItem = z.infer<
  typeof SummaryAndCategoryItemSchema
>;

export type SummaryAndCategoryPayload = Omit<BatchSummaryOutputItem, "id"> & {
  aiModel: string;
};

export type CategorizeOnlyPayload = z.infer<typeof CategorizeOnlySchema>;

export type LlmBatchItemOutcome =
  | ({ id: string; ok: true } & SummaryAndCategoryPayload)
  | { id: string; ok: false; error: string };

function normalizeStrictJsonSchemaNode(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => normalizeStrictJsonSchemaNode(item));
  }
  if (typeof node !== "object" || node === null) {
    return node;
  }

  const record = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (key === "$schema" || key === "default") {
      continue;
    }
    if (
      key === "properties" &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      const normalizedProps: Record<string, unknown> = {};
      for (const [propKey, propSchema] of Object.entries(
        value as Record<string, unknown>
      )) {
        normalizedProps[propKey] = normalizeStrictJsonSchemaNode(propSchema);
      }
      out.properties = normalizedProps;
      continue;
    }
    if (
      (key === "$defs" || key === "definitions") &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      const normalizedDefs: Record<string, unknown> = {};
      for (const [defKey, defSchema] of Object.entries(
        value as Record<string, unknown>
      )) {
        normalizedDefs[defKey] = normalizeStrictJsonSchemaNode(defSchema);
      }
      out[key] = normalizedDefs;
      continue;
    }
    out[key] = normalizeStrictJsonSchemaNode(value);
  }

  if (
    out.type === "object" &&
    typeof out.properties === "object" &&
    out.properties !== null &&
    !Array.isArray(out.properties)
  ) {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as Record<string, unknown>);
  }

  return out;
}

/**
 * Converts a Zod schema into a strict JSON Schema object compatible with
 * Gemini `interactions.create` (`response_format.schema`) and OpenAI/OpenRouter `strict: true`
 * (every property listed in `required`, `additionalProperties: false`, no `$schema` or `default`).
 */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { unrepresentable: "any" });
  return normalizeStrictJsonSchemaNode(raw) as Record<string, unknown>;
}

export type FallbackCapReason =
  | "daily-cap-reached"
  | "disabled"
  | "missing-api-key";

export class FallbackCapReachedError extends Error {
  readonly reason: FallbackCapReason;
  readonly used?: number;
  readonly limit?: number;

  constructor(
    message = "Gemini fallback unavailable or daily cap reached",
    details?: { reason?: FallbackCapReason; used?: number; limit?: number }
  ) {
    super(message);
    this.name = "FallbackCapReachedError";
    this.reason = details?.reason ?? "daily-cap-reached";
    this.used = details?.used;
    this.limit = details?.limit;
  }
}

export class AllOpenRouterKeysExhaustedError extends Error {
  readonly causeErrors: unknown[];

  constructor(
    message = "All OpenRouter API keys and models failed or are exhausted",
    causeErrors: unknown[] = []
  ) {
    super(message);
    this.name = "AllOpenRouterKeysExhaustedError";
    this.causeErrors = causeErrors;
  }
}
