import type { Handler } from "aws-lambda";
import { loadEnvironmentConfig } from "./config.js";
import { getSupabaseClient } from "./db.js";
import {
  updateBillTexts,
  updateExecutiveOrderTexts,
} from "./workflows.js";
import type { LambdaResult } from "./types.js";

const config = loadEnvironmentConfig();
const supabase = getSupabaseClient(config);

export const handler: Handler = async (): Promise<LambdaResult> => {
  console.info("[update-texts] Invocation start", {
    billBatchSize: config.billBatchSize,
    executiveOrderBatchSize: config.executiveOrderBatchSize,
  });

  const bills = await updateBillTexts(supabase, config);
  const executiveOrders = await updateExecutiveOrderTexts(supabase, config);

  const result: LambdaResult = { bills, executiveOrders };
  console.info("[update-texts] Invocation complete", result);
  return result;
};
