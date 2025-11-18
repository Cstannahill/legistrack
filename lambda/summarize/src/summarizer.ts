import { buildBatchPrompt, buildUserPrompt } from "./prompts.js";
import { callOpenRouter } from "./openrouter.js";
import { logBatchTokenEstimate } from "./tokenLogger.js";
import type {
  EnvironmentConfig,
  OpenRouterModelKey,
  SummarizationItem,
  SummarizationResult,
} from "./types.js";

interface SummarizerOptions {
  items: SummarizationItem[];
  modelKey: OpenRouterModelKey;
  preferredKeyIndex: number;
  config: EnvironmentConfig;
  label: string;
}

export async function summarizeItems({
  items,
  modelKey,
  preferredKeyIndex,
  config,
  label,
}: SummarizerOptions): Promise<SummarizationResult[]> {
  if (!items.length) return [];

  const { systemPrompt, userPrompt } = buildBatchPrompt(items);

  logBatchTokenEstimate({
    label: `${label}-tokens`,
    systemPrompt,
    buildUserPrompt,
    items,
  });

  const response = await callOpenRouter({
    systemPrompt,
    userPrompt,
    modelKey,
    preferredKeyIndex,
    config,
    label,
  });

  return parseModelResponse(response.content, response.modelUsed);
}

function parseModelResponse(raw: string, aiModel: string): SummarizationResult[] {
  const jsonPayload = extractJsonArray(raw);
  const entries = JSON.parse(jsonPayload);
  if (!Array.isArray(entries)) {
    throw new Error("OpenRouter response is not a JSON array");
  }

  return entries.map((entry, index) => {
    const idCandidate = entry?.id ?? entry?.sourceId ?? entry?.identifier ?? index;
    const sourceId = String(idCandidate);
    const summaryText = normalizeText(entry?.summary ?? entry?.content ?? "");
    const keyPoints = normalizeStringArray(entry?.keyPoints ?? entry?.bullets);
    const impactAreas = normalizeStringArray(entry?.impactAreas ?? entry?.impacts);
    const confidence = normalizeConfidence(entry?.confidence);

    return {
      sourceId,
      summary: summaryText,
      keyPoints,
      impactAreas,
      confidence,
      aiModel,
    };
  });
}

function extractJsonArray(text: string): string {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Failed to locate JSON array in model response");
  }
  return text.slice(start, end + 1);
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/\n|,|;|\|/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeConfidence(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp(value, 0.1, 1);
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return clamp(parsed, 0.1, 1);
    }
  }
  return 0.75;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
