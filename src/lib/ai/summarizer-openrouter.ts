/**
 * OpenRouter AI Summarizer
 *
 * Supports multiple free models via OpenRouter:
 * - deepseek: DeepSeek V3.1 (best quality-to-cost ratio)
 * - qwen: Qwen3 235B A22B (fallback if V3.1 unavailable)
 * - gemini: Gemini 2.0 Flash (1M context - can fit entire bill)
 * - mistral: Mistral Small 3.2 (faster, efficient)
 */

import OpenAI from "openai";
import { SUMMARIZATION_PROMPTS } from "./prompts";
import type { SummaryType } from "@prisma/client";

// Model configurations
const OPENROUTER_MODELS = {
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
} as const;

export type OpenRouterModel = keyof typeof OPENROUTER_MODELS;

// Initialize OpenRouter client (uses OpenAI SDK with custom base URL)
const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY_3,
  baseURL: "https://openrouter.ai/api/v1",
});

interface GenerateSummaryParams {
  title: string;
  fullText: string;
  summaryType: SummaryType;
  model?: OpenRouterModel;
}

interface SummaryResponse {
  content: string;
  keyPoints: string[];
  impactAreas: string[];
  confidence: number;
  model: string;
}

/**
 * Generate summary using OpenRouter models
 */
export async function generateSummaryOpenRouter({
  title,
  fullText,
  summaryType,
  model = "qwen",
}: GenerateSummaryParams): Promise<SummaryResponse> {
  const modelConfig = OPENROUTER_MODELS[model];

  if (!process.env.OPENROUTER_API_KEY_3) {
    throw new Error("OPENROUTER_API_KEY_3 environment variable is not set");
  }

  try {
    // Get the appropriate prompt template
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
        // OpenRouter-specific headers in options
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

    // Parse the structured response
    const parsed = parseStructuredResponse(content);

    return {
      content: parsed.content,
      keyPoints: parsed.keyPoints,
      impactAreas: parsed.impactAreas,
      confidence: parsed.confidence,
      model: `${modelConfig.name} (${model})`,
    };
  } catch (error) {
    console.error(`OpenRouter API error with ${modelConfig.name}:`, error);
    throw error;
  }
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
