import type { Handler } from "aws-lambda";
import { createLogger } from "./logger.js";
import { loadEnvironmentConfig } from "./config.js";
import { CongressClient } from "./congressClient.js";
import { hydrateBill } from "./hydration.js";
import { persistHydratedBill } from "./persistence.js";
import type {
  IngestLegislationEvent,
  IngestLegislationResult,
  PersistedBillResult,
} from "./types.js";
import {
  buildBillIdentifier,
  determineLookupWindow,
  formatForCongressApi,
} from "./utils.js";
import { getSupabaseClient } from "./db.js";

const env = loadEnvironmentConfig();
const baseLogger = createLogger({
  context: "ingest-legislation",
  minimumLevel: env.minimumLogLevel,
});
const supabase = getSupabaseClient({
  supabaseUrl: env.supabaseUrl,
  supabaseServiceRoleKey: env.supabaseServiceRoleKey,
});
const congressClient = new CongressClient({
  apiKey: env.congressApiKey,
  logger: baseLogger.child("congress"),
});
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const handler: Handler<
  IngestLegislationEvent,
  IngestLegislationResult
> = async (event = {}) => {
  const runId = Math.random().toString(36).slice(2, 10);
  const logger = baseLogger.child(`run:${runId}`);
  const lookbackDays = event?.lookbackDays ?? env.lookbackDays;
  const targetCongress = event?.congress ?? env.defaultCongress;
  const window = determineLookupWindow(
    lookbackDays,
    event.startDate,
    event.endDate
  );

  logger.info("Starting legislation ingestion", {
    runId,
    start: window.from.toISOString(),
    end: window.to.toISOString(),
    congress: targetCongress,
    billTypes: event.billTypes,
    limit: event.limit,
  });

  const limit = event.limit ?? 100;
  let offset = 0;
  const results: PersistedBillResult[] = [];

  while (true) {
    const page = await congressClient.fetchBillPage({
      congress: targetCongress,
      billTypes: event.billTypes,
      limit,
      offset,
      fromDateTime: formatForCongressApi(window.from),
      toDateTime: formatForCongressApi(window.to),
    });

    const bills = page.bills ?? [];
    logger.info("Fetched bill page", {
      runId,
      count: bills.length,
      offset,
    });

    if (bills.length === 0) {
      break;
    }

    for (const bill of bills) {
      const identifier = buildBillIdentifier(bill);
      try {
        const hydrated = await hydrateBill({
          client: congressClient,
          bill,
          logger,
        });
        const result = await persistHydratedBill({
          data: hydrated,
          client: congressClient,
          supabase,
          logger,
        });
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("Failed to ingest bill", { identifier, message, runId });
        results.push({
          action: "failed",
          identifier,
          message,
        });
      }
    }

    offset += bills.length;
    await delay(1000);
    const nextUrl = page.pagination?.next;
    if (!nextUrl || bills.length < limit) {
      break;
    }
  }

  const summary: IngestLegislationResult = {
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

  logger.info("Legislation ingestion finished", { runId, summary });

  return summary;
};
