/**
 * Single Executive Order Summary Generation Test Script - OpenRouter Edition
 *
 * Usage:
 *   npm run gen-sum-or-eo deepseek 14067
 *   npm run gen-sum-or-eo qwen 14111
 *   npm run gen-sum-or-eo gemini 14175
 *   npm run gen-sum-or-eo mistral 14177
 *
 * Or directly:
 *   tsx scripts/test-generate-summary-openrouter-eo.ts deepseek 14067
 *   tsx scripts/test-generate-summary-openrouter-eo.ts qwen 14111
 *
 * Models:
 *   deepseek - DeepSeek V3.1 (best quality-to-cost ratio)
 *   qwen     - Qwen3 235B A22B (fallback if V3.1 unavailable)
 *   gemini   - Gemini 2.0 Flash (1M context - can fit entire order)
 *   mistral  - Mistral Small 3.2 (faster, efficient)
 */

import "dotenv/config";
import { db } from "../src/lib/db";
import {
  generateSummaryOpenRouter,
  isValidModel,
  getAvailableModels,
  type OpenRouterModel,
} from "../src/lib/ai/summarizer-openrouter";

// Parse command line arguments
const args = process.argv.slice(2);
const model = args[0]?.toLowerCase(); // "deepseek", "qwen", "gemini", or "mistral"
const orderNumber = parseInt(args[1]); // EO number (e.g., 14067)

// Validate arguments
if (!model || !orderNumber) {
  const availableModels = getAvailableModels();

  console.error(`
❌ Invalid arguments!

Usage:
  npm run gen-sum-or-eo <model> <orderNumber>
  
Examples:
  npm run gen-sum-or-eo deepseek 14067
  npm run gen-sum-or-eo qwen 14111
  npm run gen-sum-or-eo gemini 14175
  npm run gen-sum-or-eo mistral 14177

Available Models:
${availableModels
  .map(
    (m) => `  ${m.key.padEnd(10)} - ${m.name} (${m.description})`
  )
  .join("\n")}

Order Number: Any valid Executive Order number (e.g., 14067, 14111)
`);
  process.exit(1);
}

if (!isValidModel(model)) {
  const availableModels = getAvailableModels();
  console.error(
    `❌ Invalid model: ${model}. Available models: ${availableModels.map((m) => m.key).join(", ")}`
  );
  process.exit(1);
}

async function main() {
  const orderIdentifier = `EO ${orderNumber}`;
  const modelInfo = getAvailableModels().find((m) => m.key === model)!;

  console.log(`\n${"=".repeat(80)}`);
  console.log(`🤖 OPENROUTER EXECUTIVE ORDER SUMMARY GENERATION TEST`);
  console.log(`${"=".repeat(80)}`);
  console.log(`📜 Executive Order: ${orderIdentifier}`);
  console.log(`🧠 Model: ${modelInfo.name}`);
  console.log(`📊 Context: ${modelInfo.contextWindow.toLocaleString()} tokens`);
  console.log(`💡 ${modelInfo.description}`);
  console.log(`${"=".repeat(80)}\n`);

  try {
    // Step 1: Check if EO exists in database
    console.log(`1️⃣  Checking database...`);

    const eo = await db.executiveOrder.findFirst({
      where: {
        orderNumber: orderNumber,
      },
      include: {
        summaries: {
          orderBy: { generatedAt: "desc" },
        },
      },
    });

    if (eo) {
      console.log(`   ✅ Found in database`);
      console.log(`   ID: ${eo.id}`);
      console.log(`   Title: ${eo.title}`);
      console.log(`   Signed: ${eo.signingDate.toISOString().split("T")[0]}`);
      console.log(
        `   Publication: ${eo.publicationDate?.toISOString().split("T")[0] || "N/A"}`
      );
      console.log(`   Has Full Text: ${eo.fullText ? "Yes" : "No"}`);
      console.log(`   Existing Summaries: ${eo.summaries.length}`);
    } else {
      console.error(`   ❌ Executive Order ${orderNumber} not found in database`);
      console.log(`   💡 Run 'npm run fetch-executive-orders' first`);
      process.exit(1);
    }

    // Step 2: Validate full text
    console.log(`\n2️⃣  Validating full text...`);

    if (!eo.fullText || eo.fullText.length < 100) {
      console.error(`   ❌ No full text available for EO ${orderNumber}`);
      console.log(`   💡 Run 'npm run update-eo-full-text' to fetch full text`);
      process.exit(1);
    }

    console.log(`   ✅ Full text available`);
    console.log(`   Length: ${eo.fullText.length.toLocaleString()} characters`);
    console.log(`   URL: ${eo.sourceUrl}`);

    // Step 3: Generate summaries with OpenRouter
    console.log(`\n3️⃣  Generating summaries with ${modelInfo.name}...`);
    console.log(`${"=".repeat(80)}\n`);

    const summaryTypes = [
      { type: "BRIEF" as const, label: "Brief", emoji: "⚡" },
      { type: "STANDARD" as const, label: "Standard", emoji: "📋" },
      { type: "ELI5" as const, label: "ELI5", emoji: "👶" },
    ];

    let totalTime = 0;

    for (const { type, label, emoji } of summaryTypes) {
      console.log(`${emoji} Generating ${label} summary...`);
      const startTime = Date.now();

      const summary = await generateSummaryOpenRouter({
        title: eo.title || orderIdentifier,
        fullText: eo.fullText,
        summaryType: type,
        model: model as OpenRouterModel,
      });

      const elapsed = Date.now() - startTime;
      totalTime += elapsed;

      // Save summary to database
      await db.summary.create({
        data: {
          summaryType: type,
          content: summary.content,
          keyPoints: summary.keyPoints,
          impactAreas: summary.impactAreas,
          confidence: summary.confidence,
          aiModel: summary.model,
          executiveOrderId: eo.id,
        },
      });

      console.log(`✅ ${label} summary generated (${elapsed}ms)`);
      console.log(`   Model: ${summary.model}`);
      console.log(`   Confidence: ${(summary.confidence * 100).toFixed(1)}%`);
      console.log(`   Length: ${summary.content.length} chars`);
      console.log(`\n   Content:`);
      console.log(`   ${"-".repeat(76)}`);
      console.log(`   ${summary.content}`);
      console.log(`   ${"-".repeat(76)}`);

      if (summary.keyPoints.length > 0) {
        console.log(`\n   Key Points:`);
        summary.keyPoints.forEach((point, i) => {
          console.log(`   ${i + 1}. ${point}`);
        });
      }

      if (summary.impactAreas.length > 0) {
        console.log(`\n   Impact Areas: ${summary.impactAreas.join(", ")}`);
      }

      console.log(`\n`);
    }

    // Step 4: Summary
    console.log(`${"=".repeat(80)}`);
    console.log(`✅ GENERATION COMPLETE`);
    console.log(`${"=".repeat(80)}`);
    console.log(`📜 Executive Order: ${orderIdentifier}`);
    console.log(`🧠 Model: ${modelInfo.name}`);
    console.log(`📊 Summaries Generated: ${summaryTypes.length}`);
    console.log(
      `⏱️  Total Time: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`
    );
    console.log(`💾 Database ID: ${eo.id}`);
    console.log(`\n💡 Tips:`);
    console.log(`   - Try different OpenRouter models:`);
    const otherModels = getAvailableModels()
      .filter((m) => m.key !== model)
      .slice(0, 2);
    otherModels.forEach((m) => {
      console.log(`     npm run gen-sum-or-eo ${m.key} ${orderNumber}`);
    });
    console.log(`   - View in database: npm run db:studio`);
    console.log(
      `   - Check existing summaries: ${eo.summaries.length} already in DB`
    );
    console.log(`   - Fetch more EOs: npm run fetch-executive-orders`);
    console.log(`${"=".repeat(80)}\n`);
  } catch (error) {
    console.error(`\n❌ Error:`, error);
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
