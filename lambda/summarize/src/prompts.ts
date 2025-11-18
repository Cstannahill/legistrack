import type { SummarizationItem } from "./types.js";

const BASE_SYSTEM_PROMPT = `You are a legislative research analyst. Summarize each item you receive and respond with ONLY valid JSON.
Return an array where each entry has:
{
  "id": string,
  "summary": string,
  "keyPoints": string[],
  "impactAreas": string[],
  "confidence": number (0-1)
}
Rules:
- Keep the same order as the input list.
- keyPoints should highlight the most important provisions (3-6 items).
- impactAreas should describe who or what is affected.
- Use professional, plain English.
- confidence should reflect how complete the provided text is.
- NEVER include any text before or after the JSON array.`;

export function buildUserPrompt(items: SummarizationItem[]): string {
  const shaped = items.map((item, index) => ({
    index: index + 1,
    id: item.sourceId,
    kind: item.kind,
    title: item.title,
    metadata: item.metadata,
    text: item.text,
  }));

  return `You will receive ${items.length} document${items.length === 1 ? "" : "s"}. Each document must result in one summary object.
Documents:\n${JSON.stringify(shaped, null, 2)}`;
}

export function buildBatchPrompt(items: SummarizationItem[]) {
  return {
    systemPrompt: BASE_SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(items),
  };
}
