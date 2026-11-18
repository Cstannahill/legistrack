import type { Prisma } from "@prisma/client";
import { RetryableError } from "workflow";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  categorizeLegislationItem,
  summarizeAndCategorizeItems,
  truncateForPrompt,
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
const DEFAULT_OPENROUTER_MAX_INPUT_CHARS = 120_000;
const DEFAULT_GEMINI_MAX_INPUT_CHARS = 400_000;
const MAX_CATEGORIES_PER_ITEM = 3;

export type LegislationKind = "bill" | "executiveOrder";

export interface CategoryChoice extends LlmCategoryInput {
  id: string;
}

export interface SummarizeWorkItem {
  id: string;
  kind: LegislationKind;
  title: string;
  fullText?: string;
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

type DbWriteClient = Prisma.TransactionClient;

function getMaxLoadedFullTextChars(): number {
  return Math.max(
    parsePositiveInt(
      process.env.OPENROUTER_MAX_INPUT_CHARS,
      DEFAULT_OPENROUTER_MAX_INPUT_CHARS
    ),
    parsePositiveInt(
      process.env.GEMINI_MAX_INPUT_CHARS,
      DEFAULT_GEMINI_MAX_INPUT_CHARS
    )
  );
}

function boundFullText(text: string, maxChars: number): string {
  if (typeof truncateForPrompt === "function") {
    return truncateForPrompt(text, maxChars);
  }
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

async function runInTransaction<T>(
  callback: (tx: DbWriteClient) => Promise<T>
): Promise<T> {
  if (typeof db.$transaction === "function") {
    return db.$transaction(callback);
  }
  return callback(db as unknown as DbWriteClient);
}

async function acquireItemLock(
  tx: DbWriteClient,
  item: SummarizeWorkItem
): Promise<void> {
  if (typeof tx.$executeRaw !== "function") {
    return;
  }
  const lockNamespace = `summarize:${item.kind}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockNamespace}), hashtext(${item.id}))`;
}

async function findExistingStandardSummary(
  item: SummarizeWorkItem,
  client: DbWriteClient = db
): Promise<{ id: string; content: string } | null> {
  if (typeof client.summary?.findFirst !== "function") {
    return null;
  }

  const existing = await client.summary.findFirst({
    where: {
      ...getDeadLetterTargetWhere(item),
      summaryType: "STANDARD",
    },
    select: { id: true, content: true },
  });

  return existing ?? null;
}

async function hasExistingStandardSummaryInTx(
  item: SummarizeWorkItem,
  tx: DbWriteClient
): Promise<boolean> {
  if (typeof tx.summary?.findFirst !== "function") {
    return false;
  }

  const existing = await tx.summary.findFirst({
    where: {
      ...getDeadLetterTargetWhere(item),
      summaryType: "STANDARD",
    },
    select: { id: true },
  });

  return existing !== null && existing !== undefined;
}

async function hasLiveCategories(
  item: SummarizeWorkItem,
  client: DbWriteClient = db
): Promise<boolean> {
  if (item.kind === "bill") {
    if (typeof client.bill?.count !== "function") {
      return item.hasCategories;
    }
    const count = await client.bill.count({
      where: {
        id: item.id,
        categories: { some: {} },
      },
    });
    return typeof count === "number" ? count > 0 : item.hasCategories;
  }

  if (typeof client.executiveOrder?.count !== "function") {
    return item.hasCategories;
  }
  const count = await client.executiveOrder.count({
    where: {
      id: item.id,
      categories: { some: {} },
    },
  });
  return typeof count === "number" ? count > 0 : item.hasCategories;
}

async function getLiveCategoryCount(
  item: SummarizeWorkItem,
  client: DbWriteClient = db
): Promise<number> {
  if (typeof client.category?.count === "function") {
    const count = await client.category.count({
      where:
        item.kind === "bill"
          ? { bills: { some: { id: item.id } } }
          : { executiveOrders: { some: { id: item.id } } },
    });
    return typeof count === "number" ? count : 0;
  }

  const exists = await hasLiveCategories(item, client);
  return exists ? MAX_CATEGORIES_PER_ITEM : 0;
}

async function connectItemCategories(
  item: SummarizeWorkItem,
  categoryConnectIds: Array<{ id: string }>,
  client: DbWriteClient = db
): Promise<void> {
  if (categoryConnectIds.length === 0) {
    return;
  }

  if (item.kind === "bill") {
    await client.bill.update({
      where: { id: item.id },
      data: {
        categories: {
          connect: categoryConnectIds,
        },
      },
    });
    return;
  }

  await client.executiveOrder.update({
    where: { id: item.id },
    data: {
      categories: {
        connect: categoryConnectIds,
      },
    },
  });
}

async function createStandardSummaryRow(
  client: DbWriteClient,
  item: SummarizeWorkItem,
  summaryData: {
    content: string;
    keyPoints: string[];
    impactAreas: string[];
    aiModel: string;
    confidence: number | null;
  }
): Promise<void> {
  await client.summary.create({
    data: {
      billId: item.kind === "bill" ? item.id : null,
      executiveOrderId: item.kind === "executiveOrder" ? item.id : null,
      summaryType: "STANDARD",
      content: summaryData.content,
      keyPoints: summaryData.keyPoints,
      impactAreas: summaryData.impactAreas,
      aiModel: summaryData.aiModel,
      confidence: summaryData.confidence,
      generatedAt: new Date(),
    },
    select: { id: true },
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
  const targetWhere = getDeadLetterTargetWhere(item);

  if (typeof db.deadLetter?.updateMany === "function") {
    await db.deadLetter.updateMany({
      where: {
        ...targetWhere,
        processed: false,
      },
      data: {
        processed: true,
        processedAt: new Date(),
      },
    });
    return;
  }

  if (typeof db.deadLetter?.findFirst !== "function") {
    return;
  }

  const existing = await db.deadLetter.findFirst({
    where: {
      ...targetWhere,
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

async function markDeadLetterProcessedSafely(
  item: SummarizeWorkItem
): Promise<void> {
  try {
    await markDeadLetterProcessedIfAny(item);
  } catch (err) {
    console.warn(
      `[summarize] Failed to mark DeadLetter processed for ${item.kind} ${item.id}:`,
      err
    );
  }
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

  const summaryData = {
    content: parsed.data.summary,
    keyPoints: parsed.data.keyPoints,
    impactAreas: parsed.data.impactAreas,
    aiModel: llmOutcome.aiModel,
    confidence: parsed.data.confidence ?? null,
  };
  const connectIds = item.hasCategories
    ? []
    : resolveCategoryConnectIds(parsed.data.categories, categories);

  let txResult: {
    wroteSummary: boolean;
    wroteCategories: boolean;
    alreadyPersisted: boolean;
  };
  try {
    txResult = await runInTransaction(async (tx) => {
      await acquireItemLock(tx, item);

      const [existingSummary, liveCategoryCount] = await Promise.all([
        hasExistingStandardSummaryInTx(item, tx),
        getLiveCategoryCount(item, tx),
      ]);

      let wroteSummary = false;
      if (!existingSummary) {
        await createStandardSummaryRow(tx, item, summaryData);
        wroteSummary = true;
      }

      const remainingSlots = Math.max(
        0,
        MAX_CATEGORIES_PER_ITEM - liveCategoryCount
      );
      const txConnectIds =
        liveCategoryCount === 0 && remainingSlots > 0
          ? connectIds.slice(0, remainingSlots)
          : [];

      let wroteCategories = false;
      if (txConnectIds.length > 0) {
        await connectItemCategories(item, txConnectIds, tx);
        wroteCategories = true;
      }

      return {
        wroteSummary,
        wroteCategories,
        alreadyPersisted:
          existingSummary &&
          (liveCategoryCount > 0 || item.hasCategories || connectIds.length === 0),
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordItemFailure(item, message, outcomeCounters);
    return;
  }

  if (txResult.wroteSummary) {
    outcomeCounters.summarized += 1;
  }
  if (txResult.wroteCategories) {
    outcomeCounters.categorized += 1;
  }
  if (
    txResult.wroteSummary ||
    txResult.wroteCategories ||
    txResult.alreadyPersisted
  ) {
    outcomeCounters.persisted += 1;
  }

  if (
    txResult.wroteCategories ||
    item.hasCategories ||
    txResult.alreadyPersisted
  ) {
    await markDeadLetterProcessedSafely(item);
  }
}

async function processSingleSummarizeItem(
  item: SummarizeWorkItem,
  categories: CategoryChoice[],
  outcomeCounters: SummarizeBatchOutcome
): Promise<void> {
  if (typeof item.fullText !== "string" || item.fullText.trim().length === 0) {
    await recordItemFailure(
      item,
      "Missing fullText in database for summarization",
      outcomeCounters
    );
    return;
  }

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

  const validChunk: SummarizeWorkItem[] = [];
  for (const item of chunk) {
    if (typeof item.fullText !== "string" || item.fullText.trim().length === 0) {
      await recordItemFailure(
        item,
        "Missing fullText in database for summarization",
        outcomeCounters
      );
      continue;
    }
    validChunk.push(item);
  }

  if (validChunk.length === 0) {
    return;
  }
  if (validChunk.length === 1) {
    await processSingleSummarizeItem(validChunk[0], categories, outcomeCounters);
    return;
  }

  const inputs: LlmLegislationInput[] = validChunk.map((item) => ({
    id: item.id,
    title: item.title,
    text: item.fullText ?? "",
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
    for (const item of validChunk) {
      await processSingleSummarizeItem(item, categories, outcomeCounters);
    }
    return;
  }

  const byId = new Map(outcomes.map((o) => [o.id, o]));
  for (const item of validChunk) {
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

  let wroteCategories = false;
  try {
    wroteCategories = await runInTransaction(async (tx) => {
      await acquireItemLock(tx, item);
      const liveCategoryCount = await getLiveCategoryCount(item, tx);
      if (liveCategoryCount > 0) {
        return false;
      }
      await connectItemCategories(item, connectIds, tx);
      return true;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordItemFailure(item, message, outcomeCounters);
    return;
  }

  if (wroteCategories) {
    outcomeCounters.categorized += 1;
  }
  outcomeCounters.persisted += 1;
  await markDeadLetterProcessedSafely(item);
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

async function loadBoundedFullTextForItems(
  items: SummarizeWorkItem[]
): Promise<SummarizeWorkItem[]> {
  const missingItems = items.filter(
    (item) => typeof item.fullText !== "string" || item.fullText.trim().length === 0
  );
  if (missingItems.length === 0) {
    return items;
  }

  const maxChars = getMaxLoadedFullTextChars();
  const billIds = missingItems
    .filter((item) => item.kind === "bill")
    .map((item) => item.id);
  const eoIds = missingItems
    .filter((item) => item.kind === "executiveOrder")
    .map((item) => item.id);

  const [billTextRows, eoTextRows] = await Promise.all([
    billIds.length > 0 && typeof db.bill?.findMany === "function"
      ? db.bill.findMany({
          where: { id: { in: billIds } },
          select: { id: true, fullText: true },
        })
      : Promise.resolve([]),
    eoIds.length > 0 && typeof db.executiveOrder?.findMany === "function"
      ? db.executiveOrder.findMany({
          where: { id: { in: eoIds } },
          select: { id: true, fullText: true },
        })
      : Promise.resolve([]),
  ]);

  const billTextById = new Map<string, string>();
  for (const row of billTextRows ?? []) {
    if (typeof row.fullText === "string" && row.fullText.trim().length > 0) {
      billTextById.set(row.id, boundFullText(row.fullText, maxChars));
    }
  }

  const eoTextById = new Map<string, string>();
  for (const row of eoTextRows ?? []) {
    if (typeof row.fullText === "string" && row.fullText.trim().length > 0) {
      eoTextById.set(row.id, boundFullText(row.fullText, maxChars));
    }
  }

  return items.map((item) => {
    if (typeof item.fullText === "string" && item.fullText.trim().length > 0) {
      return {
        ...item,
        fullText: boundFullText(item.fullText, maxChars),
      };
    }

    const loaded =
      item.kind === "bill"
        ? billTextById.get(item.id)
        : eoTextById.get(item.id);
    return loaded ? { ...item, fullText: loaded } : item;
  });
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
      const [existingSummary, liveHasCategories] = await Promise.all([
        findExistingStandardSummary(item),
        item.hasCategories ? Promise.resolve(true) : hasLiveCategories(item),
      ]);

      if (existingSummary) {
        if (liveHasCategories) {
          outcomeCounters.persisted += 1;
          await markDeadLetterProcessedSafely(item);
        } else {
          categoriesOnlyItems.push({
            ...item,
            hasStandardSummary: true,
            standardSummaryText: existingSummary.content,
            hasCategories: false,
          });
        }
        continue;
      }

      needsSummaryItems.push({
        ...item,
        hasCategories: liveHasCategories,
      });
      continue;
    }

    if (!item.hasCategories) {
      const liveHasCategories = await hasLiveCategories(item);
      if (liveHasCategories) {
        outcomeCounters.persisted += 1;
        await markDeadLetterProcessedSafely(item);
        continue;
      }
      categoriesOnlyItems.push(item);
    }
  }

  const hydratedSummaryItems =
    await loadBoundedFullTextForItems(needsSummaryItems);

  const chunkSize = parsePositiveInt(
    process.env.SUMMARIZE_BATCH_SIZE,
    DEFAULT_SUMMARIZE_BATCH_SIZE
  );

  for (const chunk of chunkArray(hydratedSummaryItems, chunkSize)) {
    await processSummarizeChunk(chunk, batch.categories, outcomeCounters);
  }

  for (const item of categoriesOnlyItems) {
    await processCategoriesOnlyItem(item, batch.categories, outcomeCounters);
  }

  return outcomeCounters;
}
