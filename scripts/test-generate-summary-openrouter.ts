/**
 * Single Bill Summary Generation Test Script - OpenRouter Edition
 *
 * Usage:
 *   npm run gen-sum-or deepseek HR 4398
 *   npm run gen-sum-or qwen S 2309
 *   npm run gen-sum-or gemini HRES 723
 *   npm run gen-sum-or mistral HR 5371
 *
 * Or directly:
 *   tsx scripts/test-generate-summary-openrouter.ts deepseek HR 4398
 *   tsx scripts/test-generate-summary-openrouter.ts qwen S 2309
 *
 * Models:
 *   deepseek - DeepSeek V3.1 (best quality-to-cost ratio)
 *   qwen     - Qwen3 235B A22B (fallback if V3.1 unavailable)
 *   gemini   - Gemini 2.0 Flash (1M context - can fit entire bill)
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
import { fetchBillDetails, fetchBillText } from "../src/lib/api/congress";
import { CURRENT_CONGRESS } from "../src/lib/constants";
import { BillStatus } from "@prisma/client";

// Parse command line arguments
const args = process.argv.slice(2);
const model = args[0]?.toLowerCase(); // "deepseek", "qwen", "gemini", or "mistral"
const billType = args[1]?.toLowerCase(); // "hr", "s", "hres", etc.
const billNumber = parseInt(args[2]); // bill number

// Validate arguments
if (!model || !billType || !billNumber) {
  const availableModels = getAvailableModels();

  console.error(`
❌ Invalid arguments!

Usage:
  npm run gen-sum-or <model> <billType> <billNumber>
  
Examples:
  npm run gen-sum-or deepseek HR 4398
  npm run gen-sum-or qwen S 2309
  npm run gen-sum-or gemini HRES 723
  npm run gen-sum-or mistral HR 5371

Available Models:
${availableModels
  .map((m) => `  ${m.key.padEnd(10)} - ${m.name} (${m.description})`)
  .join("\n")}

Bill Types: HR, S, HRES, SRES, HJRES, SJRES, etc.
`);
  process.exit(1);
}

if (!isValidModel(model)) {
  const availableModels = getAvailableModels();
  console.error(
    `❌ Invalid model: ${model}. Available models: ${availableModels
      .map((m) => m.key)
      .join(", ")}`
  );
  process.exit(1);
}

/**
 * Map Congress.gov latest action text to our BillStatus enum
 */
function determineBillStatus(latestActionText?: string): BillStatus {
  if (!latestActionText) return "INTRODUCED";

  const actionLower = latestActionText.toLowerCase();

  if (
    actionLower.includes("became public law") ||
    actionLower.includes("signed by president")
  ) {
    return "BECAME_LAW";
  }

  if (
    actionLower.includes("vetoed") ||
    actionLower.includes("returned unsigned")
  ) {
    return "VETOED";
  }

  if (
    actionLower.includes("presented to president") ||
    actionLower.includes("sent to president")
  ) {
    return "PRESENTED_TO_PRESIDENT";
  }

  if (
    actionLower.includes("conference") ||
    actionLower.includes("resolving differences")
  ) {
    return "RESOLVING_DIFFERENCES";
  }

  if (
    actionLower.includes("passed senate") ||
    actionLower.includes("agreed to in senate")
  ) {
    return "PASSED_SENATE";
  }

  if (
    actionLower.includes("passed house") ||
    actionLower.includes("agreed to in house")
  ) {
    return "PASSED_HOUSE";
  }

  if (
    actionLower.includes("reported by committee") ||
    actionLower.includes("committee discharged")
  ) {
    return "REPORTED_BY_COMMITTEE";
  }

  if (
    actionLower.includes("referred to") ||
    actionLower.includes("committee")
  ) {
    return "REFERRED_TO_COMMITTEE";
  }

  if (
    actionLower.includes("failed") ||
    actionLower.includes("rejected") ||
    actionLower.includes("not agreed to")
  ) {
    return "FAILED";
  }

  return "INTRODUCED";
}

async function main() {
  const billIdentifier = `${billType.toUpperCase()} ${billNumber}`;
  const modelInfo = getAvailableModels().find((m) => m.key === model)!;

  console.log(`\n${"=".repeat(80)}`);
  console.log(`🤖 OPENROUTER BILL SUMMARY GENERATION TEST`);
  console.log(`${"=".repeat(80)}`);
  console.log(`📄 Bill: ${billIdentifier}`);
  console.log(`🧠 Model: ${modelInfo.name}`);
  console.log(`📊 Context: ${modelInfo.contextWindow.toLocaleString()} tokens`);
  console.log(`💡 ${modelInfo.description}`);
  console.log(`🏛️  Congress: ${CURRENT_CONGRESS}`);
  console.log(`${"=".repeat(80)}\n`);

  try {
    // Step 1: Check if bill exists in database
    console.log(`1️⃣  Checking database...`);

    // Try to find bill - check both lowercase and uppercase for backward compatibility
    let bill = await db.bill.findFirst({
      where: {
        congress: CURRENT_CONGRESS,
        billType: billType.toLowerCase(),
        billNumber: billNumber,
      },
      include: {
        companionBills: {
          include: {
            companionBill: {
              select: {
                id: true,
                billType: true,
                billNumber: true,
                title: true,
              },
            },
          },
        },
        summaries: {
          orderBy: { generatedAt: "desc" },
        },
      },
    });

    // If not found with lowercase, try uppercase
    if (!bill) {
      bill = await db.bill.findFirst({
        where: {
          congress: CURRENT_CONGRESS,
          billType: billType.toUpperCase(),
          billNumber: billNumber,
        },
        include: {
          companionBills: {
            include: {
              companionBill: {
                select: {
                  id: true,
                  billType: true,
                  billNumber: true,
                  title: true,
                },
              },
            },
          },
          summaries: {
            orderBy: { generatedAt: "desc" },
          },
        },
      });
    }

    if (bill) {
      console.log(`   ✅ Found in database`);
      console.log(`   ID: ${bill.id}`);
      console.log(`   Title: ${bill.title}`);
      console.log(`   Status: ${bill.currentStatus}`);
      console.log(
        `   Introduced: ${bill.introducedDate.toISOString().split("T")[0]}`
      );
      console.log(`   Has Full Text: ${bill.fullText ? "Yes" : "No"}`);
      console.log(`   Existing Summaries: ${bill.summaries.length}`);

      if (bill.companionBills.length > 0) {
        console.log(`   Companion Bills:`);
        bill.companionBills.forEach(({ companionBill }) => {
          console.log(
            `     - ${companionBill.billType.toUpperCase()} ${
              companionBill.billNumber
            }`
          );
        });
      }
    } else {
      console.log(`   ⚠️  Not found in database, will fetch from API`);
    }

    // Step 2: Fetch bill details from Congress.gov
    console.log(`\n2️⃣  Fetching bill details from Congress.gov...`);
    const billDetails = await fetchBillDetails(
      CURRENT_CONGRESS,
      billType,
      billNumber
    );

    if (!billDetails) {
      console.error(`   ❌ Bill not found on Congress.gov`);
      process.exit(1);
    }

    console.log(`   ✅ Fetched bill details`);
    console.log(`   Title: ${billDetails.title}`);
    console.log(`   Introduced: ${billDetails.introducedDate || "N/A"}`);
    console.log(`   Latest Action: ${billDetails.latestAction?.text || "N/A"}`);
    console.log(
      `   Latest Action Date: ${billDetails.latestAction?.actionDate || "N/A"}`
    );

    // Determine status
    const currentStatus = determineBillStatus(billDetails.latestAction?.text);
    console.log(`   Status: ${currentStatus}`);

    // Step 3: Fetch bill text
    console.log(`\n3️⃣  Fetching bill text...`);
    const textData = await fetchBillText(
      CURRENT_CONGRESS,
      billType,
      billNumber
    );

    if (!textData?.text) {
      console.error(`   ❌ No full text available for this bill`);
      console.log(`   💡 Bill may be too recent or text not yet published`);
      process.exit(1);
    }

    console.log(`   ✅ Fetched full text`);
    console.log(
      `   Length: ${textData.text.length.toLocaleString()} characters`
    );
    console.log(`   URL: ${textData.url}`);

    // Step 4: Update or create bill in database
    console.log(`\n4️⃣  Updating database...`);

    const billData = {
      billType: billType.toLowerCase(),
      billNumber: billNumber,
      congress: CURRENT_CONGRESS,
      title: billDetails.title || `${billType.toUpperCase()} ${billNumber}`,
      officialTitle: billDetails.title,
      introducedDate: new Date(billDetails.introducedDate),
      currentStatus: currentStatus,
      statusDate: new Date(
        billDetails.latestAction?.actionDate || billDetails.introducedDate
      ),
      sourceUrl: billDetails.url,
      fullText: textData.text,
      fullTextUrl: textData.url,
      lastFetchedAt: new Date(),
    };

    if (bill) {
      bill = await db.bill.update({
        where: { id: bill.id },
        data: billData,
        include: {
          companionBills: {
            include: {
              companionBill: {
                select: {
                  id: true,
                  billType: true,
                  billNumber: true,
                  title: true,
                },
              },
            },
          },
          summaries: {
            orderBy: { generatedAt: "desc" },
          },
        },
      });
      console.log(`   ✅ Updated bill in database`);
    } else {
      bill = await db.bill.create({
        data: billData,
        include: {
          companionBills: {
            include: {
              companionBill: {
                select: {
                  id: true,
                  billType: true,
                  billNumber: true,
                  title: true,
                },
              },
            },
          },
          summaries: {
            orderBy: { generatedAt: "desc" },
          },
        },
      });
      console.log(`   ✅ Created bill in database`);
    }

    // Step 5: Generate summaries with OpenRouter
    console.log(`\n5️⃣  Generating summaries with ${modelInfo.name}...`);
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
        title: bill.title || billIdentifier,
        fullText: textData.text,
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
          billId: bill.id,
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

    // Step 6: Summary
    console.log(`${"=".repeat(80)}`);
    console.log(`✅ GENERATION COMPLETE`);
    console.log(`${"=".repeat(80)}`);
    console.log(`📄 Bill: ${billIdentifier}`);
    console.log(`🧠 Model: ${modelInfo.name}`);
    console.log(`📊 Summaries Generated: ${summaryTypes.length}`);
    console.log(
      `⏱️  Total Time: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`
    );
    console.log(`💾 Database ID: ${bill.id}`);
    console.log(`\n💡 Tips:`);
    console.log(`   - Try different OpenRouter models:`);
    const otherModels = getAvailableModels()
      .filter((m) => m.key !== model)
      .slice(0, 2);
    otherModels.forEach((m) => {
      console.log(
        `     npm run gen-sum-or ${
          m.key
        } ${billType.toUpperCase()} ${billNumber}`
      );
    });
    console.log(`   - View in database: npm run db:studio`);
    console.log(
      `   - Check existing summaries: ${bill.summaries.length} already in DB`
    );
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
