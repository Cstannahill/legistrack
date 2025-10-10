import { z } from "zod";
import llmRedis from "@/lib/llmRedis";
import { db } from "@/lib/db";

const OPENROUTER_KEYS = (
  process.env.OPENROUTER_KEYS ||
  process.env.OPENROUTER_KEY ||
  [
    process.env.OPENROUTER_API_KEY_1,
    process.env.OPENROUTER_API_KEY_2,
    process.env.OPENROUTER_API_KEY_3,
  ]
    .filter(Boolean)
    .join(",") ||
  ""
)
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

if (OPENROUTER_KEYS.length === 0) {
  console.warn(
    "WARNING: No OPENROUTER_KEYS configured. LLM calls will fail until keys are provided."
  );
}

const MODEL = process.env.OPENROUTER_MODEL || process.env.AI_MODEL || "qwen";

let keyIndex = 0;
// round-robin pointer is stored in `keyIndex` and advanced when a reservation is made.

// Zod schema for the expected LLM response
export const LLMResponseSchema = z.object({
  summary: z.string().min(1),
  keyPoints: z.array(z.string()).optional().default([]),
  categories: z.array(z.string()).optional().default([]),
  aiModel: z.string().optional().default(MODEL),
  confidence: z.number().min(0).max(1).optional(),
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

function buildPrompt(
  title: string,
  text: string | null,
  categories: { slug: string; name: string; description?: string }[]
) {
  const catList = categories
    .map(
      (c, i) =>
        `${i + 1}. ${c.name}${
          c.description ? ` - ${c.description}` : ""
        } (slug: ${c.slug})`
    )
    .join("\n");

  const user = `Categories:\n${catList}\n\nTitle: ${title}\nText: ${
    text ? text : "(no text provided)"
  }\n\nReturn EXACTLY a single valid JSON object with the following keys:\n{\n  \"summary\": string (2-4 sentences),\n  \"keyPoints\": [string],\n  \"categories\": [string] (array of category slugs, max 3),\n  \"aiModel\": string,\n  \"confidence\": number (0-1) OPTIONAL\n}\nRespond with ONLY the JSON object and nothing else.`;

  return [
    {
      role: "system",
      content:
        "You are an expert legislative summarizer and categorizer. Produce concise summaries and choose the most relevant categories. Output only valid JSON.",
    },
    { role: "user", content: user },
  ];
}

async function callOpenRouterWithKey(apiKey: string, messages: unknown[]) {
  const url = "https://api.openrouter.ai/v1/chat/completions";
  const body = {
    model: MODEL,
    messages,
    temperature: 0.0,
    max_tokens: 800,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(
      `OpenRouter error ${res.status}: ${res.statusText} ${text}`
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  const payload = await res.json();
  // The OpenRouter response shape may vary; choose first choice message
  const content =
    payload?.choices?.[0]?.message?.content ??
    payload?.choices?.[0]?.text ??
    null;
  if (!content) throw new Error("OpenRouter returned no content");
  return content;
}

async function parseAndValidate(content: string): Promise<LLMResponse> {
  // Trim and attempt to find JSON in response
  const trimmed = content.trim();
  let jsonText = trimmed;

  // If response contains markdown or code fences, strip them
  if (jsonText.startsWith("```") || jsonText.startsWith("```json")) {
    jsonText = jsonText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  try {
    const parsed = JSON.parse(jsonText);
    const validated = LLMResponseSchema.parse(parsed);
    return validated;
  } catch (err) {
    // Try to salvage if there is an embedded JSON object
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

export async function summarizeAndCategorize(opts: {
  title: string;
  text?: string | null;
  categories: { slug: string; name: string; description?: string }[];
  billId?: string | null;
  executiveOrderId?: string | null;
  // set to true only in exceptional workflows that intentionally re-run the LLM
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

  // Safety: if the caller supplies a billId or executiveOrderId, do not resummarize
  // unless explicitly allowed. This prevents accidental re-use of LLM credits.
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
      // If DB check fails, be conservative: rethrow so upstream can decide. We do not fall through and call the LLM.
      throw e;
    }
  }
  const messages = buildPrompt(title, text, categories);
  // Try to reserve a slot for any key. We'll attempt up to OPENROUTER_KEYS.length times.
  if (OPENROUTER_KEYS.length === 0)
    throw new Error("No OpenRouter keys configured");

  let lastErr: unknown = null;
  const triedKeyIndices: number[] = [];

  for (let rotate = 0; rotate < OPENROUTER_KEYS.length; rotate++) {
    const idx = (keyIndex + rotate) % OPENROUTER_KEYS.length;
    const key = OPENROUTER_KEYS[idx];
    triedKeyIndices.push(idx);

    // Attempt to reserve a slot for this key index
    const reserved = await llmRedis.reserveForKeyIndex(idx);
    if (!reserved) {
      // no capacity on this key, try next
      continue;
    }

    // Advance the round-robin pointer to next after the reserved one
    keyIndex = (idx + 1) % OPENROUTER_KEYS.length;

    try {
      const content = await callOpenRouterWithKey(key, messages);
      const result = await parseAndValidate(content);
      return result;
    } catch (err) {
      lastErr = err;
      // Refund the reservation since the call failed before success
      try {
        await llmRedis.refundForKeyIndex(idx);
      } catch (e) {
        console.error("Failed to refund Redis reservation", e);
      }

      // If rate limited at request time, continue to next key
      if (
        typeof err === "object" &&
        err !== null &&
        (err as { status?: number }).status === 429
      ) {
        continue;
      }

      // Otherwise, rethrow
      throw err;
    }
  }

  // If we reach here, no key had capacity. Enqueue the payload for later processing.
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
    // If enqueueing fails, surface the original last error if present
    throw lastErr || e;
  }
}

const exported = {
  summarizeAndCategorize,
  LLMResponseSchema,
};

export default exported;
