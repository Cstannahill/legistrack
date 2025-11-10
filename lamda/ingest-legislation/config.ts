import { CURRENT_CONGRESS } from "../../src/lib/constants";
import type { EnvironmentConfig } from "./types";

export function loadEnvironmentConfig(): EnvironmentConfig {
  const {
    CONGRESS_API_KEY,
    INGEST_LOOKBACK_DAYS,
    MINIMUM_LOG_LEVEL,
    TARGET_CONGRESS,
  } = process.env;

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

  const minimumLogLevel = (MINIMUM_LOG_LEVEL as EnvironmentConfig["minimumLogLevel"]) ?? "info";
  const validLevels = new Set(["debug", "info", "warn", "error"] as const);

  if (!validLevels.has(minimumLogLevel)) {
    throw new Error(
      `MINIMUM_LOG_LEVEL must be one of debug, info, warn, or error (received ${MINIMUM_LOG_LEVEL})`
    );
  }

  return {
    congressApiKey: CONGRESS_API_KEY,
    lookbackDays,
    defaultCongress,
    minimumLogLevel,
  };
}
