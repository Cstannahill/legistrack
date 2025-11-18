import type { Handler } from "aws-lambda";
import { loadEnvironmentConfig } from "./config.js";
import { getSupabaseClient } from "./db.js";
import {
  processBillSummaries,
  processExecutiveOrderSummaries,
} from "./workflows.js";
import type { LambdaSummaryResult } from "./types.js";

const config = loadEnvironmentConfig();
const supabase = getSupabaseClient(config);

export const handler: Handler = async (event, context): Promise<LambdaSummaryResult> => {
  const invocationMeta = {
    requestId: context?.awsRequestId,
    runId: Math.random().toString(36).slice(2, 10),
    eventSource: event && typeof event === "object" ? (event as any).source : undefined,
  };

  console.info("[summarize] Invocation start", invocationMeta);

  const bills = await processBillSummaries(supabase, config);
  if (bills.errors.length) {
    console.error("[summarize] Bill errors", bills.errors);
  }
  const executiveOrders = await processExecutiveOrderSummaries(supabase, config);
  if (executiveOrders.errors.length) {
    console.error("[summarize] Executive order errors", executiveOrders.errors);
  }

  const result: LambdaSummaryResult = { bills, executiveOrders };
  console.info("[summarize] Invocation complete", result);
  return result;
};

