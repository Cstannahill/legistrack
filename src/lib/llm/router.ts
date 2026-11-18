import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getOpenRouterKeys } from "@/lib/openrouter-keys";
import { callGeminiStructured } from "@/lib/llm/gemini";
import {
  AllOpenRouterKeysExhaustedError,
  CategorizeOnlySchema,
  DEFAULT_OPENROUTER_MODELS,
  FallbackCapReachedError,
  GEMINI_FALLBACK_MODEL,
  type LlmBatchItemOutcome,
  type LlmCategoryInput,
  type LlmLegislationInput,
  type LlmRoutingOptions,
  SummaryAndCategoryBatchSchema,
  SummaryAndCategoryItemSchema,
  toJsonSchema,
} from "@/lib/llm/types";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MAX_INPUT_CHARS = 120_000;
const DEFAULT_GEMINI_MAX_INPUT_CHARS = 400_000;
const DEFAULT_OPENROUTER_TIMEOUT_MS = 60_000;

const KEY_AUTH_DISABLE_TTL_MS = 60 * 60 * 1000; // 1 hour for 401
const KEY_CREDIT_DISABLE_TTL_MS = 15 * 60 * 1000; // 15 min for 402
const PAIR_RATE_LIMIT_COOLDOWN_MS = 60 * 1000; // 60s for 429
const PAIR_TRANSIENT_COOLDOWN_MS = 30 * 1000; // 30s for 5xx/network/invalid JSON

const disabledKeys = new Map<string, number>();
const pairCooldowns = new Map<string, number>();

type ErrorClassification =
  | "key_disabled"
  | "model_error"
  | "rate_limit"
  | "transient";

function pairKey(apiKey: string, model: string): string {
  return `${apiKey}::${model}`;
}

function isKeyDisabled(apiKey: string, now: number): boolean {
  const until = disabledKeys.get(apiKey);
  if (until === undefined) return false;
  if (until <= now) {
    disabledKeys.delete(apiKey);
    return false;
  }
  return true;
}

function isPairCoolingDown(apiKey: string, model: string, now: number): boolean {
  const key = pairKey(apiKey, model);
  const until = pairCooldowns.get(key);
  if (until === undefined) return false;
  if (until <= now) {
    pairCooldowns.delete(key);
    return false;
  }
  return true;
}

function disableKey(apiKey: string, ttlMs: number, now: number): void {
  disabledKeys.set(apiKey, now + ttlMs);
}

function cooldownPair(
  apiKey: string,
  model: string,
  ttlMs: number,
  now: number
): void {
  pairCooldowns.set(pairKey(apiKey, model), now + ttlMs);
}

/**
 * Clears in-memory key disablement and `(key, model)` cooldown maps.
 * Intended for unit test isolation.
 */
export function resetOpenRouterRouterStateForTests(): void {
  disabledKeys.clear();
  pairCooldowns.clear();
}

/**
 * Resolves the ordered OpenRouter model cascade from `OPENROUTER_MODELS` CSV
 * or falls back to `DEFAULT_OPENROUTER_MODELS`.
 */
export function getConfiguredOpenRouterModels(
  envObj: Partial<NodeJS.ProcessEnv> = process.env
): string[] {
  const raw = envObj.OPENROUTER_MODELS?.trim();
  if (!raw) {
    return [...DEFAULT_OPENROUTER_MODELS];
  }

  const parsed = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );

  return parsed.length > 0 ? parsed : [...DEFAULT_OPENROUTER_MODELS];
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number
): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function getOpenRouterMaxInputChars(
  envObj: Partial<NodeJS.ProcessEnv> = process.env
): number {
  return parsePositiveInt(
    envObj.OPENROUTER_MAX_INPUT_CHARS,
    DEFAULT_OPENROUTER_MAX_INPUT_CHARS
  );
}

function getGeminiMaxInputChars(
  envObj: Partial<NodeJS.ProcessEnv> = process.env
): number {
  return parsePositiveInt(
    envObj.GEMINI_MAX_INPUT_CHARS,
    DEFAULT_GEMINI_MAX_INPUT_CHARS
  );
}

function getOpenRouterTimeoutMs(
  envObj: Partial<NodeJS.ProcessEnv> = process.env
): number {
  return parsePositiveInt(
    envObj.OPENROUTER_TIMEOUT_MS,
    DEFAULT_OPENROUTER_TIMEOUT_MS
  );
}

/**
 * Bounds legislative text safely to at most `maxChars`, preserving leading and
 * trailing context when truncation is required.
 */
export function truncateForPrompt(
  text: string | null | undefined,
  maxChars: number = getOpenRouterMaxInputChars()
): string {
  if (!text || text.trim().length === 0 || maxChars <= 0) {
    return "";
  }
  if (text.length <= maxChars) {
    return text;
  }
  if (maxChars < 100) {
    return text.slice(0, maxChars);
  }

  const marker = "\n\n[... truncated due to length ...]\n\n";
  const budget = maxChars - marker.length;
  const headLen = Math.ceil(budget * 0.75);
  const tailLen = budget - headLen;
  return `${text.slice(0, headLen)}${marker}${text.slice(text.length - tailLen)}`;
}

function getErrorStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const record = err as Record<string, unknown>;
  if (typeof record.status === "number") return record.status;
  if (typeof record.statusCode === "number") return record.statusCode;
  if (typeof record.response === "object" && record.response !== null) {
    const respStatus = (record.response as Record<string, unknown>).status;
    if (typeof respStatus === "number") return respStatus;
  }
  return undefined;
}

function classifyOpenRouterError(err: unknown): ErrorClassification {
  const status = getErrorStatus(err);
  if (status === 401 || status === 402) return "key_disabled";
  if (status === 400 || status === 404) return "model_error";
  if (status === 429) return "rate_limit";
  return "transient";
}

function extractJsonText(rawText: string): string {
  const trimmed = rawText.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }
  return trimmed;
}

function parseJsonStrict(rawText: string): unknown {
  return JSON.parse(extractJsonText(rawText));
}

function formatCategoriesForPrompt(categories: LlmCategoryInput[]): string {
  if (categories.length === 0) {
    return "(no categories configured - return an empty array [])";
  }
  return categories
    .map(
      (cat, idx) =>
        `${idx + 1}. slug: "${cat.slug}" | name: "${cat.name}"${
          cat.description ? ` - ${cat.description}` : ""
        }`
    )
    .join("\n");
}

function normalizeCategorySlugs(
  rawSlugs: string[],
  categories: LlmCategoryInput[]
): string[] {
  if (categories.length === 0 || rawSlugs.length === 0) {
    return [];
  }
  const slugLookup = new Map(
    categories.map((cat) => [cat.slug.trim().toLowerCase(), cat.slug])
  );
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of rawSlugs) {
    const canonical = slugLookup.get(raw.trim().toLowerCase());
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      normalized.push(canonical);
      if (normalized.length >= 3) break;
    }
  }

  return normalized;
}

export const SUMMARY_SYSTEM_INSTRUCTION =
  "You are an expert legislative analyst. Respond with strict valid JSON only matching the requested schema. Do not include markdown fences or commentary.";

const CATEGORIZE_SYSTEM_INSTRUCTION =
  "You are a legislative categorization engine. Respond with strict valid JSON only matching the requested schema. Do not include markdown fences or commentary.";

export function buildSingleSummaryPrompt(
  item: LlmLegislationInput,
  categories: LlmCategoryInput[],
  maxChars: number
): string {
  const boundedText =
    truncateForPrompt(item.text, maxChars) || "(no text provided)";

  return `Analyze and categorize the following legislative item.

Available Categories:
${formatCategoriesForPrompt(categories)}

Legislative Item:
- id: "${item.id}"
- kind: "${item.kind ?? "bill"}"
- title: ${item.title}
- text:
${boundedText}

Requirements:
1. Return a single JSON object with keys: "id", "summary", "keyPoints", "impactAreas", "categories", "confidence".
2. "id" MUST exactly equal "${item.id}".
3. "summary" MUST be a thorough plain-language summary of at least 20 words.
4. "keyPoints" MUST be an array of 3 to 5 concrete bullet strings.
5. "impactAreas" MUST be an array of affected groups, sectors, or institutions.
6. "categories" MUST contain 1 to 3 slugs selected ONLY from the Available Categories above (or [] if none are listed).
7. "confidence" MUST be a number between 0 and 1.

Return valid JSON only.`;
}

function buildBatchSummaryPrompt(
  items: LlmLegislationInput[],
  categories: LlmCategoryInput[],
  maxChars: number
): string {
  const perItemMaxChars = Math.max(1, Math.floor(maxChars / items.length));
  const renderedItems = items
    .map((item, idx) => {
      const boundedText =
        truncateForPrompt(item.text, perItemMaxChars) || "(no text provided)";
      return `--- ITEM ${idx + 1} ---
id: "${item.id}"
kind: "${item.kind ?? "bill"}"
title: ${item.title}
text:
${boundedText}`;
    })
    .join("\n\n");

  return `Analyze and categorize each legislative item below.

Available Categories:
${formatCategoriesForPrompt(categories)}

Legislative Items:
${renderedItems}

Requirements:
1. Return a JSON object with a single top-level key "items" containing an array with one entry per input item above.
2. Each entry MUST have keys: "id", "summary", "keyPoints", "impactAreas", "categories", "confidence".
3. Each entry's "id" MUST exactly match the input item's "id".
4. Each "summary" MUST be a thorough plain-language summary of at least 20 words.
5. Each "keyPoints" MUST be an array of 3 to 5 concise strings; "impactAreas" lists affected groups/sectors.
6. Each "categories" array MUST contain 1 to 3 slugs chosen ONLY from Available Categories above (or [] if none are listed).
7. "confidence" MUST be a number between 0 and 1.

Return valid JSON only.`;
}

function buildCategorizeOnlyPrompt(
  input: { title: string; summary: string; categories: LlmCategoryInput[] },
  maxChars: number
): string {
  const boundedSummary =
    truncateForPrompt(input.summary, maxChars) || input.title;

  return `Assign 1 to 3 category slugs to the following legislative item.

Title: ${input.title}
Summary:
${boundedSummary}

Available Categories:
${formatCategoriesForPrompt(input.categories)}

Requirements:
1. Return a JSON object with a single key "categories": ["slug-1", ...].
2. Select 1 to 3 slugs ONLY from the Available Categories list above.

Return valid JSON only.`;
}

function createOpenRouterClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    maxRetries: 0,
    timeout: getOpenRouterTimeoutMs(),
    defaultHeaders: {
      "HTTP-Referer": process.env.SITE_URL || "https://legistrack.vercel.app",
      "X-Title": "Legislation Tracker - AI Processing",
    },
  });
}

type CascadeOutcome<T> =
  | { ok: true; data: T; model: string }
  | { ok: false; errors: unknown[] };

async function runOpenRouterCascade<T>(opts: {
  systemInstruction: string;
  prompt: string;
  maxTokens: number;
  parseOutput: (rawContent: string, model: string) => T;
  cooldownOnParseFailure: boolean;
  models?: string[];
}): Promise<CascadeOutcome<T>> {
  const keys = getOpenRouterKeys();
  const models =
    opts.models && opts.models.length > 0
      ? opts.models
      : getConfiguredOpenRouterModels();

  if (keys.length === 0) {
    return {
      ok: false,
      errors: [
        new AllOpenRouterKeysExhaustedError(
          "No OpenRouter API keys configured",
          []
        ),
      ],
    };
  }

  const errors: unknown[] = [];
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: opts.systemInstruction },
    { role: "user", content: opts.prompt },
  ];

  for (const model of models) {
    const now = Date.now();
    const activeKeys = keys.filter((k) => !isKeyDisabled(k, now));
    if (activeKeys.length === 0) {
      break;
    }

    for (const apiKey of activeKeys) {
      if (isPairCoolingDown(apiKey, model, Date.now())) {
        continue;
      }

      let isOutputOrParseError = false;
      try {
        const client = createOpenRouterClient(apiKey);
        const completion = await client.chat.completions.create({
          model,
          messages,
          temperature: 0.2,
          max_tokens: opts.maxTokens,
          response_format: { type: "json_object" },
        });

        isOutputOrParseError = true;
        const content = completion.choices?.[0]?.message?.content;
        if (!content || !content.trim()) {
          throw new Error(`OpenRouter model "${model}" returned empty content`);
        }

        const data = opts.parseOutput(content, model);
        return { ok: true, data, model };
      } catch (err) {
        errors.push(err);
        const errTime = Date.now();

        if (isOutputOrParseError) {
          if (
            opts.cooldownOnParseFailure ||
            err instanceof BatchOutputMalformedError
          ) {
            cooldownPair(apiKey, model, PAIR_TRANSIENT_COOLDOWN_MS, errTime);
          }
          continue;
        }

        const classification = classifyOpenRouterError(err);

        if (classification === "key_disabled") {
          const status = getErrorStatus(err);
          disableKey(
            apiKey,
            status === 401
              ? KEY_AUTH_DISABLE_TTL_MS
              : KEY_CREDIT_DISABLE_TTL_MS,
            errTime
          );
          continue;
        }

        if (classification === "model_error") {
          break;
        }

        if (classification === "rate_limit") {
          cooldownPair(apiKey, model, PAIR_RATE_LIMIT_COOLDOWN_MS, errTime);
          continue;
        }

        // Transient 5xx or unstatused network/timeout error (e.g. APIConnectionError, ETIMEDOUT)
        cooldownPair(apiKey, model, PAIR_TRANSIENT_COOLDOWN_MS, errTime);
      }
    }
  }

  return { ok: false, errors };
}

class BatchOutputMalformedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BatchOutputMalformedError";
  }
}

async function callGeminiSingle(
  item: LlmLegislationInput,
  categories: LlmCategoryInput[]
): Promise<LlmBatchItemOutcome> {
  try {
    const geminiPrompt = buildSingleSummaryPrompt(
      item,
      categories,
      getGeminiMaxInputChars()
    );
    const geminiResult = await callGeminiStructured({
      systemInstruction: SUMMARY_SYSTEM_INSTRUCTION,
      prompt: geminiPrompt,
      schema: SummaryAndCategoryItemSchema,
      jsonSchema: toJsonSchema(SummaryAndCategoryItemSchema),
      itemIds: [item.id],
    });

    return {
      id: item.id,
      ok: true,
      summary: geminiResult.data.summary,
      keyPoints: geminiResult.data.keyPoints,
      impactAreas: geminiResult.data.impactAreas,
      categories: normalizeCategorySlugs(
        geminiResult.data.categories,
        categories
      ),
      confidence: geminiResult.data.confidence ?? null,
      aiModel: GEMINI_FALLBACK_MODEL,
    };
  } catch (err) {
    if (err instanceof FallbackCapReachedError) {
      throw err;
    }
    return {
      id: item.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function callGeminiBatch(
  items: LlmLegislationInput[],
  categories: LlmCategoryInput[]
): Promise<LlmBatchItemOutcome[]> {
  try {
    const geminiBatchPrompt = buildBatchSummaryPrompt(
      items,
      categories,
      getGeminiMaxInputChars()
    );
    const geminiResult = await callGeminiStructured({
      systemInstruction: SUMMARY_SYSTEM_INSTRUCTION,
      prompt: geminiBatchPrompt,
      schema: SummaryAndCategoryBatchSchema,
      jsonSchema: toJsonSchema(SummaryAndCategoryBatchSchema),
      itemIds: items.map((i) => i.id),
    });

    const byId = new Map<string, LlmBatchItemOutcome>();
    for (const parsed of geminiResult.data.items) {
      if (!byId.has(parsed.id)) {
        byId.set(parsed.id, {
          id: parsed.id,
          ok: true,
          summary: parsed.summary,
          keyPoints: parsed.keyPoints,
          impactAreas: parsed.impactAreas,
          categories: normalizeCategorySlugs(parsed.categories, categories),
          confidence: parsed.confidence ?? null,
          aiModel: GEMINI_FALLBACK_MODEL,
        });
      }
    }

    return items.map(
      (item) =>
        byId.get(item.id) ?? {
          id: item.id,
          ok: false,
          error: "Gemini batch response omitted item",
        }
    );
  } catch (err) {
    if (err instanceof FallbackCapReachedError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    return items.map((item) => ({
      id: item.id,
      ok: false,
      error: message,
    }));
  }
}

async function summarizeAndCategorizeSingle(
  item: LlmLegislationInput,
  categories: LlmCategoryInput[],
  opts?: LlmRoutingOptions
): Promise<LlmBatchItemOutcome> {
  if (opts?.provider === "gemini") {
    return callGeminiSingle(item, categories);
  }

  const openRouterPrompt = buildSingleSummaryPrompt(
    item,
    categories,
    getOpenRouterMaxInputChars()
  );

  const openRouterAttempt = await runOpenRouterCascade({
    systemInstruction: SUMMARY_SYSTEM_INSTRUCTION,
    prompt: openRouterPrompt,
    maxTokens: 2500,
    cooldownOnParseFailure: true,
    models: opts?.openRouterModels,
    parseOutput: (rawContent) => {
      const parsedJson = parseJsonStrict(rawContent);
      const validated = SummaryAndCategoryItemSchema.parse(parsedJson);
      if (validated.id !== item.id) {
        throw new Error(
          `Expected item id "${item.id}" but received "${validated.id}"`
        );
      }
      return validated;
    },
  });

  if (openRouterAttempt.ok) {
    const validated = openRouterAttempt.data;
    return {
      id: item.id,
      ok: true,
      summary: validated.summary,
      keyPoints: validated.keyPoints,
      impactAreas: validated.impactAreas,
      categories: normalizeCategorySlugs(validated.categories, categories),
      confidence: validated.confidence ?? null,
      aiModel: openRouterAttempt.model,
    };
  }

  if (opts?.allowGeminiFallback === false || opts?.provider === "openrouter") {
    const lastErr =
      openRouterAttempt.errors[openRouterAttempt.errors.length - 1];
    return {
      id: item.id,
      ok: false,
      error:
        lastErr instanceof Error
          ? lastErr.message
          : "OpenRouter summarization failed",
    };
  }

  return callGeminiSingle(item, categories);
}

function extractValidBatchOutcomes(
  rawContent: string,
  items: LlmLegislationInput[],
  categories: LlmCategoryInput[],
  model: string
): Map<string, LlmBatchItemOutcome> {
  let parsedJson: unknown;
  try {
    parsedJson = parseJsonStrict(rawContent);
  } catch (err) {
    throw new BatchOutputMalformedError(
      `Malformed batch JSON from ${model}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const rawArray = Array.isArray(parsedJson)
    ? parsedJson
    : typeof parsedJson === "object" &&
        parsedJson !== null &&
        Array.isArray((parsedJson as Record<string, unknown>).items)
      ? ((parsedJson as Record<string, unknown>).items as unknown[])
      : null;

  if (!rawArray) {
    throw new BatchOutputMalformedError(
      `Batch response from ${model} missing "items" array`
    );
  }

  const requestedIds = new Set(items.map((item) => item.id));
  const accepted = new Map<string, LlmBatchItemOutcome>();

  for (const element of rawArray) {
    const parsed = SummaryAndCategoryItemSchema.safeParse(element);
    if (!parsed.success) {
      continue;
    }
    if (!requestedIds.has(parsed.data.id) || accepted.has(parsed.data.id)) {
      continue;
    }
    accepted.set(parsed.data.id, {
      id: parsed.data.id,
      ok: true,
      summary: parsed.data.summary,
      keyPoints: parsed.data.keyPoints,
      impactAreas: parsed.data.impactAreas,
      categories: normalizeCategorySlugs(parsed.data.categories, categories),
      confidence: parsed.data.confidence ?? null,
      aiModel: model,
    });
  }

  if (accepted.size === 0) {
    throw new BatchOutputMalformedError(
      `Batch response from ${model} yielded no valid item outcomes`
    );
  }

  return accepted;
}

/**
 * Summarizes and categorizes one or more legislative items using the ordered
 * OpenRouter paid Flash cascade first, recovering missing or invalid batch items
 * individually via OpenRouter before falling back to a single guarded Gemini
 * 3.8 Flash call for all remaining items.
 */
export async function summarizeAndCategorizeItems(
  items: LlmLegislationInput[],
  categories: LlmCategoryInput[],
  options?: LlmRoutingOptions
): Promise<LlmBatchItemOutcome[]> {
  if (items.length === 0) {
    return [];
  }

  if (options?.provider === "gemini") {
    return items.length === 1
      ? [await callGeminiSingle(items[0], categories)]
      : callGeminiBatch(items, categories);
  }

  if (items.length === 1) {
    return [await summarizeAndCategorizeSingle(items[0], categories, options)];
  }

  const batchPrompt = buildBatchSummaryPrompt(
    items,
    categories,
    getOpenRouterMaxInputChars()
  );

  const openRouterBatch = await runOpenRouterCascade<
    Map<string, LlmBatchItemOutcome>
  >({
    systemInstruction: SUMMARY_SYSTEM_INSTRUCTION,
    prompt: batchPrompt,
    maxTokens: Math.min(8000, 1500 * items.length),
    cooldownOnParseFailure: false,
    models: options?.openRouterModels,
    parseOutput: (rawContent, model) =>
      extractValidBatchOutcomes(rawContent, items, categories, model),
  });

  const accepted = openRouterBatch.ok
    ? openRouterBatch.data
    : new Map<string, LlmBatchItemOutcome>();

  const missingAfterBatch = items.filter((item) => !accepted.has(item.id));
  const singleFailureReasons = new Map<string, string>();
  for (const missingItem of missingAfterBatch) {
    const recovered = await summarizeAndCategorizeSingle(
      missingItem,
      categories,
      {
        provider: "openrouter",
        openRouterModels: options?.openRouterModels,
        allowGeminiFallback: false,
      }
    );
    if (recovered.ok) {
      accepted.set(missingItem.id, recovered);
    } else {
      singleFailureReasons.set(missingItem.id, recovered.error);
    }
  }

  const allowGemini =
    options?.allowGeminiFallback !== false && options?.provider !== "openrouter";
  const stillMissing = items.filter((item) => !accepted.has(item.id));
  if (stillMissing.length > 0 && allowGemini) {
    const geminiOutcomes =
      stillMissing.length === 1
        ? [await callGeminiSingle(stillMissing[0], categories)]
        : await callGeminiBatch(stillMissing, categories);
    for (const outcome of geminiOutcomes) {
      accepted.set(outcome.id, outcome);
    }
  }

  return items.map(
    (item) =>
      accepted.get(item.id) ?? {
        id: item.id,
        ok: false,
        error:
          singleFailureReasons.get(item.id) ??
          (allowGemini
            ? "LLM response omitted item"
            : "OpenRouter summarization failed"),
      }
  );
}

/**
 * Categorizes a single legislative item using the OpenRouter paid Flash cascade
 * with guarded direct Gemini 3.8 Flash fallback (or an explicit routing override).
 */
export async function categorizeLegislationItem(
  input: {
    title: string;
    summary: string;
    categories: LlmCategoryInput[];
  },
  options?: LlmRoutingOptions
): Promise<{ categories: string[]; aiModel: string }> {
  if (input.categories.length === 0) {
    return { categories: [], aiModel: "none" };
  }

  if (options?.provider !== "gemini") {
    const openRouterPrompt = buildCategorizeOnlyPrompt(
      input,
      getOpenRouterMaxInputChars()
    );

    const openRouterAttempt = await runOpenRouterCascade({
      systemInstruction: CATEGORIZE_SYSTEM_INSTRUCTION,
      prompt: openRouterPrompt,
      maxTokens: 300,
      cooldownOnParseFailure: true,
      models: options?.openRouterModels,
      parseOutput: (rawContent) => {
        const parsedJson = parseJsonStrict(rawContent);
        return CategorizeOnlySchema.parse(parsedJson);
      },
    });

    if (openRouterAttempt.ok) {
      return {
        categories: normalizeCategorySlugs(
          openRouterAttempt.data.categories,
          input.categories
        ),
        aiModel: openRouterAttempt.model,
      };
    }

    if (
      options?.allowGeminiFallback === false ||
      options?.provider === "openrouter"
    ) {
      throw new AllOpenRouterKeysExhaustedError(
        "OpenRouter categorization failed",
        openRouterAttempt.errors
      );
    }
  }

  const geminiPrompt = buildCategorizeOnlyPrompt(
    input,
    getGeminiMaxInputChars()
  );
  const geminiResult = await callGeminiStructured({
    systemInstruction: CATEGORIZE_SYSTEM_INSTRUCTION,
    prompt: geminiPrompt,
    schema: CategorizeOnlySchema,
    jsonSchema: toJsonSchema(CategorizeOnlySchema),
    itemIds: [input.title.slice(0, 64) || "categorize"],
  });

  return {
    categories: normalizeCategorySlugs(
      geminiResult.data.categories,
      input.categories
    ),
    aiModel: GEMINI_FALLBACK_MODEL,
  };
}
