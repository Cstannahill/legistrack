// AI-powered Bill Categorization
import Anthropic from "@anthropic-ai/sdk";
import { categorizeLegislationItem } from "@/lib/llm/router";
import { CATEGORIZATION_PROMPT } from "./prompts";

export interface CategorizeBillParams {
  title: string;
  summary: string;
  availableCategories: Array<{
    slug: string;
    name: string;
    description?: string | null;
  }>;
}

/**
 * Categorizes legislation into up to 3 category slugs.
 * Defaults to the unified OpenRouter -> Gemini router; uses Anthropic only when
 * `AI_MODEL=anthropic` is explicitly configured.
 */
export async function categorizeBill(
  params: CategorizeBillParams
): Promise<string[]> {
  const { title, summary, availableCategories } = params;
  const requestedProvider = process.env.AI_MODEL?.trim().toLowerCase();

  if (requestedProvider === "anthropic") {
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const categoriesList = availableCategories
      .map(
        (cat) =>
          `- ${cat.slug}: ${cat.name}${
            cat.description ? ` - ${cat.description}` : ""
          }`
      )
      .join("\n");

    const prompt = CATEGORIZATION_PROMPT.replace("{{TITLE}}", title)
      .replace("{{SUMMARY}}", summary)
      .replace("{{CATEGORIES}}", categoriesList);

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const response =
      message.content[0]?.type === "text" ? message.content[0].text : "";

    return response
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => availableCategories.some((cat) => cat.slug === s))
      .slice(0, 3);
  }

  const result = await categorizeLegislationItem({
    title,
    summary,
    categories: availableCategories,
  });

  return result.categories;
}
