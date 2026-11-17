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
  confidence: z.number().min(0).max(1).optional(),
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

/**
 * Converts a Zod schema into a plain JSON Schema object compatible with
 * Gemini `interactions.create` (`response_format.schema`) and OpenRouter JSON schemas.
 */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { unrepresentable: "any" }) as Record<
    string,
    unknown
  >;
  const rest = { ...raw };
  delete rest.$schema;
  return rest;
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
