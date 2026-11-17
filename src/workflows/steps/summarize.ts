import type { Prisma } from "@prisma/client";
import { RetryableError } from "workflow";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  categorizeLegislationItem,
  summarizeAndCategorizeItems,
} from "@/lib/llm/router";
import {
  FallbackCapReachedError,
  SummaryAndCategoryItemSchema,
  type LlmBatchItemOutcome,
  type LlmCategoryInput,
  type LlmLegislationInput,
} from "@/lib/llm/types";

function getPersistedSummaryOutcomeSchema() {
  return z.object({
    ...SummaryAndCategoryItemSchema.shape,
    categories: z.array(z.string().trim().min(1)).default([]),
  });
}

function getPersistedCategoriesSchema() {
  return z.object({
    categories: z.array(z.string().trim().min(1)),
  });
}

const DEFAULT_BILL_BATCH_SIZE = 5;
const DEFAULT_EO_BATCH_SIZE = 5;
const DEFAULT_SUMMARIZE_BATCH_SIZE = 3;
const DEFAULT_LLM_MAX_ATTEMPTS = 5;
const MAX_CATEGORIES_PER_ITEM = 3;

export type LegislationKind = "bill" | "executiveOrder";

export interface CategoryChoice extends LlmCategoryInput {
  id: string;
}

export interface SummarizeWorkItem {
  id: string;
  kind: LegislationKind;
  title: string;
  fullText: string;
  hasStandardSummary: boolean;
  standardSummaryText: string | null;
  hasCategories: boolean;
}

export interface SummarizeWorkBatch {
  categories: CategoryChoice[];
  items: SummarizeWorkItem[];
  billCount: number;
  executiveOrderCount: number;
}

export interface SummarizeItemError {
  id: string;
  kind: LegislationKind;
  error: string;
  deadLetterAttempts?: number;
}

export interface SummarizeBatchOutcome {
  attempted: number;
  persisted: number;
  summarized: number;
  categorized: number;
  failed: number;
  deadLettered: number;
  errors: SummarizeItemError[];
}

export interface SelectWorkBatchOptions {
  billBatchSize?: number;
  eoBatchSize?: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseNonNegativeInt(
  value: number | undefined,
  fallback: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

function isFallbackCapReachedError(err: unknown): boolean {
  return (
    err instanceof FallbackCapReachedError ||
    (err instanceof Error && err.name === "FallbackCapReachedError")
  );
}

function toRetryableCapacityError(err: unknown): RetryableError {
  const message =
    err instanceof Error && err.message
      ? err.message
      : "OpenRouter exhausted and Gemini daily fallback cap reached";
  return new RetryableError(message, { retryAfter: "30m" });
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const safeSize = Math.max(1, size);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += safeSize) {
    chunks.push(items.slice(i, i + safeSize));
  }
  return chunks;
}

function resolveCategoryConnectIds(
  slugs: string[],
  categories: CategoryChoice[]
): Array<{ id: string }> {
  if (categories.length === 0 || slugs.length === 0) {
    return [];
  }

  const bySlug = new Map(
    categories
      .filter((cat) => typeof cat.id === "string" && cat.id.length > 0)
      .map((cat) => [cat.slug.trim().toLowerCase(), cat.id])
  );

  const seen = new Set<string>();
  const connectIds: Array<{ id: string }> = [];

  for (const slug of slugs) {
    const id = bySlug.get(slug.trim().toLowerCase());
    if (id && !seen.has(id)) {
      seen.add(id);
      connectIds.push({ id });
      if (connectIds.length >= MAX_CATEGORIES_PER_ITEM) {
        break;
      }
    }
  }

  return connectIds;
}

function getDeadLetterTargetWhere(item: SummarizeWorkItem): {
  billId?: string;
  executiveOrderId?: string;
} {
  return item.kind === "bill"
    ? { billId: item.id }
    : { executiveOrderId: item.id };
}

async function findExistingStandardSummary(
  item: SummarizeWorkItem
): Promise<{ id: string; content: string } | null> {
  if (typeof db.summary?.findFirst !== "function") {
    return null;
  }

  const existing = await db.summary.findFirst({
    where: {
      ...getDeadLetterTargetWhere(item),
      summaryType: "STANDARD",
    },
    select: { id: true, content: true },
  });

  return existing ?? null;
}

async function connectItemCategories(
  item: SummarizeWorkItem,
  categoryConnectIds: Array<{ id: string }>
): Promise<void> {
  if (categoryConnectIds.length === 0) {
    return;
  }

  if (item.kind === "bill") {
    await db.bill.update({
      where: { id: item.id },
      data: {
        categories: {
          connect: categoryConnectIds,
        },
      },
    });
    return;
  }

  await db.executiveOrder.update({
    where: { id: item.id },
    data: {
      categories: {
        connect: categoryConnectIds,
      },
    },
  });
}

async function recordDeadLetterAttempt(
  item: SummarizeWorkItem,
  errorMessage: string
): Promise<number> {
  const targetWhere = getDeadLetterTargetWhere(item);
  const existing = await db.deadLetter.findFirst({
    where: {
      ...targetWhere,
      processed: false,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, attempts: true },
  });

  const payload: Prisma.InputJsonValue = {
    id: item.id,
    kind: item.kind,
    title: item.title,
    hasStandardSummary: item.hasStandardSummary,
    hasCategories: item.hasCategories,
  };

  if (existing) {
    const nextAttempts = (existing.attempts ?? 0) + 1;
    await db.deadLetter.update({
      where: { id: existing.id },
      data: {
        payload,
        errorMessage,
        attempts: nextAttempts,
        lastAttemptAt: new Date(),
      },
    });
    return nextAttempts;
  }

  await db.deadLetter.create({
    data: {
      payload,
      errorMessage,
      attempts: 1,
      billId: item.kind === "bill" ? item.id : null,
      executiveOrderId: item.kind === "executiveOrder" ? item.id : null,
      lastAttemptAt: new Date(),
      processed: false,
    },
  });

  return 1;
}

async function markDeadLetterProcessedIfAny(
  item: SummarizeWorkItem
): Promise<void> {
  if (typeof db.deadLetter?.findFirst !== "function") {
    return;
  }

  const existing = await db.deadLetter.findFirst({
    where: {
      ...getDeadLetterTargetWhere(item),
      processed: false,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (!existing) {
    return;
  }

  await db.deadLetter.update({
    where: { id: existing.id },
    data: {
      processed: true,
      processedAt: new Date(),
    },
  });
}

async function recordItemFailure(
  item: SummarizeWorkItem,
  errorMessage: string,
  outcomeCounters: SummarizeBatchOutcome
): Promise<void> {
  let deadLetterAttempts: number | undefined;
  try {
    deadLetterAttempts = await recordDeadLetterAttempt(item, errorMessage);
    outcomeCounters.deadLettered += 1;
  } catch (dlErr) {
    console.warn(
      `[summarize] Failed to record DeadLetter for ${item.kind} ${item.id}:`,
      dlErr
    );
  }

  outcomeCounters.failed += 1;
  outcomeCounters.errors.push({
    id: item.id,
    kind: item.kind,
    error: errorMessage,
    ...(deadLetterAttempts !== undefined ? { deadLetterAttempts } : {}),
  });
}

async function persistCombinedOutcome(
  item: SummarizeWorkItem,
  llmOutcome: LlmBatchItemOutcome | undefined,
  categories: CategoryChoice[],
  outcomeCounters: SummarizeBatchOutcome
): Promise<void> {
  if (!llmOutcome) {
    await recordItemFailure(
      item,
      "LLM response omitted item outcome",
      outcomeCounters
    );
    return;
  }

  if (!llmOutcome.ok) {
    await recordItemFailure(
      item,
      llmOutcome.error || "LLM summarization failed",
      outcomeCounters
    );
    return;
  }

  const parsed = getPersistedSummaryOutcomeSchema().safeParse({
    id: llmOutcome.id,
    summary: llmOutcome.summary,
    keyPoints: llmOutcome.keyPoints,
    impactAreas: llmOutcome.impactAreas,
    categories: llmOutcome.categories,
    confidence: llmOutcome.confidence,
  });

  if (!parsed.success) {
    const issueMessage = parsed.error.issues
      .map((issue) => issue.message)
      .join("; ");
    await recordItemFailure(
      item,
      `Validation failed: ${issueMessage || "invalid summary payload"}`,
      outcomeCounters
    );
    return;
  }

  try {
    await db.summary.create({
      data: {
        billId: item.kind === "bill" ? item.id : null,
        executiveOrderId: item.kind === "executiveOrder" ? item.id : null,
        summaryType: "STANDARD",
        content: parsed.data.summary,
        keyPoints: parsed.data.keyPoints,
        impactAreas: parsed.data.impactAreas,
        aiModel: llmOutcome.aiModel,
        confidence: parsed.data.confidence ?? null,
        generatedAt: new Date(),
      },
      select: { id: true },
    });

    outcomeCounters.summarized += 1;

    let appliedCategories = false;
    if (!item.hasCategories) {
      const connectIds = resolveCategoryConnectIds(
        parsed.data.categories,
        categories
      );
      if (connectIds.length > 0) {
        await connectItemCategories(item, connectIds);
        outcomeCounters.categorized += 1;
        appliedCategories = true;
      }
    }

    outcomeCounters.persisted += 1;
    if (appliedCategories || item.hasCategories) {
      await markDeadLetterProcessedIfAny(item);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordItemFailure(item, message, outcomeCounters);
  }
}

async function processSingleSummarizeItem(
  item: SummarizeWorkItem,
  categories: CategoryChoice[],
  outcomeCounters: SummarizeBatchOutcome
): Promise<void> {
  const input: LlmLegislationInput = {
    id: item.id,
    title: item.title,
    text: item.fullText,
    kind: item.kind,
  };

  let outcomes: LlmBatchItemOutcome[];
  try {
    outcomes = await summarizeAndCategorizeItems([input], categories);
  } catch (err) {
    if (isFallbackCapReachedError(err)) {
      throw toRetryableCapacityError(err);
    }
    const message = err instanceof Error ? err.message : String(err);
    await recordItemFailure(item, message, outcomeCounters);
    return;
  }

  const byId = new Map(outcomes.map((o) => [o.id, o]));
  await persistCombinedOutcome(
    item,
    byId.get(item.id),
    categories,
    outcomeCounters
  );
}

async function processSummarizeChunk(
  chunk: SummarizeWorkItem[],
  categories: CategoryChoice[],
  outcomeCounters: SummarizeBatchOutcome
): Promise<void> {
  if (chunk.length === 1) {
    await processSingleSummarizeItem(chunk[0], categories, outcomeCounters);
    return;
  }

  const inputs: LlmLegislationInput[] = chunk.map((item) => ({
    id: item.id,
    title: item.title,
    text: item.fullText,
    kind: item.kind,
  }));

  let outcomes: LlmBatchItemOutcome[];
  try {
    outcomes = await summarizeAndCategorizeItems(inputs, categories);
  } catch (err) {
    if (isFallbackCapReachedError(err)) {
      throw toRetryableCapacityError(err);
    }

    // Isolate failures across sibling items if batch call threw unexpectedly
    for (const item of chunk) {
      await processSingleSummarizeItem(item, categories, outcomeCounters);
    }
    return;
  }

  const byId = new Map(outcomes.map((o) => [o.id, o]));
  for (const item of chunk) {
    await persistCombinedOutcome(
      item,
      byId.get(item.id),
      categories,
      outcomeCounters
    );
  }
}

async function processCategoriesOnlyItem(
  item: SummarizeWorkItem,
  categories: CategoryChoice[],
  outcomeCounters: SummarizeBatchOutcome
): Promise<void> {
  if (categories.length === 0) {
    return;
  }

  let rawResult: { categories: string[]; aiModel: string };
  try {
    rawResult = await categorizeLegislationItem({
      title: item.title,
      summary: item.standardSummaryText || item.title,
      categories,
    });
  } catch (err) {
    if (isFallbackCapReachedError(err)) {
      throw toRetryableCapacityError(err);
    }
    const message = err instanceof Error ? err.message : String(err);
    await recordItemFailure(item, message, outcomeCounters);
    return;
  }

  const parsed = getPersistedCategoriesSchema().safeParse({
    categories: rawResult.categories,
  });
  if (!parsed.success) {
    const issueMessage = parsed.error.issues
      .map((issue) => issue.message)
      .join("; ");
    await recordItemFailure(
      item,
      `Categorization validation failed: ${issueMessage || "invalid categories"}`,
      outcomeCounters
    );
    return;
  }

  const connectIds = resolveCategoryConnectIds(
    parsed.data.categories,
    categories
  );
  if (connectIds.length === 0) {
    await recordItemFailure(
      item,
      "Categorization returned no valid category slugs",
      outcomeCounters
    );
    return;
  }

  try {
    await connectItemCategories(item, connectIds);
    outcomeCounters.categorized += 1;
    outcomeCounters.persisted += 1;
    await markDeadLetterProcessedIfAny(item);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordItemFailure(item, message, outcomeCounters);
  }
}

function extractDistinctIds<T>(
  rows: T[],
  getId: (row: T) => string | null | undefined
): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    const id = getId(row);
    if (id) {
      ids.add(id);
    }
  }
  return Array.from(ids);
}

function buildEligibilityWhere(excludedIds: string[]) {
  return {
    fullText: { not: null },
    NOT: { fullText: "" },
    OR: [
      { summaries: { none: { summaryType: "STANDARD" as const } } },
      { categories: { none: {} } },
    ],
    ...(excludedIds.length > 0 ? { id: { notIn: excludedIds } } : {}),
  };
}

/**
 * Selects up to `billBatchSize` bills and `eoBatchSize` executive orders (topping
 * off bills with any EO shortfall) that have `fullText` and lack either a
 * `STANDARD` summary or any `Category`, excluding poisoned `DeadLetter` items.
 */
export async function selectWorkBatchStep(
  opts?: SelectWorkBatchOptions
): Promise<SummarizeWorkBatch> {
  "use step";

  const billBatchSize = parseNonNegativeInt(
    opts?.billBatchSize,
    DEFAULT_BILL_BATCH_SIZE
  );
  const eoBatchSize = parseNonNegativeInt(
    opts?.eoBatchSize,
    DEFAULT_EO_BATCH_SIZE
  );
  const maxAttempts = parsePositiveInt(
    process.env.LLM_MAX_ATTEMPTS,
    DEFAULT_LLM_MAX_ATTEMPTS
  );

  const [categories, deadLetters] = await Promise.all([
    db.category.findMany({
      select: { id: true, slug: true, name: true, description: true },
      orderBy: { name: "asc" },
    }),
    db.deadLetter.findMany({
      where: {
        processed: false,
        attempts: { gte: maxAttempts },
      },
      select: {
        billId: true,
        executiveOrderId: true,
      },
    }),
  ]);

  const excludedBillIds = extractDistinctIds(deadLetters, (row) => row.billId);
  const excludedEoIds = extractDistinctIds(
    deadLetters,
    (row) => row.executiveOrderId
  );

  const eoRows =
    eoBatchSize > 0
      ? await db.executiveOrder.findMany({
          where: buildEligibilityWhere(excludedEoIds),
          orderBy: [{ signingDate: "desc" }, { id: "asc" }],
          take: eoBatchSize,
          select: {
            id: true,
            title: true,
            fullText: true,
            summaries: {
              where: { summaryType: "STANDARD" },
              select: { id: true, content: true },
              take: 1,
            },
            categories: {
              select: { id: true },
              take: 1,
            },
          },
        })
      : [];

  const validEoItems: SummarizeWorkItem[] = eoRows
    .filter(
      (eo): eo is typeof eo & { fullText: string } =>
        typeof eo.fullText === "string" && eo.fullText.trim().length > 0
    )
    .map((eo) => ({
      id: eo.id,
      kind: "executiveOrder",
      title: eo.title,
      fullText: eo.fullText,
      hasStandardSummary: (eo.summaries?.length ?? 0) > 0,
      standardSummaryText: eo.summaries?.[0]?.content ?? null,
      hasCategories: (eo.categories?.length ?? 0) > 0,
    }));

  const eoShortfall = Math.max(0, eoBatchSize - validEoItems.length);
  const billTarget = billBatchSize + eoShortfall;

  const billRows =
    billTarget > 0
      ? await db.bill.findMany({
          where: buildEligibilityWhere(excludedBillIds),
          orderBy: [{ introducedDate: "desc" }, { id: "asc" }],
          take: billTarget,
          select: {
            id: true,
            billType: true,
            billNumber: true,
            title: true,
            shortTitle: true,
            fullText: true,
            summaries: {
              where: { summaryType: "STANDARD" },
              select: { id: true, content: true },
              take: 1,
            },
            categories: {
              select: { id: true },
              take: 1,
            },
          },
        })
      : [];

  const validBillItems: SummarizeWorkItem[] = billRows
    .filter(
      (bill): bill is typeof bill & { fullText: string } =>
        typeof bill.fullText === "string" && bill.fullText.trim().length > 0
    )
    .map((bill) => {
      const fallbackTitle =
        bill.billType && bill.billNumber != null
          ? `${bill.billType.toUpperCase()} ${bill.billNumber}`
          : bill.id;
      return {
        id: bill.id,
        kind: "bill",
        title: bill.title || bill.shortTitle || fallbackTitle,
        fullText: bill.fullText,
        hasStandardSummary: (bill.summaries?.length ?? 0) > 0,
        standardSummaryText: bill.summaries?.[0]?.content ?? null,
        hasCategories: (bill.categories?.length ?? 0) > 0,
      };
    });

  return {
    categories,
    items: [...validBillItems, ...validEoItems],
    billCount: validBillItems.length,
    executiveOrderCount: validEoItems.length,
  };
}

/**
 * Summarizes and/or categorizes a selected work batch via the unified LLM router,
 * recording per-item `DeadLetter` attempts on permanent validation/parse failures
 * and throwing `RetryableError` (`retryAfter: "30m"`) when capacity is capped.
 */
export async function processSummaryBatchStep(
  batch: SummarizeWorkBatch
): Promise<SummarizeBatchOutcome> {
  "use step";

  const outcomeCounters: SummarizeBatchOutcome = {
    attempted: batch.items.length,
    persisted: 0,
    summarized: 0,
    categorized: 0,
    failed: 0,
    deadLettered: 0,
    errors: [],
  };

  if (batch.items.length === 0) {
    return outcomeCounters;
  }

  const needsSummaryItems: SummarizeWorkItem[] = [];
  const categoriesOnlyItems: SummarizeWorkItem[] = [];

  for (const item of batch.items) {
    if (!item.hasStandardSummary) {
      // Idempotency guard across step retries after RetryableError
      const existingSummary = await findExistingStandardSummary(item);
      if (existingSummary) {
        if (!item.hasCategories) {
          categoriesOnlyItems.push({
            ...item,
            hasStandardSummary: true,
            standardSummaryText: existingSummary.content,
          });
        }
        continue;
      }

      needsSummaryItems.push(item);
      continue;
    }

    if (!item.hasCategories) {
      categoriesOnlyItems.push(item);
    }
  }

  const chunkSize = parsePositiveInt(
    process.env.SUMMARIZE_BATCH_SIZE,
    DEFAULT_SUMMARIZE_BATCH_SIZE
  );

  for (const chunk of chunkArray(needsSummaryItems, chunkSize)) {
    await processSummarizeChunk(chunk, batch.categories, outcomeCounters);
  }

  for (const item of categoriesOnlyItems) {
    await processCategoriesOnlyItem(item, batch.categories, outcomeCounters);
  }

  return outcomeCounters;
}
