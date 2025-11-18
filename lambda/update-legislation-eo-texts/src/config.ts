import type { EnvironmentConfig } from "./types.js";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveInt(names: string[], fallback: number): number {
  for (const name of names) {
    const raw = process.env[name];
    if (raw) {
      return parsePositiveInt(raw, fallback);
    }
  }
  return fallback;
}

export function loadEnvironmentConfig(): EnvironmentConfig {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL must be configured for update-legislation-eo-texts lambda");
  }

  if (!supabaseServiceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) must be configured for update-legislation-eo-texts lambda"
    );
  }

  const billBatchSize = resolveInt(
    ["BILL_TEXT_BATCH_SIZE", "BILL_BATCH_SIZE"],
    5
  );
  const executiveOrderBatchSize = resolveInt(
    ["EO_TEXT_BATCH_SIZE", "EO_BATCH_SIZE"],
    5
  );

  const billDelayMs = resolveInt(["BILL_TEXT_DELAY_MS"], 500);
  const executiveOrderDelayMs = resolveInt(["EO_TEXT_DELAY_MS"], 1000);

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    billBatchSize,
    executiveOrderBatchSize,
    billDelayMs,
    executiveOrderDelayMs,
  };
}
