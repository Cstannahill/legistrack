import { z } from "zod";
import llmRedis from "@/lib/llmRedis";
import { db } from "@/lib/db";
import OpenAI from "openai";
import { getOpenRouterKeys } from "@/lib/openrouter-keys";

const OPENROUTER_API_KEYS = getOpenRouterKeys();

type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

if (OPENROUTER_API_KEYS.length === 0) {
  console.warn(
    "WARNING: No OPENROUTER_API_KEYS configured. LLM calls will fail until keys are provided."
  );
}

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

const MODEL = process.env.OPENROUTER_MODEL || process.env.AI_MODEL || "qwen";

let keyIndex = 0;

// Zod schema for the expected LLM response
export const LLMResponseSchema = z.object({
  summary: z.string().min(1),
  keyPoints: z.array(z.string()).optional().default([]),
  impactAreas: z.array(z.string()).optional().default([]),
  categories: z.array(z.string()).optional().default([]),
  aiModel: z.string().optional().default(MODEL),
  confidence: z.number().min(0).max(1).optional(),
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

function buildPrompt(
  title: string,
  text: string | null,
  categories: { slug: string; name: string; description?: string }[]
): OpenRouterMessage[] {
  const catList = categories
    .map(
      (c, i) =>
        `${i + 1}. ${c.name} (slug: ${c.slug})${
          c.description ? ` - ${c.description}` : ""
        }`
    )
    .join("\n");

  const user = `You are analyzing legislation for categorization and summarization.

Available Categories:
${catList}

Legislation Details:
Title: ${title}
Text: ${text || "(no text provided)"}

CRITICAL REQUIREMENTS:
1. Your response MUST be valid JSON only
2. The 'content' field must be at least 20 words
3. The 'keyPoints' array must contain at least 3 meaningful points, each at least 10 words
4. The 'impactAreas' array should describe who/what is affected
5. Select UP TO 3 most relevant category slugs from the list above

Response Schema:
{
  "summary": "string (minimum 20 words - a comprehensive summary)",
  "keyPoints": ["string", "string", ...] (array of detailed points, each 10+ words),
  "impactAreas": ["string", "string", ...] (who/what is affected),
  "categories": ["slug1", "slug2", "slug3"] (max 3 slugs from the provided list),
  "aiModel": "string",
  "confidence": number (0-1, optional)
}

RESPOND WITH ONLY THE JSON OBJECT. NO MARKDOWN. NO EXPLANATIONS.`;

  return [
    {
      role: "system",
      content:
        "You are an expert legislative analyst. Provide thorough, accurate analysis in strict JSON format.",
    },
    { role: "user", content: user },
  ];
}

async function callOpenRouterWithKey(
  apiKey: string,
  messages: OpenRouterMessage[]
): Promise<string> {
  const modelConfig =
    OPENROUTER_MODELS[MODEL as keyof typeof OPENROUTER_MODELS];

  const openrouter = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });

  try {
    const completion = await openrouter.chat.completions.create(
      {
        model: modelConfig.id,
        messages: messages as any,
        temperature: 0.3,
        max_tokens: 4000,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer":
            process.env.SITE_URL ?? "https://legistrack.vercel.app",
          "X-Title": "Legislation Tracker - Bill Summarization",
        },
      }
    );

    const content =
      (completion as any)?.choices?.[0]?.message?.content ??
      (completion as any)?.choices?.[0]?.text ??
      null;

    if (!content) {
      throw new Error("OpenRouter returned no content");
    }

    return content;
  } catch (error) {
    console.error(
      `OpenRouter API error with ${modelConfig?.name ?? MODEL}:`,
      error
    );
    throw error;
  }
}

async function parseAndValidate(content: string): Promise<LLMResponse> {
  const trimmed = content.trim();
  let jsonText = trimmed;

  if (jsonText.startsWith("```") || jsonText.startsWith("```json")) {
    jsonText = jsonText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  try {
    const parsed = JSON.parse(jsonText);
    const validated = LLMResponseSchema.parse(parsed);
    return validated;
  } catch (err) {
    const match = jsonText.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed2 = JSON.parse(match[0]);
        return LLMResponseSchema.parse(parsed2);
      } catch (e) {
        throw new Error(`Failed to parse/validate LLM JSON: ${String(e)}`);
      }
    }
    throw new Error(`Failed to parse LLM response as JSON: ${String(err)}`);
  }
}

/**
 * NEW: Summarize and categorize using a specific API key
 * This bypasses the round-robin and Redis rate limiting
 */
export async function summarizeAndCategorizeWithKey(opts: {
  title: string;
  text?: string | null;
  categories: { slug: string; name: string; description?: string }[];
  billId?: string | null;
  executiveOrderId?: string | null;
  apiKey: string;
  allowResummarize?: boolean;
}): Promise<LLMResponse> {
  const {
    title,
    text = null,
    categories,
    billId = null,
    executiveOrderId = null,
    apiKey,
    allowResummarize = false,
  } = opts;

  // Safety check: prevent re-summarization unless explicitly allowed
  if (!allowResummarize) {
    try {
      if (billId) {
        const existing = await db.summary.findFirst({ where: { billId } });
        if (existing) {
          const err = new Error("Already summarized for this bill") as Error & {
            code?: string;
          };
          err.code = "ALREADY_SUMMARIZED";
          throw err;
        }
      }
      if (executiveOrderId) {
        const existing = await db.summary.findFirst({
          where: { executiveOrderId },
        });
        if (existing) {
          const err = new Error(
            "Already summarized for this executive order"
          ) as Error & { code?: string };
          err.code = "ALREADY_SUMMARIZED";
          throw err;
        }
      }
    } catch (e) {
      throw e;
    }
  }

  const messages = buildPrompt(title, text, categories);

  try {
    const content = await callOpenRouterWithKey(apiKey, messages);
    const result = await parseAndValidate(content);
    return result;
  } catch (error) {
    console.error("Error in summarizeAndCategorizeWithKey:", error);
    throw error;
  }
}

/**
 * Original function: Uses round-robin with Redis rate limiting
 */
export async function summarizeAndCategorize(opts: {
  title: string;
  text?: string | null;
  categories: { slug: string; name: string; description?: string }[];
  billId?: string | null;
  executiveOrderId?: string | null;
  allowResummarize?: boolean;
}): Promise<LLMResponse> {
  const {
    title,
    text = null,
    categories,
    billId = null,
    executiveOrderId = null,
    allowResummarize = false,
  } = opts;

  // Safety check
  if (!allowResummarize) {
    try {
      if (billId) {
        const existing = await db.summary.findFirst({ where: { billId } });
        if (existing) {
          const err = new Error("Already summarized for this bill") as Error & {
            code?: string;
          };
          err.code = "ALREADY_SUMMARIZED";
          throw err;
        }
      }
      if (executiveOrderId) {
        const existing = await db.summary.findFirst({
          where: { executiveOrderId },
        });
        if (existing) {
          const err = new Error(
            "Already summarized for this executive order"
          ) as Error & { code?: string };
          err.code = "ALREADY_SUMMARIZED";
          throw err;
        }
      }
    } catch (e) {
      throw e;
    }
  }

  const messages = buildPrompt(title, text, categories);

  if (OPENROUTER_API_KEYS.length === 0) {
    throw new Error("No OpenRouter keys configured");
  }

  let lastErr: unknown = null;
  const triedKeyIndices: number[] = [];

  // Try each key in round-robin fashion
  for (let rotate = 0; rotate < OPENROUTER_API_KEYS.length; rotate++) {
    const idx = (keyIndex + rotate) % OPENROUTER_API_KEYS.length;
    const key = OPENROUTER_API_KEYS[idx];
    triedKeyIndices.push(idx);

    const reserved = await llmRedis.reserveForKeyIndex(idx);
    if (!reserved) {
      continue;
    }

    keyIndex = (idx + 1) % OPENROUTER_API_KEYS.length;

    try {
      const content = await callOpenRouterWithKey(key, messages);
      const result = await parseAndValidate(content);
      return result;
    } catch (err) {
      lastErr = err;
      try {
        await llmRedis.refundForKeyIndex(idx);
      } catch (e) {
        console.error("Failed to refund Redis reservation", e);
      }

      if (
        typeof err === "object" &&
        err !== null &&
        (err as { status?: number }).status === 429
      ) {
        continue;
      }

      throw err;
    }
  }

  // No capacity available, enqueue
  try {
    await llmRedis.enqueuePayload({
      title,
      text,
      categories,
      billId,
      executiveOrderId,
    });
    const enqErr = new Error(
      "LLM capacity exhausted; request enqueued"
    ) as Error & { code?: string };
    enqErr.code = "ENQUEUED";
    throw enqErr;
  } catch (e) {
    throw lastErr || e;
  }
}

const exported = {
  summarizeAndCategorize,
  summarizeAndCategorizeWithKey,
  LLMResponseSchema,
};

export default exported;
