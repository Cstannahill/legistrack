import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { generateSummaryOpenRouter } from "@/lib/ai/summarizer-openrouter";
import type { OpenRouterModel } from "@/lib/ai/summarizer-openrouter";
import { SUMMARIZATION_PROMPTS } from "@/lib/ai/prompts";

const BILL_ID = "cmg8obl3g00imvgn0reehryo4";
const OUTFILE = path.resolve(process.cwd(), "bill_summary_comparison.md");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type AnthropicMessage = {
  content?: Array<{ type?: string; text?: string } | string>;
  usage?: Record<string, number>;
  model?: string;
};

// Pricing tables (values are in $ per MTok (million tokens)) — convert to per-token by dividing by 1_000_000
const ANTHROPIC_PRICING: Record<
  string,
  { inputPerM: number; cachedPerM: number; outputPerM: number }
> = {
  // sonnet: input $3/MTok, cached read $0.30/MTok, output $15/MTok
  "claude-sonnet-4-5-20250929": {
    inputPerM: 3,
    cachedPerM: 0.3,
    outputPerM: 15,
  },
  // haiku: input $0.8/MTok, cached read $0.08/MTok, output $4/MTok
  "claude-3-5-haiku-20241022": {
    inputPerM: 0.8,
    cachedPerM: 0.08,
    outputPerM: 4,
  },
};

const OPENAI_PRICING: Record<
  string,
  { inputPerM: number; cachedPerM: number; outputPerM: number }
> = {
  // values from user-supplied data (per MTok)
  "gpt-5-nano": { inputPerM: 0.05, cachedPerM: 0.005, outputPerM: 0.4 },
  "gpt-5-mini": { inputPerM: 0.25, cachedPerM: 0.025, outputPerM: 2.0 },
};

function parseStructuredResponse(response: string) {
  const summaryMatch = response.match(/## Summary\n([\s\S]*?)(?=\n##|$)/i);
  const keyPointsMatch = response.match(/## Key Points\n([\s\S]*?)(?=\n##|$)/i);
  const impactMatch = response.match(/## Impact Areas\n([\s\S]*?)(?=\n##|$)/i);

  const summary = summaryMatch?.[1]?.trim() || response.split("\n\n")[0];

  const keyPoints =
    keyPointsMatch?.[1]
      ?.split("\n")
      .filter((line) => line.trim().startsWith("-"))
      .map((line) => line.replace(/^[-\s]*/, "").trim()) || [];

  const impactAreas =
    impactMatch?.[1]
      ?.split("\n")
      .filter((line) => line.trim().startsWith("-"))
      .map((line) => line.replace(/^[-\s]*/, "").trim()) || [];

  return { summary, keyPoints, impactAreas };
}

async function fetchBill() {
  const bill = await db.bill.findUnique({
    where: { id: BILL_ID },
    select: { id: true, title: true, fullText: true },
  });
  return bill;
}

async function anthroSummarize(
  modelId: string,
  title: string,
  fullText: string
) {
  // Purpose: generate STANDARD summary using Anthropic model
  const basePrompt = SUMMARIZATION_PROMPTS["STANDARD"];
  const instructionPart = basePrompt
    .split("{{FULL_TEXT}}")[0]
    .replace("{{TITLE}}", title)
    .replace("{{BILL_TYPE}}", "bill");
  const formatPart = basePrompt.split("{{FULL_TEXT}}")[1] || "";

  const message = await anthropic.messages.create({
    model: modelId,
    max_tokens: 2000,
    temperature: 0.3,
    system: [
      {
        type: "text",
        text: instructionPart + "\n" + formatPart,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Full Text of Bill:\n${fullText.slice(0, 50000)}`,
          },
        ],
      },
    ],
  });

  // normalize message shape
  const msg = message as unknown as AnthropicMessage;

  // Anthropic response content can be in multiple block types; find first text block
  let anthroRaw = "";
  if (Array.isArray(msg.content) && msg.content.length > 0) {
    const first = msg.content[0];
    if (typeof first === "object" && first && "text" in first) {
      // first is an object with a text field
      // use index signature to access safely
      anthroRaw = String((first as { text?: unknown }).text ?? "");
    } else {
      anthroRaw = String(first ?? "");
    }
  }

  const anthroParsed = parseStructuredResponse(anthroRaw || "");

  const usage = msg.usage ?? {};
  const model = msg.model ?? modelId;

  return { parsed: anthroParsed, usage, raw: anthroRaw, model };
}

async function openaiSummarize(model: string, title: string, fullText: string) {
  // Purpose: generate STANDARD summary using OpenAI model
  const basePrompt = SUMMARIZATION_PROMPTS["STANDARD"];
  const instructionPart = basePrompt
    .split("{{FULL_TEXT}}")[0]
    .replace("{{TITLE}}", title)
    .replace("{{BILL_TYPE}}", "bill");
  const formatPart = basePrompt.split("{{FULL_TEXT}}")[1] || "";

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: instructionPart + "\n" + formatPart },
      {
        role: "user",
        content: `Full Text of Bill:\n${fullText.slice(0, 50000)}`,
      },
    ],
  });

  const response = completion.choices?.[0]?.message?.content || "";
  const parsed = parseStructuredResponse(response);

  return { parsed, usage: completion.usage || {}, model: completion.model };
}

async function openrouterSummarize(
  modelKey: OpenRouterModel,
  title: string,
  fullText: string
) {
  // Purpose: generate STANDARD summary using OpenRouter model
  const result = await generateSummaryOpenRouter({
    title,
    fullText,
    summaryType: "STANDARD",
    model: modelKey,
  });
  return {
    parsed: {
      summary: result.content,
      keyPoints: result.keyPoints,
      impactAreas: result.impactAreas,
    },
    usage: null,
    model: result.model,
  };
}

function anthropicCostSavedFromUsage(
  usage: Record<string, unknown> | undefined,
  modelId: string
) {
  // Normalize usage numbers
  const input_tokens =
    typeof usage?.["input_tokens"] === "number"
      ? (usage["input_tokens"] as number)
      : 0;
  const cache_read =
    typeof usage?.["cache_read_input_tokens"] === "number"
      ? (usage["cache_read_input_tokens"] as number)
      : 0;
  const cache_created =
    typeof usage?.["cache_creation_input_tokens"] === "number"
      ? (usage["cache_creation_input_tokens"] as number)
      : 0;
  const output_tokens =
    typeof usage?.["output_tokens"] === "number"
      ? (usage["output_tokens"] as number)
      : 0;

  const pricing =
    ANTHROPIC_PRICING[modelId] ??
    ANTHROPIC_PRICING[Object.keys(ANTHROPIC_PRICING)[0]];
  const inputRate = pricing.inputPerM / 1_000_000;
  const cachedRate = pricing.cachedPerM / 1_000_000;
  const outputRate = pricing.outputPerM / 1_000_000;

  // Deterministic caching math
  // We treat the first ~PROMPT_TOKENS as the cacheable, static prompt (instructions + format)
  // Subsequent runs read those PROMPT_TOKENS at cachedRate and only bill the dynamic bill text at inputRate.
  const PROMPT_TOKENS = 3000;
  const BATCH_SIZE = 300;

  // Derive bill tokens from returned input_tokens when possible, otherwise fall back to a conservative estimate
  let bill_tokens = 0;
  if (input_tokens > PROMPT_TOKENS) {
    bill_tokens = input_tokens - PROMPT_TOKENS;
  } else if (input_tokens > 0) {
    // If reported input_tokens is small, assume there's no bill tokens (short bill)
    bill_tokens = 0;
  } else {
    // Fallback estimate for bill text token length when provider doesn't report input_tokens
    bill_tokens = 5000; // conservative default
  }

  const total_input_tokens_estimate = PROMPT_TOKENS + bill_tokens;

  // Output tokens: prefer reported value, else fallback to 500 (typical summary length)
  const out_tokens = output_tokens > 0 ? output_tokens : 500;

  // Per-summary cost if no caching is used (first-run style): all input tokens charged at inputRate
  const costNoCache =
    total_input_tokens_estimate * inputRate + out_tokens * outputRate;

  // Per-summary cost after cache is populated (subsequent runs):
  // PROMPT_TOKENS are read at cachedRate; bill_tokens are charged at inputRate; outputs at outputRate
  const perSummaryWithCache =
    PROMPT_TOKENS * cachedRate +
    bill_tokens * inputRate +
    out_tokens * outputRate;

  // Total daily cost (300 summaries) WITHOUT caching: all 300 run as no-cache
  const dailyBefore = costNoCache * BATCH_SIZE;

  // Total daily cost WITH caching applied across the batch: first run is a full write (costNoCache),
  // remaining (BATCH_SIZE - 1) runs use perSummaryWithCache
  const dailyAfter = costNoCache + perSummaryWithCache * (BATCH_SIZE - 1);

  const cost_saved_per_summary = Math.max(0, costNoCache - perSummaryWithCache);
  const savingsDaily = Math.max(0, dailyBefore - dailyAfter);

  return {
    cache_hit: cache_read > 0,
    input_tokens: total_input_tokens_estimate,
    cache_read,
    cache_created,
    output_tokens: out_tokens,
    cost_no_cache: costNoCache,
    // cost_with_cache represents the per-summary cost after the cache is populated
    cost_with_cache: perSummaryWithCache,
    cost_saved: cost_saved_per_summary,
    dailyBefore,
    // dailyAfter accounts for one-time first-run write + (BATCH_SIZE-1) cached reads
    dailyAfter,
    savingsDaily,
  };
}

// Use example per-summary costs from docs for projection
function openaiCostProjection(
  model: string,
  usage: Record<string, unknown> | undefined
) {
  // Normalize model key: allow returned model identifiers like "gpt-5-nano-2025-09-29"
  const normalizeModelKey = (m: string) => {
    if (!m) return "gpt-5-nano";
    const lower = m.toLowerCase();
    if (lower.includes("nano")) return "gpt-5-nano";
    if (lower.includes("mini")) return "gpt-5-mini";
    // fallback to exact match if available
    if (OPENAI_PRICING[m]) return m;
    // last resort: return default nano pricing
    return "gpt-5-nano";
  };

  const key = normalizeModelKey(model || "");
  const pricing = OPENAI_PRICING[key] ?? {
    inputPerM: 0.05,
    cachedPerM: 0.005,
    outputPerM: 0.4,
  };
  const inputRate = pricing.inputPerM / 1_000_000;
  const cachedRate = pricing.cachedPerM / 1_000_000;
  const outputRate = pricing.outputPerM / 1_000_000;

  const prompt_tokens =
    typeof usage?.["prompt_tokens"] === "number"
      ? (usage["prompt_tokens"] as number)
      : 0;
  const completion_tokens =
    typeof usage?.["completion_tokens"] === "number"
      ? (usage["completion_tokens"] as number)
      : 0;

  // OpenAI doesn't expose explicit cache read tokens; assume cached portion is prompt_tokens - dynamic_tokens_estimate if present
  // We'll compute costNoCache as if prompt_tokens are fully charged at inputRate
  const costNoCache =
    prompt_tokens * inputRate + completion_tokens * outputRate;

  // Cached heuristic: tokens above 1024 are eligible for caching/read discounts.
  const estimatedCachedTokens = Math.max(0, prompt_tokens - 1024);
  const costWithCache =
    (prompt_tokens - estimatedCachedTokens) * inputRate +
    estimatedCachedTokens * cachedRate +
    completion_tokens * outputRate;

  const cost_saved = Math.max(0, costNoCache - costWithCache);

  const dailyBefore = costNoCache * 300;
  const dailyAfter = costWithCache * 300;
  const savingsDaily = dailyBefore - dailyAfter;

  return {
    model: key,
    prompt_tokens,
    completion_tokens,
    cost_no_cache: costNoCache,
    cost_with_cache: costWithCache,
    cost_saved,
    dailyBefore,
    dailyAfter,
    savingsDaily,
    monthlySavings: savingsDaily * 30,
  };
}

async function main() {
  const mdLines: string[] = [];

  mdLines.push(`# Model Summarization Comparison and Cost`);

  // 1) Fetch bill
  mdLines.push(`## Original Piece of Legislation`);
  const bill = await fetchBill();
  if (!bill) {
    mdLines.push(`**Error: Unable to retrieve data for bill ID ${BILL_ID}.**`);
    fs.writeFileSync(OUTFILE, mdLines.join("\n\n"), "utf8");
    console.error(`Error: Unable to retrieve data for bill ID ${BILL_ID}.`);
    return;
  }

  mdLines.push(`**${bill.title || "(no title)"}**`);
  mdLines.push("---");
  mdLines.push(bill.fullText || "(no full text)");
  mdLines.push("---");

  // Anthropic models
  mdLines.push(`## Anthropic`);

  // Sonnet-4.5
  mdLines.push(`### Sonnet-4.5`);
  mdLines.push(
    `Purpose: Generate STANDARD summary using Claude-Sonnet-4.5. Inputs: title, fullText.`
  );
  try {
    const res = await anthroSummarize(
      "claude-sonnet-4-5-20250929",
      bill.title || "",
      bill.fullText || ""
    );
    // validation
    mdLines.push(`Standard Summary`);
    mdLines.push(res.parsed.summary || "(no summary)");
    mdLines.push(`Key Points`);
    res.parsed.keyPoints.forEach((p: string) => mdLines.push(`- ${p}`));
    mdLines.push(`Impact Areas`);
    res.parsed.impactAreas.forEach((a: string) => mdLines.push(`- ${a}`));

    // usage & cost
    const anthroMetrics = anthropicCostSavedFromUsage(
      res.usage,
      "claude-sonnet-4-5-20250929"
    );
    mdLines.push(
      `Actual Cost (per summary, no caching): $${anthroMetrics.cost_no_cache.toFixed(
        6
      )}`
    );
    mdLines.push(
      `Actual Cost (per summary, with caching): $${anthroMetrics.cost_with_cache.toFixed(
        6
      )}`
    );
    mdLines.push(
      `Daily Projection (300 summaries) before caching: $${anthroMetrics.dailyBefore.toFixed(
        6
      )}`
    );
    mdLines.push(
      `Daily Projection (300 summaries) after caching: $${anthroMetrics.dailyAfter.toFixed(
        6
      )}`
    );
    mdLines.push(
      `Amount Saved Via Input Caching (per summary): $${anthroMetrics.cost_saved.toFixed(
        6
      )}`
    );
    mdLines.push(
      `Amount Saved Via Input Caching (daily for 300 summaries): $${anthroMetrics.savingsDaily.toFixed(
        6
      )}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    mdLines.push(
      `Error: Model summarization failed for Claude-Sonnet-4.5: ${msg}`
    );
  }

  mdLines.push(`---`);

  // Haiku-3.5
  mdLines.push(`### Haiku-3.5`);
  mdLines.push(
    `Purpose: Generate STANDARD summary using Claude-Haiku-3.5. Inputs: title, fullText.`
  );
  try {
    const res = await anthroSummarize(
      "claude-3-5-haiku-20241022",
      bill.title || "",
      bill.fullText || ""
    );
    mdLines.push(`Standard Summary`);
    mdLines.push(res.parsed.summary || "(no summary)");
    mdLines.push(`Key Points`);
    res.parsed.keyPoints.forEach((p: string) => mdLines.push(`- ${p}`));
    mdLines.push(`Impact Areas`);
    res.parsed.impactAreas.forEach((a: string) => mdLines.push(`- ${a}`));

    const anthroMetrics2 = anthropicCostSavedFromUsage(
      res.usage,
      "claude-3-5-haiku-20241022"
    );
    mdLines.push(
      `Actual Cost (per summary, no caching): $${anthroMetrics2.cost_no_cache.toFixed(
        6
      )}`
    );
    mdLines.push(
      `Actual Cost (per summary, with caching): $${anthroMetrics2.cost_with_cache.toFixed(
        6
      )}`
    );
    mdLines.push(
      `Daily Projection (300 summaries) before caching: $${anthroMetrics2.dailyBefore.toFixed(
        6
      )}`
    );
    mdLines.push(
      `Daily Projection (300 summaries) after caching: $${anthroMetrics2.dailyAfter.toFixed(
        6
      )}`
    );
    mdLines.push(
      `Amount Saved Via Input Caching (per summary): $${anthroMetrics2.cost_saved.toFixed(
        6
      )}`
    );
    mdLines.push(
      `Amount Saved Via Input Caching (daily for 300 summaries): $${anthroMetrics2.savingsDaily.toFixed(
        6
      )}`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    mdLines.push(
      `Error: Model summarization failed for Claude-Haiku-3.5: ${msg}`
    );
  }

  mdLines.push(`---`);

  // OpenAI
  mdLines.push(`## OpenAI`);

  // gpt-5-nano
  mdLines.push(`### gpt-5-nano`);
  mdLines.push(
    `Purpose: Generate STANDARD summary using gpt-5-nano. Inputs: title, fullText.`
  );
  try {
    const res = await openaiSummarize(
      "gpt-5-nano",
      bill.title || "",
      bill.fullText || ""
    );
    mdLines.push(`Standard Summary`);
    mdLines.push(res.parsed.summary || "(no summary)");
    mdLines.push(`Key Points`);
    res.parsed.keyPoints.forEach((p: string) => mdLines.push(`- ${p}`));
    mdLines.push(`Impact Areas`);
    res.parsed.impactAreas.forEach((a: string) => mdLines.push(`- ${a}`));

    const proj = openaiCostProjection(res.model || "gpt-5-nano", res.usage);
    mdLines.push(
      `Actual Cost: $${proj.dailyBefore.toFixed(
        6
      )} (daily for 300 summaries before caching)`
    );
    mdLines.push(
      `Amount Saved Via Input Caching: $${proj.savingsDaily.toFixed(
        6
      )} (daily) `
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    mdLines.push(`Error: Model summarization failed for gpt-5-nano: ${msg}`);
  }

  mdLines.push(`### gpt-5-mini`);
  mdLines.push(
    `Purpose: Generate STANDARD summary using gpt-5-mini. Inputs: title, fullText.`
  );
  try {
    const res = await openaiSummarize(
      "gpt-5-mini",
      bill.title || "",
      bill.fullText || ""
    );
    mdLines.push(`Standard Summary`);
    mdLines.push(res.parsed.summary || "(no summary)");
    mdLines.push(`Key Points`);
    res.parsed.keyPoints.forEach((p: string) => mdLines.push(`- ${p}`));
    mdLines.push(`Impact Areas`);
    res.parsed.impactAreas.forEach((a: string) => mdLines.push(`- ${a}`));

    const proj = openaiCostProjection(res.model || "gpt-5-mini", res.usage);
    mdLines.push(
      `Actual Cost: $${proj.dailyBefore.toFixed(
        6
      )} (daily for 300 summaries before caching)`
    );
    mdLines.push(
      `Amount Saved Via Input Caching: $${proj.savingsDaily.toFixed(6)} (daily)`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    mdLines.push(`Error: Model summarization failed for gpt-5-mini: ${msg}`);
  }

  mdLines.push(`---`);

  // DeepSeek via OpenRouter
  mdLines.push(`## DeepSeek (OpenRouter)`);
  mdLines.push(
    `Purpose: Generate STANDARD summary using OpenRouter DeepSeek (DeepSeek V3.1). Inputs: title, fullText.`
  );
  try {
    const res = await openrouterSummarize(
      "deepseek",
      bill.title || "",
      bill.fullText || ""
    );
    mdLines.push(`Standard Summary`);
    mdLines.push(res.parsed.summary || "(no summary)");
    mdLines.push(`Key Points`);
    res.parsed.keyPoints.forEach((p: string) => mdLines.push(`- ${p}`));
    mdLines.push(`Impact Areas`);
    res.parsed.impactAreas.forEach((a: string) => mdLines.push(`- ${a}`));
    mdLines.push(`(Free)`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    mdLines.push(
      `Error: Model summarization failed for DeepSeek (OpenRouter): ${msg}`
    );
  }

  // Write file
  fs.writeFileSync(OUTFILE, mdLines.join("\n\n"), "utf8");
  console.log(`Wrote ${OUTFILE}`);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
