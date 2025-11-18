import type { EnvironmentConfig } from "./types.js";

const VALID_LOG_LEVELS = new Set(["debug", "info", "warn", "error"] as const);
function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["true", "1", "yes", "y"].includes(value.toLowerCase());
}

function parseDocumentTypes(value?: string): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length ? parsed : undefined;
}

export function loadEnvironmentConfig(): EnvironmentConfig {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL must be configured for ingest-eo lambda");
  }

  if (!supabaseServiceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) must be configured for ingest-eo lambda"
    );
  }

  const lookbackDays = parsePositiveInt(
    process.env.EO_LOOKBACK_DAYS ?? process.env.INGEST_LOOKBACK_DAYS,
    14
  );

  const defaultPerPage = parsePositiveInt(
    process.env.EO_PER_PAGE ?? process.env.INGEST_EO_PER_PAGE,
    100
  );

  const defaultFetchFullText = parseBoolean(
    process.env.EO_FETCH_FULL_TEXT,
    true
  );

  const minimumLogLevel =
    (process.env.MINIMUM_LOG_LEVEL as EnvironmentConfig["minimumLogLevel"]) ??
    "info";

  if (!VALID_LOG_LEVELS.has(minimumLogLevel)) {
    throw new Error(
      `MINIMUM_LOG_LEVEL must be one of ${Array.from(VALID_LOG_LEVELS).join(", ")}`
    );
  }

  const defaultDocumentTypes =
    parseDocumentTypes(process.env.EO_DOCUMENT_TYPES) ??
    parseDocumentTypes(process.env.INGEST_EO_DOCUMENT_TYPES);

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    lookbackDays,
    minimumLogLevel,
    defaultPerPage,
    defaultFetchFullText,
    defaultDocumentTypes,
  };
}
