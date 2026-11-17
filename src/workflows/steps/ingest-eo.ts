import { db } from "@/lib/db";
import {
  backfillMissingEoTexts,
  buildExecutiveOrderIdentifier,
  determineLookupWindow,
  formatFederalRegisterDate,
  persistExecutiveOrderPrisma,
  type TextBackfillSummary,
} from "@/lib/ingestion/executive-orders-service";
import {
  fetchExecutiveOrdersPage,
  hydrateExecutiveOrder,
  type FederalRegisterDocument,
} from "@/lib/ingestion/federal-register-client";
import type {
  IngestChunkOutcome,
  IngestItemError,
} from "@/workflows/steps/ingest-legislation";

const DEFAULT_EO_LOOKBACK_DAYS = 14;
const DEFAULT_EO_PER_PAGE = 100;
const MAX_EO_PER_PAGE = 1000;
const DEFAULT_MAX_PAGES = 20;
const DEFAULT_EO_TEXT_BATCH_SIZE = 10;
const MAX_STEP_ERRORS = 10;
const DEFAULT_EO_DOCUMENT_TYPES = [
  "executive_order",
  "presidential_memorandum",
  "proclamation",
  "determination",
] as const;

export interface EoListTarget {
  document_number: string;
  type: string;
  presidential_document_type?: string;
  subtype?: string;
  title: string;
  signing_date?: string;
  publication_date?: string;
  executive_order_number?: number | string | null;
  presidential_document_number?: string | null;
  proclamation_number?: number | string | null;
  html_url?: string;
  body_html_url?: string;
  raw_text_url?: string;
  full_text_xml_url?: string;
}

export interface FetchExecutiveOrderListOptions {
  lookbackDays?: number;
  startDate?: string;
  endDate?: string;
  documentTypes?: string[];
  perPage?: number;
  maxPages?: number;
  fetchFullText?: boolean;
}

export interface FetchExecutiveOrderListResult {
  lookbackDays: number;
  windowStart: string;
  windowEnd: string;
  fetchFullText: boolean;
  items: EoListTarget[];
}

export interface IngestEoChunkOptions {
  fetchFullText?: boolean;
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

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return ["true", "1", "yes", "y"].includes(raw.trim().toLowerCase());
}

function parseCsv(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const entries = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}

function toEoListTarget(doc: FederalRegisterDocument): EoListTarget {
  return {
    document_number: String(doc.document_number ?? "").trim(),
    type: String(doc.type ?? "Presidential Document"),
    ...(doc.presidential_document_type !== undefined
      ? { presidential_document_type: doc.presidential_document_type }
      : {}),
    ...(doc.subtype !== undefined ? { subtype: doc.subtype } : {}),
    title: typeof doc.title === "string" ? doc.title : "",
    ...(doc.signing_date !== undefined ? { signing_date: doc.signing_date } : {}),
    ...(doc.publication_date !== undefined
      ? { publication_date: doc.publication_date }
      : {}),
    ...(doc.executive_order_number !== undefined
      ? { executive_order_number: doc.executive_order_number }
      : {}),
    ...(doc.presidential_document_number !== undefined
      ? { presidential_document_number: doc.presidential_document_number }
      : {}),
    ...(doc.proclamation_number !== undefined
      ? { proclamation_number: doc.proclamation_number }
      : {}),
    ...(doc.html_url !== undefined ? { html_url: doc.html_url } : {}),
    ...(doc.body_html_url !== undefined
      ? { body_html_url: doc.body_html_url }
      : {}),
    ...(doc.raw_text_url !== undefined ? { raw_text_url: doc.raw_text_url } : {}),
    ...(doc.full_text_xml_url !== undefined
      ? { full_text_xml_url: doc.full_text_xml_url }
      : {}),
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

async function countEosNeedingSummarization(
  changedEoIds: string[],
  hydratedWithTextIds: string[]
): Promise<number> {
  if (changedEoIds.length === 0) {
    return 0;
  }

  if (typeof db.executiveOrder?.count !== "function") {
    return hydratedWithTextIds.length;
  }

  return db.executiveOrder.count({
    where: {
      id: { in: changedEoIds },
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
 * Fetches paginated Federal Register presidential documents within the configured
 * lookback window using `cache: "no-store"` and 1s throttling.
 */
export async function fetchExecutiveOrderListStep(
  options: FetchExecutiveOrderListOptions = {}
): Promise<FetchExecutiveOrderListResult> {
  "use step";

  const lookbackDays = resolvePositiveNumber(
    options.lookbackDays,
    parsePositiveInt(
      process.env.EO_LOOKBACK_DAYS ?? process.env.INGEST_LOOKBACK_DAYS,
      DEFAULT_EO_LOOKBACK_DAYS
    )
  );
  const perPage = Math.min(
    MAX_EO_PER_PAGE,
    resolvePositiveNumber(
      options.perPage,
      parsePositiveInt(process.env.EO_PER_PAGE, DEFAULT_EO_PER_PAGE)
    )
  );
  const maxPages = resolvePositiveNumber(options.maxPages, DEFAULT_MAX_PAGES);
  const fetchFullText =
    options.fetchFullText ??
    parseBoolean(process.env.EO_FETCH_FULL_TEXT, true);
  const documentTypes = options.documentTypes?.length
    ? options.documentTypes
    : (parseCsv(process.env.EO_DOCUMENT_TYPES) ?? [...DEFAULT_EO_DOCUMENT_TYPES]);

  const window = determineLookupWindow(
    lookbackDays,
    options.startDate,
    options.endDate
  );
  const dateCondition = {
    gte: formatFederalRegisterDate(window.from),
    lte: formatFederalRegisterDate(window.to),
  };

  const seen = new Set<string>();
  const items: EoListTarget[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const response = await fetchExecutiveOrdersPage({
      page,
      perPage,
      conditions: {
        publicationDate: dateCondition,
        presidentialDocumentType: documentTypes,
      },
    });

    const documents = response.results ?? [];
    if (documents.length === 0) {
      break;
    }

    for (const doc of documents) {
      const target = toEoListTarget(doc);
      if (!target.document_number || seen.has(target.document_number)) {
        continue;
      }
      seen.add(target.document_number);
      items.push(target);
    }

    const totalPages = response.total_pages;
    if (
      typeof totalPages === "number"
        ? page >= totalPages
        : documents.length < perPage
    ) {
      break;
    }
  }

  return {
    lookbackDays,
    windowStart: window.from.toISOString(),
    windowEnd: window.to.toISOString(),
    fetchFullText,
    items,
  };
}

/**
 * Hydrates and persists a bounded chunk of executive orders via Prisma, returning
 * counts and how many changed orders have `fullText` needing summarization or
 * categorization.
 */
export async function ingestEoChunkStep(
  items: EoListTarget[],
  options: IngestEoChunkOptions = {}
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

  const fetchFullText = options.fetchFullText ?? true;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const changedEoIds: string[] = [];
  const hydratedWithTextIds: string[] = [];
  const errors: IngestItemError[] = [];

  for (const doc of items) {
    const identifier = buildExecutiveOrderIdentifier(doc);

    try {
      const hydrated = await hydrateExecutiveOrder({
        document: doc,
        fetchFullText,
      });
      const persisted = await persistExecutiveOrderPrisma(hydrated);

      switch (persisted.action) {
        case "created":
        case "updated": {
          if (persisted.action === "created") {
            created += 1;
          } else {
            updated += 1;
          }
          if (persisted.executiveOrderId) {
            changedEoIds.push(persisted.executiveOrderId);
            if (hydrated.fullText && hydrated.fullText.trim().length > 0) {
              hydratedWithTextIds.push(persisted.executiveOrderId);
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
            persisted.message ?? "Failed to persist executive order"
          );
          break;
        }
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ingest-eo] Failed to ingest executive order", {
        identifier,
        error: message,
      });
      pushBoundedError(errors, identifier, message);
    }
  }

  const needsSummarizationCount = await countEosNeedingSummarization(
    changedEoIds,
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
 * Backfills `fullText` and `fullTextUrl` for executive orders currently missing
 * `fullText`.
 */
export async function backfillEoTextsStep(
  batchSize?: number
): Promise<TextBackfillSummary> {
  "use step";

  const limit =
    batchSize !== undefined
      ? parseNonNegativeInt(batchSize, DEFAULT_EO_TEXT_BATCH_SIZE)
      : parsePositiveInt(
          process.env.EO_TEXT_BATCH_SIZE,
          DEFAULT_EO_TEXT_BATCH_SIZE
        );

  return backfillMissingEoTexts(limit);
}
