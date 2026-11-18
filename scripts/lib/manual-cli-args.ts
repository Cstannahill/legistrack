import { CURRENT_CONGRESS } from "@/lib/constants";
import {
  DEFAULT_OPENROUTER_MODELS,
  GEMINI_FALLBACK_MODEL,
  OPENROUTER_MODEL_ALIASES,
  type LlmRoutingOptions,
} from "@/lib/llm/types";

export type ManualModelAlias =
  | "deepseek"
  | "mimo"
  | "glm"
  | "gemini"
  | "cascade";

export interface ResolvedManualModelTarget {
  alias: string;
  label: string;
  usesOpenRouter: boolean;
  usesGemini: boolean;
  llmOptions?: LlmRoutingOptions;
}

export interface ParsedCliArgs {
  flags: Record<string, string | boolean>;
  positionals: string[];
}

/**
 * Parses CLI flags in `--key=value`, `--key value`, or `--boolean-flag` forms.
 */
export function parseCliFlags(argv: string[]): ParsedCliArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const eqIndex = arg.indexOf("=");
    if (eqIndex !== -1) {
      const key = arg.slice(2, eqIndex).trim().toLowerCase();
      const value = arg.slice(eqIndex + 1);
      if (key) {
        flags[key] = value;
      }
      continue;
    }

    const key = arg.slice(2).trim().toLowerCase();
    if (!key) continue;

    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }

  return { flags, positionals };
}

export function getStringFlag(
  flags: Record<string, string | boolean>,
  key: string
): string | undefined {
  const raw = flags[key.toLowerCase()];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getBooleanFlag(
  flags: Record<string, string | boolean>,
  key: string
): boolean {
  const raw = flags[key.toLowerCase()];
  if (raw === true) return true;
  if (typeof raw === "string") {
    return ["true", "1", "yes", "y"].includes(raw.trim().toLowerCase());
  }
  return false;
}

export function getPositiveIntFlag(
  flags: Record<string, string | boolean>,
  key: string,
  fallback?: number
): number | undefined {
  const raw = getStringFlag(flags, key);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`--${key} must be a positive integer (received "${raw}")`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${key} must be a positive integer (received "${raw}")`);
  }
  return parsed;
}

export function getNonNegativeIntFlag(
  flags: Record<string, string | boolean>,
  key: string,
  fallback?: number
): number | undefined {
  const raw = getStringFlag(flags, key);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `--${key} must be a non-negative integer (received "${raw}")`
    );
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `--${key} must be a non-negative integer (received "${raw}")`
    );
  }
  return parsed;
}

export function getCsvFlag(
  flags: Record<string, string | boolean>,
  key: string
): string[] | undefined {
  const raw = getStringFlag(flags, key);
  if (!raw) return undefined;
  const items = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/**
 * Parses bill identifiers like `"HR 4398"`, `"H.R. 4398"`, `"119-hr-4398"`,
 * or `"S 2309"` into CongressClient-compatible target parameters.
 */
export function parseBillIdentifier(
  raw: string,
  defaultCongress: number = CURRENT_CONGRESS
): { congress: number; type: string; number: string } {
  const cleaned = raw.trim().replace(/\./g, "").replace(/\s+/g, " ");
  const withCongress = cleaned.match(/^(\d{2,3})[-\s]+([A-Za-z]+)[-\s]*(\d+)$/);
  if (withCongress) {
    return {
      congress: Number.parseInt(withCongress[1], 10),
      type: withCongress[2].toLowerCase(),
      number: withCongress[3],
    };
  }

  const withoutCongress = cleaned.match(/^([A-Za-z]+)[-\s]*(\d+)$/);
  if (withoutCongress) {
    return {
      congress: defaultCongress,
      type: withoutCongress[1].toLowerCase(),
      number: withoutCongress[2],
    };
  }

  throw new Error(
    `Invalid bill identifier "${raw}". Examples: "HR 4398", "119-hr-4398", "S 2309".`
  );
}

/**
 * Resolves a model alias (`deepseek`, `mimo`, `glm`, `gemini`, `cascade`) or
 * OpenRouter model slug into concrete `LlmRoutingOptions`.
 */
export function resolveManualModelTarget(
  rawModel?: string,
  options?: { allowFallback?: boolean }
): ResolvedManualModelTarget {
  const allowFallback = options?.allowFallback === true;
  const normalized = (rawModel || "cascade").trim().toLowerCase();

  if (normalized === "cascade" || normalized === "auto") {
    return {
      alias: "cascade",
      label: `Auto Cascade (${DEFAULT_OPENROUTER_MODELS.join(" -> ")} -> ${GEMINI_FALLBACK_MODEL})`,
      usesOpenRouter: true,
      usesGemini: true,
      llmOptions: undefined,
    };
  }

  if (normalized === "gemini" || normalized === GEMINI_FALLBACK_MODEL) {
    return {
      alias: "gemini",
      label: `Gemini 3.8 Flash (${GEMINI_FALLBACK_MODEL}, direct @google/genai)`,
      usesOpenRouter: false,
      usesGemini: true,
      llmOptions: {
        provider: "gemini",
      },
    };
  }

  if (
    normalized === "deepseek" ||
    normalized === "deepseek-flash" ||
    normalized === OPENROUTER_MODEL_ALIASES.deepseek
  ) {
    const slug = OPENROUTER_MODEL_ALIASES.deepseek;
    return {
      alias: "deepseek",
      label: `DeepSeek V4.1 Flash (${slug})`,
      usesOpenRouter: true,
      usesGemini: allowFallback,
      llmOptions: {
        provider: allowFallback ? "auto" : "openrouter",
        openRouterModels: allowFallback
          ? [slug, ...DEFAULT_OPENROUTER_MODELS.filter((m) => m !== slug)]
          : [slug],
        allowGeminiFallback: allowFallback,
      },
    };
  }

  if (
    normalized === "mimo" ||
    normalized === "mimo-flash" ||
    normalized === OPENROUTER_MODEL_ALIASES.mimo
  ) {
    const slug = OPENROUTER_MODEL_ALIASES.mimo;
    return {
      alias: "mimo",
      label: `Xiaomi MiMo V2.6 Flash (${slug})`,
      usesOpenRouter: true,
      usesGemini: allowFallback,
      llmOptions: {
        provider: allowFallback ? "auto" : "openrouter",
        openRouterModels: allowFallback
          ? [slug, ...DEFAULT_OPENROUTER_MODELS.filter((m) => m !== slug)]
          : [slug],
        allowGeminiFallback: allowFallback,
      },
    };
  }

  if (
    normalized === "glm" ||
    normalized === "glm-flash" ||
    normalized === OPENROUTER_MODEL_ALIASES.glm
  ) {
    const slug = OPENROUTER_MODEL_ALIASES.glm;
    return {
      alias: "glm",
      label: `GLM 5.3 Flash (${slug})`,
      usesOpenRouter: true,
      usesGemini: allowFallback,
      llmOptions: {
        provider: allowFallback ? "auto" : "openrouter",
        openRouterModels: allowFallback
          ? [slug, ...DEFAULT_OPENROUTER_MODELS.filter((m) => m !== slug)]
          : [slug],
        allowGeminiFallback: allowFallback,
      },
    };
  }

  if (rawModel && rawModel.includes("/")) {
    const slug = rawModel.trim();
    return {
      alias: slug,
      label: `OpenRouter (${slug})`,
      usesOpenRouter: true,
      usesGemini: allowFallback,
      llmOptions: {
        provider: allowFallback ? "auto" : "openrouter",
        openRouterModels: [slug],
        allowGeminiFallback: allowFallback,
      },
    };
  }

  throw new Error(
    `Unknown model "${rawModel}". Supported models: deepseek, gemini, glm, mimo, cascade (or an OpenRouter slug like "provider/model").`
  );
}
