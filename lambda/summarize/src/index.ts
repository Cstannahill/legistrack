import type { Handler } from "aws-lambda";
import { loadEnvironmentConfig } from "./config.js";
import { getSupabaseClient } from "./db.js";
import {
  processBillSummaries,
  processExecutiveOrderSummaries,
} from "./workflows.js";
import type { BatchProcessMetrics, LambdaSummaryResult } from "./types.js";

const config = loadEnvironmentConfig();
const supabase = getSupabaseClient(config);

export const handler: Handler = async (event, context): Promise<LambdaSummaryResult> => {
  const invocationMeta = {
    requestId: context?.awsRequestId,
    runId: Math.random().toString(36).slice(2, 10),
    eventSource: event && typeof event === "object" ? (event as any).source : undefined,
  };

  console.info("[summarize] Invocation start", invocationMeta);

  let bills = await processBillSummaries(supabase, config);
  const executiveOrders = await processExecutiveOrderSummaries(supabase, config);
  if (executiveOrders.errors.length) {
    console.error("[summarize] Executive order errors", executiveOrders.errors);
  }
  const executiveOrderShortfall = Math.max(
    config.executiveOrderBatchSize - executiveOrders.prepared,
    0
  );
  if (executiveOrderShortfall > 0) {
    console.info(
      `[summarize] Executive order batch filled with ${executiveOrderShortfall} additional bill(s)`
    );
    const topOffBills = await processBillSummaries(
      supabase,
      config,
      executiveOrderShortfall
    );
    bills = mergeBatchMetrics(bills, topOffBills);
  }
  if (bills.errors.length) {
    console.error("[summarize] Bill errors", bills.errors);
  }

  const result: LambdaSummaryResult = { bills, executiveOrders };
  console.info("[summarize] Invocation complete", result);
  return result;
};

function mergeBatchMetrics(
  primary: BatchProcessMetrics,
  addition: BatchProcessMetrics
): BatchProcessMetrics {
  return {
    requested: primary.requested + addition.requested,
    prepared: primary.prepared + addition.prepared,
    summarized: primary.summarized + addition.summarized,
    persisted: primary.persisted + addition.persisted,
    skipped: primary.skipped + addition.skipped,
    failed: primary.failed + addition.failed,
    errors: [...primary.errors, ...addition.errors],
  };
}

