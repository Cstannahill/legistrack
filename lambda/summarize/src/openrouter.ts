import { MODEL_REGISTRY } from "./config.js";
import { getApiKey, markKeyCooldown, maskKey } from "./keyManagement.js";
import type {
  EnvironmentConfig,
  OpenRouterModelKey,
} from "./types.js";

interface OpenRouterCallOptions {
  systemPrompt: string;
  userPrompt: string;
  modelKey: OpenRouterModelKey;
  preferredKeyIndex: number;
  config: EnvironmentConfig;
  label: string;
}

export interface OpenRouterCallResult {
  content: string;
  modelUsed: string;
  apiKeyMasked: string;
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

class OpenRouterHttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function callOpenRouter(
  options: OpenRouterCallOptions
): Promise<OpenRouterCallResult> {
  const apiKey = await getApiKey(options.preferredKeyIndex);
  const model = MODEL_REGISTRY[options.modelKey];
  if (!model) {
    throw new Error(`Unknown OpenRouter model key '${options.modelKey}'`);
  }

  const maxTokens = Math.min(
    6000,
    model.top_provider?.max_completion_tokens ?? 6000
  );

  const payload = {
    model: model.id,
    temperature: Number(process.env.OPENROUTER_TEMPERATURE ?? "0.25"),
    max_tokens: maxTokens,
    top_p: 0.9,
    messages: [
      { role: "system", content: options.systemPrompt },
      { role: "user", content: options.userPrompt },
    ],
  };

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": options.config.siteUrl,
      "X-Title": options.config.appName,
    },
    body: JSON.stringify(payload),
  });

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after")) * 1000;
    markKeyCooldown(apiKey, Number.isFinite(retryAfter) ? retryAfter : 10_000);
    throw new OpenRouterHttpError("Rate limited by OpenRouter", 429);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new OpenRouterHttpError(
      `OpenRouter request failed (${response.status}): ${text}`,
      response.status
    );
  }

  const data = await response.json();
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;

  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenRouter returned an empty response");
  }

  return {
    content,
    modelUsed: choice?.model ?? model.id,
    apiKeyMasked: maskKey(apiKey),
  };
}
