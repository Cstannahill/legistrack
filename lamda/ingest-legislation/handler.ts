import { config as loadEnv } from "dotenv";
import { createLogger } from "../logger";
import { loadEnvironmentConfig } from "./config";
import { CongressClient } from "./congressClient";
import { hydrateBill } from "./hydration";
import { persistHydratedBill } from "./persistence";
import type {
  IngestLegislationEvent,
  IngestLegislationResult,
  PersistedBillResult,
} from "./types";
import {
  buildBillIdentifier,
  determineLookupWindow,
  formatForCongressApi,
} from "./utils";

loadEnv();

export async function handler(
  event: IngestLegislationEvent = {}
): Promise<IngestLegislationResult> {
  const envConfig = loadEnvironmentConfig();
  const logger = createLogger({
    context: "ingest-legislation",
    minimumLevel: envConfig.minimumLogLevel,
  });

  const window = determineLookupWindow(
    event.lookbackDays ?? envConfig.lookbackDays,
    event.startDate,
    event.endDate
  );

  logger.info("Starting legislation ingestion", {
    start: window.from.toISOString(),
    end: window.to.toISOString(),
    congress: event.congress ?? envConfig.defaultCongress,
  });

  const client = new CongressClient({
    apiKey: envConfig.congressApiKey,
    logger,
  });

  const limit = event.limit ?? 100;
  let offset = 0;
  const results: PersistedBillResult[] = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await client.fetchBillPage({
      congress: event.congress ?? envConfig.defaultCongress,
      billTypes: event.billTypes,
      limit,
      offset,
      fromDateTime: formatForCongressApi(window.from),
      toDateTime: formatForCongressApi(window.to),
    });

    const bills = page.bills ?? [];
    logger.info("Fetched bill page", { count: bills.length, offset });

    if (bills.length === 0) {
      break;
    }

    for (const bill of bills) {
      const identifier = buildBillIdentifier(bill);
      try {
        const hydrated = await hydrateBill({ client, bill, logger });
        const result = await persistHydratedBill({
          data: hydrated,
          client,
          logger,
        });
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("Failed to ingest bill", { identifier, message });
        results.push({
          action: "failed",
          identifier,
          message,
        });
      }
    }

    offset += bills.length;
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

  logger.info("Legislation ingestion finished", { summary });

  return summary;
}
