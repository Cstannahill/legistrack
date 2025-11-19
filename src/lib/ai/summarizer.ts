// AI Summarization System using Anthropic Claude
import Anthropic from "@anthropic-ai/sdk";
import { SUMMARIZATION_PROMPTS } from "./prompts";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export type SummaryType =
  | "BRIEF"
  | "STANDARD"
  | "DETAILED"
  | "ELI5"
  | "KEY_CHANGES";

interface GenerateSummaryParams {
  title: string;
  fullText: string;
  billType?: string;
  sponsor?: string;
  status?: string;
  summaryType: SummaryType;
}

interface SummaryResult {
  content: string;
  keyPoints: string[];
  impactAreas: string[];
  model: string;
  confidence: number;
}

export async function generateSummary(
  params: GenerateSummaryParams
): Promise<SummaryResult> {
  const { title, fullText, billType, sponsor, status, summaryType } = params;

  // Split prompt into static instructions (cacheable) and dynamic content
  const basePrompt = SUMMARIZATION_PROMPTS[summaryType];

  // Extract the instruction part (everything before {{FULL_TEXT}})
  const instructionPart = basePrompt
    .split("{{FULL_TEXT}}")[0]
    .replace("{{TITLE}}", title)
    .replace("{{BILL_TYPE}}", billType || "bill")
    .replace("{{SPONSOR}}", sponsor || "Unknown")
    .replace("{{STATUS}}", status || "Introduced")
    .trim();

  // Extract the format/output instructions (everything after {{FULL_TEXT}})
  const formatPart = basePrompt.split("{{FULL_TEXT}}")[1] || "";

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    temperature: 0.3, // Lower temperature for consistency
    system: [
      {
        type: "text",
        text: instructionPart + "\n" + formatPart,
        cache_control: { type: "ephemeral" }, // Cache static instructions
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Full Text of Bill:\n${fullText.slice(0, 50000)}`, // Dynamic content last for optimal caching
          },
        ],
      },
    ],
  });

  // Get actual model used from response
  const actualModel = message.model;

  const response =
    message.content[0].type === "text" ? message.content[0].text : "";

  // Parse structured response
  const parsed = parseAIResponse(response);

  return {
    content: parsed.summary,
    keyPoints: parsed.keyPoints,
    impactAreas: parsed.impactAreas,
    model: actualModel, // Use actual model from API response
    confidence: calculateConfidence(fullText),
  };
}

function parseAIResponse(response: string) {
  // Extract sections from structured response
  const summaryMatch = response.match(/## Summary\n([\s\S]*?)(?=\n##|$)/);
  const keyPointsMatch = response.match(/## Key Points\n([\s\S]*?)(?=\n##|$)/);
  const impactMatch = response.match(/## Impact Areas\n([\s\S]*?)(?=\n##|$)/);

  const summary = summaryMatch?.[1]?.trim() || response.split("\n\n")[0];

  const keyPoints =
    keyPointsMatch?.[1]
      ?.split("\n")
      .filter((line) => line.trim().startsWith("-"))
      .map((line) => line.replace(/^-\s*/, "").trim()) || [];

  const impactAreas =
    impactMatch?.[1]
      ?.split("\n")
      .filter((line) => line.trim().startsWith("-"))
      .map((line) => line.replace(/^-\s*/, "").trim()) || [];

  return { summary, keyPoints, impactAreas };
}

function calculateConfidence(fullText: string): number {
  // Simple heuristic: more source text = higher confidence
  if (fullText.length > 10000) return 0.9;
  if (fullText.length > 5000) return 0.8;
  if (fullText.length > 1000) return 0.7;
  return 0.6;
}

// Batch summarization for efficiency
export async function batchSummarize(
  bills: Array<{ id: string; title: string; fullText: string }>
) {
  const results = [];

  for (const bill of bills) {
    try {
      const summary = await generateSummary({
        title: bill.title,
        fullText: bill.fullText,
        summaryType: "STANDARD",
      });
      results.push({ billId: bill.id, summary });
    } catch (error) {
      console.error(`Failed to summarize bill ${bill.id}:`, error);
      results.push({ billId: bill.id, error });
    }
  }

  return results;
}
