import gptOss from "./openrouter-models/gpt-oss-20b.json" with { type: "json" };
import katCoder from "./openrouter-models/kat-coder-pro.json" with { type: "json" };
import type { EnvironmentConfig, OpenRouterModelKey } from "./types.js";

export const MODEL_REGISTRY: Record<OpenRouterModelKey, typeof gptOss> = {
  "openai/gpt-oss-20b:free": gptOss,
  "kwaipilot/kat-coder-pro:free": katCoder,
};

function getEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getEnvIndex(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function getModelKey(name: string, fallback: OpenRouterModelKey): OpenRouterModelKey {
  const raw = process.env[name];
  if (!raw) return fallback;
  if (raw in MODEL_REGISTRY) {
    return raw as OpenRouterModelKey;
  }
  console.warn(
    `[config] Unsupported OpenRouter model key '${raw}' for ${name}; falling back to ${fallback}`
  );
  return fallback;
}

export function loadEnvironmentConfig(): EnvironmentConfig {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL must be configured for summarize lambda");
  }
  if (!supabaseServiceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) must be configured for summarize lambda"
    );
  }

  const billBatchSize = getEnvInt("OPENROUTER_BILL_BATCH_SIZE", getEnvInt("BILL_SUMMARY_BATCH_SIZE", 5));
  const executiveOrderBatchSize = getEnvInt("OPENROUTER_EO_BATCH_SIZE", getEnvInt("EO_SUMMARY_BATCH_SIZE", 5));

  const billModelKey = getModelKey("OPENROUTER_BILL_MODEL", "openai/gpt-oss-20b:free");
  const executiveOrderModelKey = getModelKey(
    "OPENROUTER_EO_MODEL",
    "kwaipilot/kat-coder-pro:free"
  );

  const siteUrl = process.env.SITE_URL || "https://legistrack.vercel.app";
  const appName = process.env.APP_NAME || "Legistrack Summarizer";

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    siteUrl,
    appName,
    billBatchSize,
    executiveOrderBatchSize,
    billModelKey,
    executiveOrderModelKey,
    billKeyIndex: getEnvIndex("OPENROUTER_BILL_KEY_INDEX", 0),
    executiveOrderKeyIndex: getEnvIndex("OPENROUTER_EO_KEY_INDEX", 1),
  };
}


