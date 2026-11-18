import fs from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  buildBillIdentifier,
  persistHydratedBillPrisma,
} from "@/lib/ingestion/bills-service";
import { CongressClient } from "@/lib/ingestion/congress-client";
import { getRemainingGeminiFallbackQuota } from "@/lib/llm/gemini";
import { summarizeAndCategorizeItems, truncateForPrompt } from "@/lib/llm/router";
import {
  FallbackCapReachedError,
  SummaryAndCategoryItemSchema,
  type LlmCategoryInput,
  type LlmRoutingOptions,
} from "@/lib/llm/types";
import { getOpenRouterKeys } from "@/lib/openrouter-keys";
import {
  backfillEoTextsStep,
  fetchExecutiveOrderListStep,
  ingestEoChunkStep,
} from "@/workflows/steps/ingest-eo";
import {
  backfillBillTextsStep,
  fetchBillListStep,
  ingestBillChunkStep,
  type BillListTarget,
} from "@/workflows/steps/ingest-legislation";
import {
  processSummaryBatchStep,
  selectWorkBatchStep,
  type CategoryChoice,
  type SummarizeBatchOutcome,
  type SummarizeWorkItem,
} from "@/workflows/steps/summarize";
import {
  getBooleanFlag,
  getCsvFlag,
  getNonNegativeIntFlag,
  getPositiveIntFlag,
  getStringFlag,
  parseBillIdentifier,
  parseCliFlags,
  resolveManualModelTarget,
  type ManualModelAlias,
  type ParsedCliArgs,
  type ResolvedManualModelTarget,
} from "./manual-cli-args";

export {
  getBooleanFlag,
  getCsvFlag,
  getNonNegativeIntFlag,
  getPositiveIntFlag,
  getStringFlag,
  parseBillIdentifier,
  parseCliFlags,
  resolveManualModelTarget,
  type ManualModelAlias,
  type ParsedCliArgs,
  type ResolvedManualModelTarget,
};

const DEFAULT_INGEST_CHUNK_SIZE = 10;
const MAX_CATEGORIES_PER_ITEM = 3;

export interface ManualIngestOptions {
  bill?: string;
  congress?: number;
  lookbackDays?: number;
  billTypes?: string[];
  startDate?: string;
  endDate?: string;
  limit?: number;
  includeEos?: boolean;
  eosOnly?: boolean;
  eoLookbackDays?: number;
  backfillTexts?: number;
  dryRun?: boolean;
}

export interface ManualSummarizeOptions {
  model?: string;
  allowFallback?: boolean;
  bill?: string;
  eo?: number;
  id?: string;
  bills?: number;
  eos?: number;
  batchSize?: number;
  replace?: boolean;
  dryRun?: boolean;
}

/**
 * Loads `.env.local` and `.env` without overwriting environment variables
 * already provided by the caller's shell.
 */
export function loadManualEnv(cwd: string = process.cwd()): void {
  const candidates = [".env.local", ".env"];
  for (const fileName of candidates) {
    const fullPath = path.resolve(cwd, fileName);
    if (fs.existsSync(fullPath)) {
      loadDotenv({ path: fullPath, quiet: true });
    }
  }
}

function assertIngestionEnv(options: {
  needsCongress: boolean;
  needsGemini: boolean;
  needsOpenRouter: boolean;
  allowEitherLlm?: boolean;
}): void {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required in .env.local or .env");
  }
  if (options.needsCongress && !process.env.CONGRESS_API_KEY?.trim()) {
    throw new Error("CONGRESS_API_KEY is required for bill ingestion");
  }
  if (options.allowEitherLlm) {
    const hasOpenRouter = getOpenRouterKeys().length > 0;
    const hasGemini = Boolean(process.env.GEMINI_API_KEY?.trim());
    if (!hasOpenRouter && !hasGemini) {
      throw new Error(
        "Configure OPENROUTER_API_KEYS (or OPENROUTER_API_KEY_1..10) and/or GEMINI_API_KEY."
      );
    }
    return;
  }
  if (options.needsOpenRouter && getOpenRouterKeys().length === 0) {
    throw new Error(
      "No OpenRouter API keys found. Set OPENROUTER_API_KEYS or OPENROUTER_API_KEY_1..10."
    );
  }
  if (options.needsGemini && !process.env.GEMINI_API_KEY?.trim()) {
    throw new Error("GEMINI_API_KEY is required for direct Gemini 3.8 Flash");
  }
}

export async function runManualIngest(options: ManualIngestOptions) {
  const dryRun = options.dryRun === true;
  const eosOnly = options.eosOnly === true;
  const includeEos = eosOnly || options.includeEos === true;
  const ingestBills = !eosOnly;

  assertIngestionEnv({
    needsCongress:
      (ingestBills && !(dryRun && Boolean(options.bill))) ||
      (!dryRun && (options.backfillTexts ?? 0) > 0),
    needsGemini: false,
    needsOpenRouter: false,
  });

  const billSummary = {
    fetched: 0,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    needsSummarizationCount: 0,
    targetBillIds: [] as string[],
  };

  if (ingestBills) {
    if (options.bill) {
      const parsed = parseBillIdentifier(options.bill, options.congress);
      const target: BillListTarget = {
        ...parsed,
        title: `${parsed.type.toUpperCase()} ${parsed.number}`,
      };
      const identifier = buildBillIdentifier(target);
      console.log(`Fetching single bill ${identifier} from Congress.gov...`);

      if (dryRun) {
        console.log(`[dry-run] Would hydrate and persist ${identifier}`);
        billSummary.fetched = 1;
      } else {
        const client = new CongressClient();
        const hydrated = await client.hydrateBill(target);
        const persisted = await persistHydratedBillPrisma(hydrated, client);
        billSummary.fetched = 1;
        billSummary.processed = 1;
        if (persisted.action === "created") billSummary.created += 1;
        else if (persisted.action === "updated") billSummary.updated += 1;
        else if (persisted.action === "skipped") billSummary.skipped += 1;
        else billSummary.failed += 1;

        if (persisted.billId) {
          billSummary.targetBillIds.push(persisted.billId);
        }

        console.log(
          `Single bill ${persisted.identifier}: ${persisted.action}${
            persisted.message ? ` (${persisted.message})` : ""
          }`
        );
      }
    } else {
      console.log("Fetching updated bill list from Congress.gov...");
      const list = await fetchBillListStep({
        lookbackDays: options.lookbackDays,
        congress: options.congress,
        billTypes: options.billTypes,
        startDate: options.startDate,
        endDate: options.endDate,
      });
      const selected =
        options.limit !== undefined
          ? list.items.slice(0, options.limit)
          : list.items;
      billSummary.fetched = selected.length;

      console.log(
        `Congress ${list.congress}th (${list.windowStart.slice(0, 10)} -> ${list.windowEnd.slice(0, 10)}): ${list.items.length} discovered, ${selected.length} selected.`
      );

      if (dryRun) {
        for (const item of selected.slice(0, 15)) {
          console.log(
            `  [dry-run] ${buildBillIdentifier(item)} — ${item.title || "(no title)"}`
          );
        }
        if (selected.length > 15) {
          console.log(`  ... and ${selected.length - 15} more`);
        }
      } else {
        for (let i = 0; i < selected.length; i += DEFAULT_INGEST_CHUNK_SIZE) {
          const chunk = selected.slice(i, i + DEFAULT_INGEST_CHUNK_SIZE);
          const outcome = await ingestBillChunkStep(chunk);
          billSummary.processed += outcome.processed;
          billSummary.created += outcome.created;
          billSummary.updated += outcome.updated;
          billSummary.skipped += outcome.skipped;
          billSummary.failed += outcome.failed;
          billSummary.needsSummarizationCount += outcome.needsSummarizationCount;
          console.log(
            `  Chunk ${Math.floor(i / DEFAULT_INGEST_CHUNK_SIZE) + 1}: created=${outcome.created}, updated=${outcome.updated}, skipped=${outcome.skipped}, failed=${outcome.failed}`
          );
          for (const err of outcome.errors) {
            console.warn(`    [error] ${err.identifier}: ${err.error}`);
          }
        }
      }
    }
  }

  const eoSummary = {
    fetched: 0,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    needsSummarizationCount: 0,
  };

  if (includeEos) {
    console.log("Fetching presidential documents from Federal Register...");
    const eoList = await fetchExecutiveOrderListStep({
      lookbackDays: options.eoLookbackDays ?? options.lookbackDays,
      startDate: options.startDate,
      endDate: options.endDate,
    });
    const selectedEos =
      options.limit !== undefined
        ? eoList.items.slice(0, options.limit)
        : eoList.items;
    eoSummary.fetched = selectedEos.length;

    console.log(
      `Federal Register (${eoList.windowStart.slice(0, 10)} -> ${eoList.windowEnd.slice(0, 10)}): ${eoList.items.length} discovered, ${selectedEos.length} selected.`
    );

    if (dryRun) {
      for (const eo of selectedEos.slice(0, 15)) {
        console.log(`  [dry-run] ${eo.document_number} — ${eo.title}`);
      }
    } else {
      for (let i = 0; i < selectedEos.length; i += DEFAULT_INGEST_CHUNK_SIZE) {
        const chunk = selectedEos.slice(i, i + DEFAULT_INGEST_CHUNK_SIZE);
        const outcome = await ingestEoChunkStep(chunk, {
          fetchFullText: eoList.fetchFullText,
        });
        eoSummary.processed += outcome.processed;
        eoSummary.created += outcome.created;
        eoSummary.updated += outcome.updated;
        eoSummary.skipped += outcome.skipped;
        eoSummary.failed += outcome.failed;
        eoSummary.needsSummarizationCount += outcome.needsSummarizationCount;
        console.log(
          `  EO chunk ${Math.floor(i / DEFAULT_INGEST_CHUNK_SIZE) + 1}: created=${outcome.created}, updated=${outcome.updated}, skipped=${outcome.skipped}, failed=${outcome.failed}`
        );
      }
    }
  }

  if (!dryRun && options.backfillTexts && options.backfillTexts > 0) {
    console.log(`Backfilling up to ${options.backfillTexts} missing full texts...`);
    if (ingestBills) {
      const billBackfill = await backfillBillTextsStep(options.backfillTexts);
      console.log(
        `  Bill text backfill: checked=${billBackfill.processed}, updated=${billBackfill.updated}, urlOnly=${billBackfill.urlOnly}, failed=${billBackfill.failed}`
      );
    }
    if (includeEos) {
      const eoBackfill = await backfillEoTextsStep(options.backfillTexts);
      console.log(
        `  EO text backfill: checked=${eoBackfill.processed}, updated=${eoBackfill.updated}, urlOnly=${eoBackfill.urlOnly}, failed=${eoBackfill.failed}`
      );
    }
  }

  return { billSummary, eoSummary };
}

async function resolveSingleWorkItem(
  options: ManualSummarizeOptions
): Promise<SummarizeWorkItem | null> {
  if (options.id) {
    const bill = await db.bill.findUnique({
      where: { id: options.id },
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
        categories: { select: { id: true }, take: 1 },
      },
    });
    if (bill) {
      return {
        id: bill.id,
        kind: "bill",
        title:
          bill.title ||
          bill.shortTitle ||
          `${bill.billType.toUpperCase()} ${bill.billNumber}`,
        fullText: bill.fullText ?? undefined,
        hasStandardSummary: bill.summaries.length > 0,
        standardSummaryText: bill.summaries[0]?.content ?? null,
        hasCategories: bill.categories.length > 0,
      };
    }

    const eo = await db.executiveOrder.findUnique({
      where: { id: options.id },
      select: {
        id: true,
        title: true,
        fullText: true,
        summaries: {
          where: { summaryType: "STANDARD" },
          select: { id: true, content: true },
          take: 1,
        },
        categories: { select: { id: true }, take: 1 },
      },
    });
    if (eo) {
      return {
        id: eo.id,
        kind: "executiveOrder",
        title: eo.title,
        fullText: eo.fullText ?? undefined,
        hasStandardSummary: eo.summaries.length > 0,
        standardSummaryText: eo.summaries[0]?.content ?? null,
        hasCategories: eo.categories.length > 0,
      };
    }

    return null;
  }

  if (options.bill) {
    const parsed = parseBillIdentifier(options.bill);
    const bill = await db.bill.findFirst({
      where: {
        congress: parsed.congress,
        billType: { equals: parsed.type, mode: "insensitive" },
        billNumber: Number.parseInt(parsed.number, 10),
      },
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
        categories: { select: { id: true }, take: 1 },
      },
    });
    if (!bill) return null;

    return {
      id: bill.id,
      kind: "bill",
      title:
        bill.title ||
        bill.shortTitle ||
        `${bill.billType.toUpperCase()} ${bill.billNumber}`,
      fullText: bill.fullText ?? undefined,
      hasStandardSummary: bill.summaries.length > 0,
      standardSummaryText: bill.summaries[0]?.content ?? null,
      hasCategories: bill.categories.length > 0,
    };
  }

  if (options.eo !== undefined) {
    const eo = await db.executiveOrder.findUnique({
      where: { orderNumber: options.eo },
      select: {
        id: true,
        title: true,
        fullText: true,
        summaries: {
          where: { summaryType: "STANDARD" },
          select: { id: true, content: true },
          take: 1,
        },
        categories: { select: { id: true }, take: 1 },
      },
    });
    if (!eo) return null;

    return {
      id: eo.id,
      kind: "executiveOrder",
      title: eo.title,
      fullText: eo.fullText ?? undefined,
      hasStandardSummary: eo.summaries.length > 0,
      standardSummaryText: eo.summaries[0]?.content ?? null,
      hasCategories: eo.categories.length > 0,
    };
  }

  return null;
}

/**
 * Generates and atomically replaces the STANDARD summary for a single targeted
 * item ONLY after the replacement LLM call succeeds and passes Zod validation.
 */
async function replaceSingleStandardSummary(
  item: SummarizeWorkItem,
  categories: CategoryChoice[],
  llmOptions: LlmRoutingOptions | undefined
): Promise<SummarizeBatchOutcome> {
  if (!item.fullText || item.fullText.trim().length === 0) {
    throw new Error(
      `Cannot replace summary for ${item.kind} ${item.id}: fullText is missing in database`
    );
  }

  const maxChars = 400_000;
  const inputText = truncateForPrompt(item.fullText, maxChars);
  const outcomes = llmOptions
    ? await summarizeAndCategorizeItems(
        [{ id: item.id, title: item.title, text: inputText, kind: item.kind }],
        categories,
        llmOptions
      )
    : await summarizeAndCategorizeItems(
        [{ id: item.id, title: item.title, text: inputText, kind: item.kind }],
        categories
      );

  const outcome = outcomes[0];
  if (!outcome || !outcome.ok) {
    throw new Error(outcome?.error || "LLM replacement summarization failed");
  }

  const validated = SummaryAndCategoryItemSchema.parse({
    id: outcome.id,
    summary: outcome.summary,
    keyPoints: outcome.keyPoints,
    impactAreas: outcome.impactAreas,
    categories: outcome.categories,
    confidence: outcome.confidence,
  });

  const bySlug = new Map(
    categories.map((c) => [c.slug.trim().toLowerCase(), c.id])
  );
  const connectIds: Array<{ id: string }> = [];
  const seen = new Set<string>();
  for (const slug of validated.categories) {
    const catId = bySlug.get(slug.trim().toLowerCase());
    if (catId && !seen.has(catId)) {
      seen.add(catId);
      connectIds.push({ id: catId });
      if (connectIds.length >= MAX_CATEGORIES_PER_ITEM) break;
    }
  }

  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const targetWhere =
      item.kind === "bill"
        ? { billId: item.id }
        : { executiveOrderId: item.id };

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`summarize:${item.kind}`}), hashtext(${item.id}))`;

    await tx.summary.deleteMany({
      where: {
        ...targetWhere,
        summaryType: "STANDARD",
      },
    });

    await tx.summary.create({
      data: {
        ...targetWhere,
        summaryType: "STANDARD",
        content: validated.summary,
        keyPoints: validated.keyPoints,
        impactAreas: validated.impactAreas,
        aiModel: outcome.aiModel,
        confidence: validated.confidence ?? null,
        generatedAt: new Date(),
      },
    });

    if (!item.hasCategories && connectIds.length > 0) {
      if (item.kind === "bill") {
        await tx.bill.update({
          where: { id: item.id },
          data: { categories: { connect: connectIds } },
        });
      } else {
        await tx.executiveOrder.update({
          where: { id: item.id },
          data: { categories: { connect: connectIds } },
        });
      }
    }

    await tx.deadLetter.updateMany({
      where: { ...targetWhere, processed: false },
      data: { processed: true, processedAt: new Date() },
    });
  });

  console.log(
    `Replaced STANDARD summary on ${item.kind} ${item.id} using ${outcome.aiModel} (${validated.summary.length} chars, ${validated.keyPoints.length} key points)`
  );

  return {
    attempted: 1,
    persisted: 1,
    summarized: 1,
    categorized: !item.hasCategories && connectIds.length > 0 ? 1 : 0,
    failed: 0,
    deadLettered: 0,
    errors: [],
  };
}

export async function runManualSummarize(
  options: ManualSummarizeOptions
): Promise<SummarizeBatchOutcome> {
  const dryRun = options.dryRun === true;
  const target = resolveManualModelTarget(options.model, {
    allowFallback: options.allowFallback,
  });

  const isSingleTarget = Boolean(
    options.bill || options.id || options.eo !== undefined
  );
  if (options.replace && !isSingleTarget) {
    throw new Error(
      "--replace requires an explicit single target (--bill, --eo, or --id) to avoid overwriting batch summaries."
    );
  }

  assertIngestionEnv({
    needsCongress: false,
    needsGemini: !dryRun && target.alias === "gemini",
    needsOpenRouter:
      !dryRun &&
      target.usesOpenRouter &&
      target.alias !== "cascade" &&
      !options.allowFallback,
    allowEitherLlm:
      !dryRun && (target.alias === "cascade" || Boolean(options.allowFallback)),
  });

  console.log(`\nModel target: ${target.label}`);
  if (target.usesOpenRouter) {
    console.log(`OpenRouter keys loaded: ${getOpenRouterKeys().length}`);
  }
  if (target.usesGemini) {
    const quota = await getRemainingGeminiFallbackQuota().catch(() => null);
    if (quota) {
      console.log(
        `Gemini 3.8 Flash daily quota: ${quota.used}/${quota.limit} used (${quota.remaining} remaining)`
      );
    }
  }

  const categories = await db.category.findMany({
    select: { id: true, slug: true, name: true, description: true },
    orderBy: { name: "asc" },
  });

  if (isSingleTarget) {
    const singleItem = await resolveSingleWorkItem(options);
    if (!singleItem) {
      throw new Error(
        "Target legislation item not found in database. Ingest it first or use manual:pipeline."
      );
    }

    if (!singleItem.fullText || singleItem.fullText.trim().length === 0) {
      throw new Error(
        `Found ${singleItem.kind} ${singleItem.id} ("${singleItem.title}"), but fullText is missing in database.`
      );
    }

    if (singleItem.hasStandardSummary && singleItem.hasCategories && !options.replace) {
      console.log(
        `Item ${singleItem.kind} ${singleItem.id} already has a STANDARD summary and categories. Pass --replace to regenerate.`
      );
      return {
        attempted: 0,
        persisted: 0,
        summarized: 0,
        categorized: 0,
        failed: 0,
        deadLettered: 0,
        errors: [],
      };
    }

    if (dryRun) {
      console.log(
        `[dry-run] Would ${options.replace ? "replace summary for" : "process"} ${singleItem.kind} ${singleItem.id} — "${singleItem.title}"`
      );
      return {
        attempted: 1,
        persisted: 0,
        summarized: 0,
        categorized: 0,
        failed: 0,
        deadLettered: 0,
        errors: [],
      };
    }

    if (options.replace) {
      return replaceSingleStandardSummary(
        singleItem,
        categories as LlmCategoryInput[] & CategoryChoice[],
        target.llmOptions
      );
    }

    const batch = {
      categories,
      items: [singleItem],
      billCount: singleItem.kind === "bill" ? 1 : 0,
      executiveOrderCount: singleItem.kind === "executiveOrder" ? 1 : 0,
    };
    return processSummaryBatchStep(batch, {
      llmOptions: target.llmOptions,
      chunkSize: 1,
    });
  }

  const billBatchSize = options.bills ?? 5;
  const eoBatchSize = options.eos ?? 0;
  const batch = await selectWorkBatchStep({ billBatchSize, eoBatchSize });

  console.log(
    `Selected work batch: ${batch.billCount} bill(s), ${batch.executiveOrderCount} executive order(s)`
  );

  if (batch.items.length === 0) {
    console.log("No eligible items needing summarization or categorization.");
    return {
      attempted: 0,
      persisted: 0,
      summarized: 0,
      categorized: 0,
      failed: 0,
      deadLettered: 0,
      errors: [],
    };
  }

  if (dryRun) {
    for (const item of batch.items) {
      const task = item.hasStandardSummary ? "categorize-only" : "summarize+categorize";
      console.log(
        `  [dry-run] [${item.kind}] ${item.id} (${task}) — ${item.title.slice(0, 90)}`
      );
    }
    return {
      attempted: batch.items.length,
      persisted: 0,
      summarized: 0,
      categorized: 0,
      failed: 0,
      deadLettered: 0,
      errors: [],
    };
  }

  try {
    const outcome = await processSummaryBatchStep(batch, {
      ...(target.llmOptions ? { llmOptions: target.llmOptions } : {}),
      ...(options.batchSize ? { chunkSize: options.batchSize } : {}),
    });

    console.log(
      `Summary outcome: attempted=${outcome.attempted}, persisted=${outcome.persisted}, summarized=${outcome.summarized}, categorized=${outcome.categorized}, failed=${outcome.failed}, deadLettered=${outcome.deadLettered}`
    );
    for (const err of outcome.errors) {
      console.error(`  [error] ${err.kind} ${err.id}: ${err.error}`);
    }
    return outcome;
  } catch (err) {
    if (err instanceof FallbackCapReachedError || (err instanceof Error && err.name === "RetryableError")) {
      console.error(
        `Capacity/quota stop: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    throw err;
  }
}
