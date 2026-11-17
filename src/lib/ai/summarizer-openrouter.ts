/**
 * OpenRouter AI Summarizer
 *
 * Supports paid Flash cascade models and legacy aliases via OpenRouter:
 * - deepseek-flash: DeepSeek V4.1 Flash (primary paid cascade model)
 * - mimo-flash: Xiaomi MiMo V2.6 Flash (cascade model 2)
 * - glm-flash: GLM 5.3 Flash (cascade model 3)
 * - deepseek / qwen / gemini / mistral: legacy aliases
 */

import OpenAI from "openai";
import { SUMMARIZATION_PROMPTS } from "./prompts";
import type { SummaryType } from "@prisma/client";
import { getOpenRouterKeys } from "@/lib/openrouter-keys";

export interface OpenRouterModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  description: string;
}

export const OPENROUTER_MODELS = {
  "deepseek-flash": {
    id: "deepseek/deepseek-v4.1-flash-1017",
    name: "DeepSeek V4.1 Flash",
    contextWindow: 163800,
    description: "Paid low-cost DeepSeek Flash primary model",
  },
  "mimo-flash": {
    id: "xiaomi/mimo-v2.6-flash",
    name: "Xiaomi MiMo V2.6 Flash",
    contextWindow: 131072,
    description: "Paid low-cost MiMo Flash cascade model",
  },
  "glm-flash": {
    id: "z-ai/glm-5.3-flash",
    name: "GLM 5.3 Flash",
    contextWindow: 131072,
    description: "Paid low-cost GLM Flash cascade model",
  },
  deepseek: {
    id: "deepseek/deepseek-chat-v3.1:free",
    name: "DeepSeek V3.1",
    contextWindow: 163800,
    description: "671B params (37B active), best quality-to-cost ratio",
  },
  qwen: {
    id: "qwen/qwen3-235b-a22b:free",
    name: "Qwen3 235B A22B",
    contextWindow: 131072,
    description: "235B params (22B active), strong reasoning",
  },
  gemini: {
    id: "google/gemini-2.0-flash-exp:free",
    name: "Gemini 2.0 Flash",
    contextWindow: 1048576,
    description: "1M context window, can handle entire bills",
  },
  mistral: {
    id: "mistralai/mistral-small-3.2-24b-instruct:free",
    name: "Mistral Small 3.2",
    contextWindow: 131072,
    description: "24B params, fast and efficient",
  },
} as const satisfies Record<string, OpenRouterModelInfo>;

export type OpenRouterModel = keyof typeof OPENROUTER_MODELS;

const PROVIDER_NAMES = new Set(["openrouter", "openai", "anthropic"]);
const DEFAULT_OPENROUTER_TIMEOUT_MS = 60_000;

function getOpenRouterTimeoutMs(
  envObj: Partial<NodeJS.ProcessEnv> = process.env
): number {
  const raw = envObj.OPENROUTER_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_OPENROUTER_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_OPENROUTER_TIMEOUT_MS;
}

function matchModelEntry(
  model?: string | null
): { key: string; config: OpenRouterModelInfo } | null {
  const trimmed = model?.trim();
  if (!trimmed) {
    return null;
  }

  const lowered = trimmed.toLowerCase();
  if (PROVIDER_NAMES.has(lowered)) {
    return null;
  }

  if (lowered in OPENROUTER_MODELS) {
    return {
      key: lowered,
      config: OPENROUTER_MODELS[lowered as OpenRouterModel],
    };
  }

  const byId = Object.entries(OPENROUTER_MODELS).find(
    ([, entry]) => entry.id.toLowerCase() === lowered
  );
  if (byId) {
    return { key: byId[0], config: byId[1] };
  }

  if (trimmed.includes("/")) {
    return {
      key: trimmed,
      config: {
        id: trimmed,
        name: trimmed,
        contextWindow: 131072,
        description: "Configured OpenRouter model",
      },
    };
  }

  return null;
}

/**
 * Resolves an explicit model name/slug or falls back to `deepseek-flash`
 * without treating provider names (`"openrouter"`, `"openai"`, `"anthropic"`)
 * as lookup keys.
 */
export function resolveOpenRouterModelEntry(
  model?: string | null
): { key: string; config: OpenRouterModelInfo } {
  return (
    matchModelEntry(model) ?? {
      key: "deepseek-flash",
      config: OPENROUTER_MODELS["deepseek-flash"],
    }
  );
}

/**
 * Resolves the OpenRouter model configuration from environment variables
 * (`OPENROUTER_MODEL`, then `AI_MODEL`), ignoring provider strings.
 */
export function resolveOpenRouterModelConfig(
  envObj: Partial<NodeJS.ProcessEnv> = process.env
): OpenRouterModelInfo {
  return (
    matchModelEntry(envObj.OPENROUTER_MODEL)?.config ??
    matchModelEntry(envObj.AI_MODEL)?.config ??
    OPENROUTER_MODELS["deepseek-flash"]
  );
}

interface GenerateSummaryParams {
  title: string;
  fullText: string;
  summaryType: SummaryType;
  model?: OpenRouterModel | (string & {});
}

interface SummaryResponse {
  content: string;
  keyPoints: string[];
  impactAreas: string[];
  confidence: number;
  model: string;
}

/**
 * Generate summary using OpenRouter models with lazy key discovery & rotation.
 */
export async function generateSummaryOpenRouter({
  title,
  fullText,
  summaryType,
  model = "deepseek-flash",
}: GenerateSummaryParams): Promise<SummaryResponse> {
  const { key: resolvedKey, config: modelConfig } =
    resolveOpenRouterModelEntry(model);
  const openRouterKeys = getOpenRouterKeys();

  if (openRouterKeys.length === 0) {
    throw new Error("OPENROUTER_API_KEY environment variable is not set");
  }

  const promptTemplate = SUMMARIZATION_PROMPTS[summaryType];
  const prompt = promptTemplate
    .replace("{{TITLE}}", title)
    .replace("{{FULL_TEXT}}", fullText)
    .replace("{{BILL_TYPE}}", "")
    .replace("{{SPONSOR}}", "")
    .replace("{{STATUS}}", "");

  console.log(`   🌐 Using OpenRouter model: ${modelConfig.name}`);
  console.log(
    `   📊 Context window: ${modelConfig.contextWindow.toLocaleString()} tokens`
  );

  let lastError: unknown;

  for (const apiKey of openRouterKeys) {
    try {
      const openrouter = new OpenAI({
        apiKey,
        baseURL: "https://openrouter.ai/api/v1",
        maxRetries: 0,
        timeout: getOpenRouterTimeoutMs(),
      });

      const completion = await openrouter.chat.completions.create(
        {
          model: modelConfig.id,
          messages: [
            {
              role: "system",
              content:
                "You are a legislative analyst providing clear, accurate summaries of bills.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 4000,
        },
        {
          headers: {
            "HTTP-Referer":
              process.env.SITE_URL || "https://legistrack.vercel.app",
            "X-Title": "Legislation Tracker - Bill Summarization",
          },
        }
      );

      const content = completion.choices[0]?.message?.content;

      if (!content) {
        throw new Error("No content returned from OpenRouter API");
      }

      const parsed = parseStructuredResponse(content);

      return {
        content: parsed.content,
        keyPoints: parsed.keyPoints,
        impactAreas: parsed.impactAreas,
        confidence: parsed.confidence,
        model: `${modelConfig.name} (${resolvedKey})`,
      };
    } catch (error) {
      lastError = error;
      const status =
        typeof error === "object" && error !== null
          ? (error as { status?: number }).status
          : undefined;
      if (
        status === 401 ||
        status === 402 ||
        status === 429 ||
        (status !== undefined && status >= 500)
      ) {
        continue;
      }
      console.error(`OpenRouter API error with ${modelConfig.name}:`, error);
      throw error;
    }
  }

  console.error(`OpenRouter API error with ${modelConfig.name}:`, lastError);
  throw lastError;
}

/**
 * Parse structured response from AI
 * Expected format:
 * SUMMARY: <summary text>
 * KEY_POINTS:
 * - point 1
 * - point 2
 * IMPACT_AREAS: area1, area2, area3
 * CONFIDENCE: 0.85
 */
function parseStructuredResponse(content: string): {
  content: string;
  keyPoints: string[];
  impactAreas: string[];
  confidence: number;
} {
  const trimmedContent = content.trim();

  // Preferred format: Markdown headings (matches OpenAI/Anthropic outputs)
  const summaryMatch = trimmedContent.match(
    /## Summary\n([\s\S]*?)(?=\n##|$)/i
  );
  const keyPointsMatch = trimmedContent.match(
    /## Key Points\n([\s\S]*?)(?=\n##|$)/i
  );
  const impactAreasMatch = trimmedContent.match(
    /## Impact Areas\n([\s\S]*?)(?=\n##|$)/i
  );
  const confidenceMatch = trimmedContent.match(
    /## Confidence\n([\s\S]*?)(?=\n##|$)/i
  );

  if (summaryMatch || keyPointsMatch || impactAreasMatch) {
    const summary =
      summaryMatch?.[1]?.trim() || trimmedContent.split("\n\n")[0];
    const keyPoints =
      keyPointsMatch?.[1]
        ?.split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^[-*\d\.\)\s]+/, "").trim()) || [];

    const impactAreas =
      impactAreasMatch?.[1]
        ?.split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^[-*\d\.\)\s]+/, "").trim()) || [];

    const confidenceValue = confidenceMatch?.[1]
      ?.trim()
      ?.replace(/[^0-9\.]/g, "");
    const confidence = confidenceValue ? parseFloat(confidenceValue) : 0.8;

    return {
      content: summary,
      keyPoints,
      impactAreas: [...new Set(impactAreas)],
      confidence: isNaN(confidence) ? 0.8 : confidence,
    };
  }

  // Legacy format fallback: Label-based sections (SUMMARY:, KEY_POINTS:, etc.)
  const lines = trimmedContent.split("\n");
  let summary = "";
  const keyPoints: string[] = [];
  const impactAreas: string[] = [];
  let confidence = 0.8;

  let currentSection: "summary" | "keypoints" | "impact" | null = null;

  for (const line of lines) {
    const lineTrimmed = line.trim();

    if (lineTrimmed.startsWith("SUMMARY:")) {
      currentSection = "summary";
      summary = lineTrimmed.replace("SUMMARY:", "").trim();
      continue;
    }

    if (lineTrimmed.startsWith("KEY_POINTS:")) {
      currentSection = "keypoints";
      continue;
    }

    if (lineTrimmed.startsWith("IMPACT_AREAS:")) {
      currentSection = "impact";
      const areasText = lineTrimmed.replace("IMPACT_AREAS:", "").trim();
      if (areasText) {
        impactAreas.push(...areasText.split(",").map((a) => a.trim()));
      }
      continue;
    }

    if (lineTrimmed.startsWith("CONFIDENCE:")) {
      const confText = lineTrimmed.replace("CONFIDENCE:", "").trim();
      const parsed = parseFloat(confText);
      if (!isNaN(parsed)) {
        confidence = parsed;
      }
      currentSection = null;
      continue;
    }

    if (currentSection === "summary" && lineTrimmed) {
      summary += (summary ? " " : "") + lineTrimmed;
    } else if (currentSection === "keypoints" && lineTrimmed) {
      const point = lineTrimmed.replace(/^[-*\d\.\)\s]+/, "").trim();
      if (point) keyPoints.push(point);
    } else if (currentSection === "impact" && lineTrimmed) {
      impactAreas.push(
        ...lineTrimmed
          .split(",")
          .map((area) => area.trim())
          .filter(Boolean)
      );
    }
  }

  if (!summary) {
    summary = trimmedContent;
  }

  return {
    content: summary.trim(),
    keyPoints,
    impactAreas: [...new Set(impactAreas)],
    confidence,
  };
}

/**
 * Get available OpenRouter models
 */
export function getAvailableModels(): Array<{
  key: OpenRouterModel;
  name: string;
  description: string;
  contextWindow: number;
}> {
  return Object.entries(OPENROUTER_MODELS).map(([key, config]) => ({
    key: key as OpenRouterModel,
    name: config.name,
    description: config.description,
    contextWindow: config.contextWindow,
  }));
}

/**
 * Validate if model key is valid
 */
export function isValidModel(model: string): model is OpenRouterModel {
  return model in OPENROUTER_MODELS;
}
