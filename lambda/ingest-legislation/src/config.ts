import { CURRENT_CONGRESS } from "./constants.js";
import type { EnvironmentConfig } from "./types.js";

export function loadEnvironmentConfig(): EnvironmentConfig {
  const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY;
  const INGEST_LOOKBACK_DAYS = process.env.INGEST_LOOKBACK_DAYS;
  const MINIMUM_LOG_LEVEL = process.env.MINIMUM_LOG_LEVEL;
  const TARGET_CONGRESS = process.env.TARGET_CONGRESS;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

  if (!CONGRESS_API_KEY) {
    throw new Error("CONGRESS_API_KEY is required to ingest legislation");
  }

  const lookbackDays = INGEST_LOOKBACK_DAYS
    ? Number.parseInt(INGEST_LOOKBACK_DAYS, 10)
    : 1;

  if (!Number.isFinite(lookbackDays) || lookbackDays <= 0) {
    throw new Error(
      `INGEST_LOOKBACK_DAYS must be a positive integer (received ${INGEST_LOOKBACK_DAYS})`
    );
  }

  const defaultCongress = TARGET_CONGRESS
    ? Number.parseInt(TARGET_CONGRESS, 10)
    : CURRENT_CONGRESS;

  if (!Number.isFinite(defaultCongress) || defaultCongress <= 0) {
    throw new Error(
      `TARGET_CONGRESS must be a positive integer (received ${TARGET_CONGRESS})`
    );
  }

  const minimumLogLevel =
    (MINIMUM_LOG_LEVEL as EnvironmentConfig["minimumLogLevel"]) ?? "info";
  const validLevels = new Set(["debug", "info", "warn", "error"] as const);

  if (!validLevels.has(minimumLogLevel)) {
    throw new Error(
      `MINIMUM_LOG_LEVEL must be one of debug, info, warn, or error (received ${MINIMUM_LOG_LEVEL})`
    );
  }

  if (!SUPABASE_URL) {
    throw new Error("SUPABASE_URL must be configured");
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) must be configured"
    );
  }

  return {
    congressApiKey: CONGRESS_API_KEY,
    lookbackDays,
    defaultCongress,
    minimumLogLevel,
    supabaseUrl: SUPABASE_URL,
    supabaseServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  };
}
