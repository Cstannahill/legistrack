// Script to batch summarize executive orders using AI
// Supports Claude Sonnet 4.5 (anthropic), GPT-5-nano (openai), and OpenRouter models
import { config } from "dotenv";
import { db } from "@/lib/db";

// Load environment variables from .env file
config();
import { generateSummary } from "@/lib/ai/summarizer";
import { generateSummaryOpenAI } from "@/lib/ai/summarizer-openai";
import {
  generateSummaryOpenRouter,
  getAvailableModels,
  isValidModel,
  type OpenRouterModel,
} from "@/lib/ai/summarizer-openrouter";

// Configuration
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "10", 10);
const SUPPORTED_MODELS = ["openai", "anthropic", "openrouter"] as const;
type SupportedModel = (typeof SUPPORTED_MODELS)[number];
const rawModel = (process.env.AI_MODEL || "openai").toLowerCase();
const AI_MODEL: SupportedModel = SUPPORTED_MODELS.includes(
  rawModel as SupportedModel
)
  ? (rawModel as SupportedModel)
  : "openai";

if (!SUPPORTED_MODELS.includes(rawModel as SupportedModel)) {
  console.warn(
    `⚠️  Unsupported AI_MODEL '${process.env.AI_MODEL}'. Falling back to openai.`
  );
}

async function main() {
  const availableOpenRouterModels = getAvailableModels();
  const resolveModelInfo = (key: OpenRouterModel) =>
    availableOpenRouterModels.find((m) => m.key === key)!;

  let openRouterModel: OpenRouterModel = "deepseek";
  let openRouterModelInfo = resolveModelInfo(openRouterModel);

  if (AI_MODEL === "openrouter") {
    const requestedModel = process.env.OPENROUTER_MODEL?.toLowerCase();
    if (requestedModel) {
      if (isValidModel(requestedModel)) {
        openRouterModel = requestedModel;
        openRouterModelInfo = resolveModelInfo(openRouterModel);
      } else {
        console.warn(
          `⚠️  Unsupported OPENROUTER_MODEL '${process.env.OPENROUTER_MODEL}'. Falling back to '${openRouterModel}'.`
        );
      }
    }
  }

  const modelName =
    AI_MODEL === "openai"
      ? "GPT-5-nano"
      : AI_MODEL === "anthropic"
      ? "Claude Sonnet 4.5"
      : `${openRouterModelInfo.name} (${openRouterModel}) via OpenRouter`;

  console.log(`\n🤖 Executive Order Batch Summarization`);
  console.log(`📦 Batch Size: ${BATCH_SIZE} executive orders`);
  console.log(`🧠 AI Model: ${modelName}\n`);
  if (AI_MODEL === "openrouter") {
    console.log(
      `   🌐 Context Window: ${openRouterModelInfo.contextWindow.toLocaleString()} tokens`
    );
    console.log(`   💡 ${openRouterModelInfo.description}\n`);
  }

  try {
    // Find executive orders without STANDARD summaries
    const eosToSummarize = await db.executiveOrder.findMany({
      where: {
        summaries: {
          none: {
            summaryType: "STANDARD",
          },
        },
      },
      take: BATCH_SIZE,
      orderBy: { signingDate: "desc" },
      select: {
        id: true,
        orderNumber: true,
        executiveOrderType: true,
        title: true,
        fullText: true,
        presidentName: true,
        signingDate: true,
      },
    });

    if (eosToSummarize.length === 0) {
      console.log(
        "ℹ️  No executive orders found without STANDARD summaries.\n"
      );
      console.log(
        "💡 Tip: Run 'npm run fetch-executive-orders' to fetch new executive orders first.\n"
      );
      return;
    }

    console.log(
      `✓ Found ${eosToSummarize.length} executive orders to summarize\n`
    );

    let successCount = 0;
    let failCount = 0;
    let skippedNoText = 0;

    for (const eo of eosToSummarize) {
      const identifier = `EO ${eo.orderNumber}`;
      console.log(`\n📄 Processing: ${identifier}`);
      console.log(`   Title: ${eo.title?.substring(0, 70)}...`);

      // Check if we have full text
      if (!eo.fullText) {
        console.log(
          `   ⚠️  Skipping - no full text available for ${identifier}`
        );
        console.log(
          `   💡 Run 'npx tsx scripts/update-eo-full-text.ts' to fetch full text first\n`
        );
        skippedNoText++;
        continue;
      }

      try {
        const textSizeKB = (eo.fullText.length / 1024).toFixed(1);
        console.log(`   📊 Full text size: ${textSizeKB}KB`);

        // Generate AI summary with selected model
        console.log(`   🤖 Generating STANDARD summary with ${modelName}...`);
        if (AI_MODEL === "openrouter") {
          console.log(
            `   🌐 Using OpenRouter model '${openRouterModelInfo.name}' (${openRouterModel})`
          );
        }
        const startTime = Date.now();

        let summaryResult;
        if (AI_MODEL === "openai") {
          summaryResult = await generateSummaryOpenAI({
            title: eo.title,
            fullText: eo.fullText,
            billType: eo.executiveOrderType,
            sponsor: `President ${eo.presidentName}`,
            status: `Signed on ${eo.signingDate.toLocaleDateString()}`,
            summaryType: "STANDARD",
          });
        } else if (AI_MODEL === "anthropic") {
          summaryResult = await generateSummary({
            title: eo.title,
            fullText: eo.fullText,
            billType: eo.executiveOrderType,
            sponsor: `President ${eo.presidentName}`,
            status: `Signed on ${eo.signingDate.toLocaleDateString()}`,
            summaryType: "STANDARD",
          });
        } else {
          summaryResult = await generateSummaryOpenRouter({
            title: eo.title || identifier,
            fullText: eo.fullText,
            summaryType: "STANDARD",
            model: openRouterModel,
          });
        }

        const elapsed = Date.now() - startTime;

        // Save summary to database
        await db.summary.create({
          data: {
            executiveOrderId: eo.id,
            summaryType: "STANDARD",
            content: summaryResult.content,
            keyPoints: summaryResult.keyPoints,
            impactAreas: summaryResult.impactAreas,
            aiModel: summaryResult.model,
            confidence: summaryResult.confidence,
          },
        });

        console.log(`   ✅ Summary generated successfully (${elapsed}ms)`);
        console.log(
          `   📝 Content: ${summaryResult.content.substring(0, 100)}...`
        );
        console.log(`   🎯 Key points: ${summaryResult.keyPoints.length}`);
        console.log(`   🌐 Impact areas: ${summaryResult.impactAreas.length}`);
        successCount++;
      } catch (error) {
        console.error(
          `   ❌ Failed to generate summary for ${identifier}:`,
          error instanceof Error ? error.message : String(error)
        );
        failCount++;
      }
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 SUMMARY");
    console.log("=".repeat(60));
    console.log(`✅ Successfully summarized: ${successCount}`);
    console.log(`⚠️  Skipped (no text): ${skippedNoText}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log(`📝 Total processed: ${eosToSummarize.length}`);
    console.log(`🤖 AI Model Used: ${modelName}`);
    console.log("");

    if (skippedNoText > 0) {
      console.log(
        "💡 To fetch missing full text, run: npx tsx scripts/update-eo-full-text.ts\n"
      );
    }

    if (successCount > 0) {
      console.log("✅ Executive orders are now ready for display!\n");
    }
  } catch (error) {
    console.error("❌ Error:", error);
    throw error;
  } finally {
    await db.$disconnect();
  }
}

main();
