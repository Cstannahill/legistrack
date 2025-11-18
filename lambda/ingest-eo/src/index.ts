import type { Handler } from "aws-lambda";
import { createLogger } from "./logger.js";
import { loadEnvironmentConfig } from "./config.js";
import { getSupabaseClient } from "./db.js";
import { fetchExecutiveOrders } from "./federalRegisterApi.js";
import { hydrateExecutiveOrder } from "./hydration.js";
import { persistExecutiveOrder } from "./persistence.js";
import type {
  IngestExecutiveOrdersEvent,
  IngestExecutiveOrdersResult,
  PersistedExecutiveOrderResult,
} from "./types.js";
import {
  buildExecutiveOrderIdentifier,
  determineLookupWindow,
  formatFederalRegisterDate,
} from "./utils.js";

const env = loadEnvironmentConfig();
const baseLogger = createLogger({
  context: "ingest-executive-orders",
  minimumLevel: env.minimumLogLevel,
});
const supabase = getSupabaseClient({
  supabaseUrl: env.supabaseUrl,
  supabaseServiceRoleKey: env.supabaseServiceRoleKey,
});
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const handler: Handler<
  IngestExecutiveOrdersEvent,
  IngestExecutiveOrdersResult
> = async (rawEvent) => {
  const event: IngestExecutiveOrdersEvent = rawEvent ?? {};
  const runId = Math.random().toString(36).slice(2, 10);
  const logger = baseLogger.child(`run:${runId}`);
  const lookbackDays = event.lookbackDays ?? env.lookbackDays;
  const window = determineLookupWindow(
    lookbackDays,
    event.startDate,
    event.endDate
  );

  const perPage = Math.min(event.perPage ?? env.defaultPerPage, 1000);
  const fetchFullText = event.fetchFullText ?? env.defaultFetchFullText;
  const maxPages = event.maxPages ?? Number.POSITIVE_INFINITY;
  const documentTypes =
    event.documentTypes && event.documentTypes.length > 0
      ? event.documentTypes
      : env.defaultDocumentTypes;

  logger.info("Starting executive order ingestion", {
    runId,
    windowStart: window.from.toISOString(),
    windowEnd: window.to.toISOString(),
    perPage,
    fetchFullText,
    documentTypes: documentTypes ?? "all",
  });

  const dateCondition = {
    gte: formatFederalRegisterDate(window.from),
    lte: formatFederalRegisterDate(window.to),
  };

  let page = 1;
  let processedPages = 0;
  const results: PersistedExecutiveOrderResult[] = [];

  while (processedPages < maxPages) {
    const response = await fetchExecutiveOrders({
      page,
      perPage,
      conditions: {
        publicationDate: dateCondition,
        presidentialDocumentType: documentTypes,
      },
    });

    const documents = response.results ?? [];
    logger.info("Fetched executive order page", {
      runId,
      page,
      count: documents.length,
      totalPages: response.total_pages,
    });

    if (documents.length === 0) {
      break;
    }

    for (const document of documents) {
      const identifier = buildExecutiveOrderIdentifier(document);
      try {
        const hydrated = await hydrateExecutiveOrder({
          document,
          fetchFullText,
          logger,
        });
        const result = await persistExecutiveOrder({
          supabase,
          data: hydrated,
          logger,
        });
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("Failed to process executive order", {
          identifier,
          message,
          runId,
        });
        results.push({
          action: "failed",
          identifier,
          message,
        });
      }
    }
    await delay(1000);
    processedPages++;
    page++;

    if (page > response.total_pages) {
      break;
    }
  }

  const summary: IngestExecutiveOrdersResult = {
    processed: results.length,
    created: results.filter((r) => r.action === "created").length,
    updated: results.filter((r) => r.action === "updated").length,
    skipped: results.filter((r) => r.action === "skipped").length,
    failed: results.filter((r) => r.action === "failed").length,
    windowStart: window.from.toISOString(),
    windowEnd: window.to.toISOString(),
    details: results.map((result) => ({
      identifier: result.identifier,
      action: result.action,
      message: result.message,
    })),
  };

  logger.info("Executive order ingestion finished", {
    runId,
    summary,
  });

  return summary;
};
