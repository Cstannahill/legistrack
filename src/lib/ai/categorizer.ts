// AI-powered Bill Categorization
import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIZATION_PROMPT } from "./prompts";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

interface CategorizeBillParams {
  title: string;
  summary: string;
  availableCategories: Array<{
    slug: string;
    name: string;
    description?: string | null;
  }>;
}

export async function categorizeBill(
  params: CategorizeBillParams
): Promise<string[]> {
  const { title, summary, availableCategories } = params;

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
    temperature: 0.2, // Lower temperature for more consistent categorization
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const response =
    message.content[0].type === "text" ? message.content[0].text : "";

  // Parse comma-separated slugs
  const slugs = response
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => availableCategories.some((cat) => cat.slug === s))
    .slice(0, 3); // Max 3 categories

  return slugs;
}
