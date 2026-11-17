import { CURRENT_CONGRESS } from "@/lib/constants";
import { db } from "@/lib/db";
import {
  backfillMissingBillTexts,
  buildBillIdentifier,
  determineLookupWindow,
  formatForCongressApi,
  persistHydratedBillPrisma,
  type TextBackfillSummary,
} from "@/lib/ingestion/bills-service";
import {
  CongressClient,
  type CongressBillListItem,
} from "@/lib/ingestion/congress-client";

export type { TextBackfillSummary };

const DEFAULT_INGEST_LOOKBACK_DAYS = 1;
const DEFAULT_BILL_PAGE_SIZE = 250;
const MAX_BILL_PAGE_SIZE = 250;
const DEFAULT_MAX_PAGES = 20;
const DEFAULT_TEXT_BACKFILL_BATCH_SIZE = 10;
const MAX_STEP_ERRORS = 10;

export interface BillListTarget {
  congress: number;
  type: string;
  number: string;
  title: string;
}

export interface FetchBillListOptions {
  lookbackDays?: number;
  congress?: number;
  billTypes?: string[];
  startDate?: string;
  endDate?: string;
  pageSize?: number;
  maxPages?: number;
}

export interface FetchBillListResult {
  congress: number;
  lookbackDays: number;
  windowStart: string;
  windowEnd: string;
  items: BillListTarget[];
}

export interface IngestItemError {
  identifier: string;
  error: string;
}

export interface IngestChunkOutcome {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  needsSummarizationCount: number;
  errors: IngestItemError[];
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function resolvePositiveNumber(
  value: number | undefined,
  fallback: number
): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

function toBillListTarget(
  bill: CongressBillListItem,
  fallbackCongress: number
): BillListTarget {
  return {
    congress:
      typeof bill.congress === "number" && Number.isFinite(bill.congress)
        ? bill.congress
        : fallbackCongress,
    type: String(bill.type ?? "").trim(),
    number: String(bill.number ?? "").trim(),
    title: typeof bill.title === "string" ? bill.title : "",
  };
}

function pushBoundedError(
  errors: IngestItemError[],
  identifier: string,
  error: string
): void {
  if (errors.length < MAX_STEP_ERRORS) {
    errors.push({
      identifier,
      error: error.slice(0, 500),
    });
  }
}

async function countBillsNeedingSummarization(
  changedBillIds: string[],
  hydratedWithTextIds: string[]
): Promise<number> {
  if (changedBillIds.length === 0) {
    return 0;
  }

  if (typeof db.bill?.count !== "function") {
    return hydratedWithTextIds.length;
  }

  return db.bill.count({
    where: {
      id: { in: changedBillIds },
      fullText: { not: null },
      NOT: { fullText: "" },
      OR: [
        { summaries: { none: { summaryType: "STANDARD" } } },
        { categories: { none: {} } },
      ],
    },
  });
}

/**
 * Fetches paginated bill identifiers updated within the configured Congress.gov
 * lookback window using `cache: "no-store"` and 1s throttling.
 */
export async function fetchBillListStep(
  options: FetchBillListOptions = {}
): Promise<FetchBillListResult> {
  "use step";

  const lookbackDays = resolvePositiveNumber(
    options.lookbackDays,
    parsePositiveInt(
      process.env.INGEST_LOOKBACK_DAYS,
      DEFAULT_INGEST_LOOKBACK_DAYS
    )
  );
  const congress = resolvePositiveNumber(
    options.congress,
    parsePositiveInt(process.env.TARGET_CONGRESS, CURRENT_CONGRESS)
  );
  const pageSize = Math.min(
    MAX_BILL_PAGE_SIZE,
    resolvePositiveNumber(options.pageSize, DEFAULT_BILL_PAGE_SIZE)
  );
  const maxPages = resolvePositiveNumber(options.maxPages, DEFAULT_MAX_PAGES);

  const window = determineLookupWindow(
    lookbackDays,
    options.startDate,
    options.endDate
  );
  const fromDateTime = formatForCongressApi(window.from);
  const toDateTime = formatForCongressApi(window.to);

  const client = new CongressClient();
  const seen = new Set<string>();
  const items: BillListTarget[] = [];

  let offset = 0;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    const page = await client.fetchBillPage({
      congress,
      billTypes: options.billTypes,
      limit: pageSize,
      offset,
      fromDateTime,
      toDateTime,
    });

    const bills = page.bills ?? [];
    if (bills.length === 0) {
      break;
    }

    for (const bill of bills) {
      const target = toBillListTarget(bill, congress);
      const dedupeKey = buildBillIdentifier(target);
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        items.push(target);
      }
    }

    offset += bills.length;
    if (!page.pagination?.next) {
      break;
    }
  }

  return {
    congress,
    lookbackDays,
    windowStart: window.from.toISOString(),
    windowEnd: window.to.toISOString(),
    items,
  };
}

/**
 * Hydrates and persists a bounded chunk of bills via Prisma, returning counts
 * and how many changed bills currently have `fullText` needing summarization
 * or categorization.
 */
export async function ingestBillChunkStep(
  items: BillListTarget[]
): Promise<IngestChunkOutcome> {
  "use step";

  if (items.length === 0) {
    return {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      needsSummarizationCount: 0,
      errors: [],
    };
  }

  const client = new CongressClient();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const changedBillIds: string[] = [];
  const hydratedWithTextIds: string[] = [];
  const errors: IngestItemError[] = [];

  for (const item of items) {
    const identifier = buildBillIdentifier(item);

    try {
      const hydrated = await client.hydrateBill(item);
      const persisted = await persistHydratedBillPrisma(hydrated, client);

      switch (persisted.action) {
        case "created":
        case "updated": {
          if (persisted.action === "created") {
            created += 1;
          } else {
            updated += 1;
          }
          if (persisted.billId) {
            changedBillIds.push(persisted.billId);
            if (hydrated.text?.content && hydrated.text.content.trim().length > 0) {
              hydratedWithTextIds.push(persisted.billId);
            }
          }
          break;
        }
        case "skipped": {
          skipped += 1;
          break;
        }
        case "failed": {
          failed += 1;
          pushBoundedError(
            errors,
            persisted.identifier,
            persisted.message ?? "Failed to persist bill"
          );
          break;
        }
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ingest-legislation] Failed to ingest bill", {
        identifier,
        error: message,
      });
      pushBoundedError(errors, identifier, message);
    }
  }

  const needsSummarizationCount = await countBillsNeedingSummarization(
    changedBillIds,
    hydratedWithTextIds
  );

  return {
    processed: items.length,
    created,
    updated,
    skipped,
    failed,
    needsSummarizationCount,
    errors,
  };
}

/**
 * Backfills `fullText` and `fullTextUrl` for bills currently missing `fullText`.
 */
export async function backfillBillTextsStep(
  batchSize?: number
): Promise<TextBackfillSummary> {
  "use step";

  const limit =
    batchSize !== undefined
      ? parseNonNegativeInt(batchSize, DEFAULT_TEXT_BACKFILL_BATCH_SIZE)
      : parsePositiveInt(
          process.env.BILL_TEXT_BATCH_SIZE,
          DEFAULT_TEXT_BACKFILL_BATCH_SIZE
        );

  return backfillMissingBillTexts(limit);
}
