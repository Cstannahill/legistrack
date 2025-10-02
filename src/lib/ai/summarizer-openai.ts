// AI Summarization System using OpenAI GPT-5-nano
import OpenAI from "openai";
import { SUMMARIZATION_PROMPTS } from "./prompts";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
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

export async function generateSummaryOpenAI(
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

  const completion = await openai.chat.completions.create({
    model: "gpt-5-nano",
    messages: [
      {
        role: "system",
        content: instructionPart + "\n" + formatPart, // Static instructions - automatically cached by OpenAI
      },
      {
        role: "user",
        content: `Full Text of Bill:\n${fullText.slice(0, 50000)}`, // Dynamic content last for optimal caching
      },
    ],
    // No max_completion_tokens - let GPT-5-nano use its default limit
    // Note: GPT-5-nano uses reasoning tokens internally which don't appear in output
    // Note: GPT-5-nano only supports default temperature=1, custom values not allowed
  });

  const response = completion.choices[0]?.message?.content || "";

  // Debug: Log the raw response to see what we're getting
  if (!response || response.length === 0) {
    console.error("⚠️  GPT-5-nano returned empty response!");
    console.error("   Completion object:", JSON.stringify(completion, null, 2));
  } else {
    console.log(`   📝 Raw response length: ${response.length} chars`);
    console.log(`   📝 First 200 chars: ${response.substring(0, 200)}...`);
  }

  // Parse structured response
  const parsed = parseAIResponse(response);

  // Debug: Log parsed results
  console.log(`   📊 Parsed summary length: ${parsed.summary.length}`);
  console.log(`   📊 Parsed key points: ${parsed.keyPoints.length}`);
  console.log(`   📊 Parsed impact areas: ${parsed.impactAreas.length}`);

  return {
    content: parsed.summary,
    keyPoints: parsed.keyPoints,
    impactAreas: parsed.impactAreas,
    model: "gpt-5-nano",
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
