// Manual script to batch summarize bills with STANDARD summaries only
// Supports both Claude Sonnet 4.5 (anthropic) and GPT-5-nano (openai)
import { config } from "dotenv";
import { db } from "@/lib/db";

// Load environment variables from .env file
config();
import { generateSummary } from "@/lib/ai/summarizer";
import { generateSummaryOpenAI } from "@/lib/ai/summarizer-openai";
import { fetchBillText, fetchBillDetails } from "@/lib/api/congress";
import { BillStatus } from "@prisma/client";

// Configuration
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "10", 10);
const AI_MODEL = process.env.AI_MODEL || "openai"; // "openai" or "anthropic"

/**
 * Map Congress.gov latest action text to our BillStatus enum
 */
function determineBillStatus(latestActionText?: string): BillStatus {
  if (!latestActionText) return "INTRODUCED";

  const actionLower = latestActionText.toLowerCase();

  // Check for law
  if (
    actionLower.includes("became public law") ||
    actionLower.includes("signed by president")
  ) {
    return "BECAME_LAW";
  }

  // Check for veto
  if (
    actionLower.includes("vetoed") ||
    actionLower.includes("returned unsigned")
  ) {
    return "VETOED";
  }

  // Check for presidential presentation
  if (
    actionLower.includes("presented to president") ||
    actionLower.includes("sent to president")
  ) {
    return "PRESENTED_TO_PRESIDENT";
  }

  // Check for resolving differences
  if (
    actionLower.includes("conference") ||
    actionLower.includes("resolving differences")
  ) {
    return "RESOLVING_DIFFERENCES";
  }

  // Check for Senate passage
  if (
    actionLower.includes("passed senate") ||
    actionLower.includes("agreed to in senate")
  ) {
    return "PASSED_SENATE";
  }

  // Check for House passage
  if (
    actionLower.includes("passed house") ||
    actionLower.includes("agreed to in house")
  ) {
    return "PASSED_HOUSE";
  }

  // Check for committee report
  if (
    actionLower.includes("reported by committee") ||
    actionLower.includes("committee discharged")
  ) {
    return "REPORTED_BY_COMMITTEE";
  }

  // Check for committee referral
  if (
    actionLower.includes("referred to") ||
    actionLower.includes("committee")
  ) {
    return "REFERRED_TO_COMMITTEE";
  }

  // Check for failure
  if (
    actionLower.includes("failed") ||
    actionLower.includes("rejected") ||
    actionLower.includes("not agreed to")
  ) {
    return "FAILED";
  }

  // Default to introduced
  return "INTRODUCED";
}

async function main() {
  const modelName = AI_MODEL === "openai" ? "GPT-5-nano" : "Claude Sonnet 4.5";

  console.log(`\n🤖 Bill Batch Summarization`);
  console.log(`📦 Batch Size: ${BATCH_SIZE} bills`);
  console.log(`🧠 AI Model: ${modelName}\n`);

  try {
    // Find bills without STANDARD summaries
    // Order by oldest first (more likely to have published text)
    const billsToSummarize = await db.bill.findMany({
      where: {
        summaries: {
          none: {
            summaryType: "STANDARD",
          },
        },
      },
      take: BATCH_SIZE,
      orderBy: { introducedDate: "asc" }, // Oldest first - more likely to have text available
      select: {
        id: true,
        billType: true,
        billNumber: true,
        congress: true,
        title: true,
        officialTitle: true,
        fullText: true,
        fullTextUrl: true,
        companionBills: {
          select: {
            companionBill: {
              select: {
                id: true,
                billType: true,
                billNumber: true,
                congress: true,
                fullText: true,
              },
            },
          },
        },
      },
    });

    if (billsToSummarize.length === 0) {
      console.log("ℹ️  No bills found without STANDARD summaries.\n");
      console.log(
        "💡 Tip: Run 'npm run fetch-bills-recent' to fetch new bills first.\n"
      );
      return;
    }

    console.log(`✓ Found ${billsToSummarize.length} bills to summarize\n`);

    let successCount = 0;
    let failCount = 0;

    for (const bill of billsToSummarize) {
      // NORMALIZE billType to lowercase for API calls (handles old uppercase data)
      const normalizedBillType = bill.billType.toLowerCase();
      const billIdentifier = `${normalizedBillType} ${bill.billNumber}`;
      console.log(`\n📄 Processing: ${billIdentifier}`);
      console.log(`   Title: ${bill.title?.substring(0, 70)}...`);

      try {
        // ALWAYS fetch fresh data from API (individual bill calls, not batch)
        console.log(`   → Fetching bill details from Congress.gov...`);

        const billDetails = await fetchBillDetails(
          bill.congress,
          normalizedBillType,
          bill.billNumber
        );
        if (!billDetails) {
          console.log(`   ❌ Bill not found on Congress.gov API`);
          failCount++;
          continue;
        }

        console.log(`   ✅ Fetched bill details`);
        console.log(`   Title: ${billDetails.title}`);
        console.log(`   Introduced: ${billDetails.introducedDate || "N/A"}`);
        console.log(
          `   Latest Action: ${billDetails.latestAction?.text || "N/A"}`
        );

        // Determine accurate status from latest action
        const currentStatus = determineBillStatus(
          billDetails.latestAction?.text
        );
        console.log(`   Status: ${currentStatus}`);

        // Fetch full text
        console.log(`   → Fetching bill text from Congress.gov...`);
        const textData = await fetchBillText(
          bill.congress,
          normalizedBillType,
          bill.billNumber
        );

        if (!textData?.text) {
          console.log(
            `   ⚠️  Full text not available yet for ${billIdentifier}`
          );
          console.log(`   💡 Bill may be too recent or text not yet published`);
          failCount++;
          continue; // Skip this bill entirely
        }

        console.log(`   ✅ Fetched full text`);
        console.log(`   Length: ${textData.text.length} characters`);
        console.log(`   URL: ${textData.url}`);

        const sourceText = textData.text;

        // Update bill with fresh API data
        await db.bill.update({
          where: { id: bill.id },
          data: {
            title: billDetails.title || bill.title,
            officialTitle: billDetails.title,
            introducedDate: new Date(billDetails.introducedDate),
            currentStatus: currentStatus,
            statusDate: new Date(
              billDetails.latestAction?.actionDate || billDetails.introducedDate
            ),
            sourceUrl: billDetails.url,
            fullText: sourceText,
            fullTextUrl: textData.url,
            lastFetchedAt: new Date(),
          },
        });
        console.log(`   ✓ Updated bill with fresh API data`);

        // Validate we have actual full text (not just a title)
        if (!sourceText || sourceText.length < 100) {
          console.log(
            `   ⚠️  No full text available (only have title/metadata)`
          );
          console.log(
            `   ⏭️  Skipping - cannot generate quality summary without full text`
          );
          failCount++;
          continue;
        }

        // Generate STANDARD summary with selected model
        console.log(`   🤖 Generating STANDARD summary with ${modelName}...`);
        const startTime = Date.now();

        let summary;
        if (AI_MODEL === "openai") {
          summary = await generateSummaryOpenAI({
            title: bill.title || billIdentifier,
            fullText: sourceText,
            summaryType: "STANDARD",
          });
        } else {
          summary = await generateSummary({
            title: bill.title || billIdentifier,
            fullText: sourceText,
            summaryType: "STANDARD",
          });
        }

        const elapsed = Date.now() - startTime;

        // Save summary
        await db.summary.create({
          data: {
            summaryType: "STANDARD",
            content: summary.content,
            keyPoints: summary.keyPoints,
            impactAreas: summary.impactAreas,
            confidence: summary.confidence,
            aiModel: summary.model,
            billId: bill.id,
          },
        });

        console.log(
          `   ✓ Summary: ${summary.content.length} chars in ${elapsed}ms`
        );
        console.log(`   🎯 Key points: ${summary.keyPoints.length}`);
        console.log(`   🌐 Impact areas: ${summary.impactAreas.length}`);

        successCount++;
        console.log(`   ✅ Completed ${billIdentifier}`);
      } catch (error) {
        console.error(`   ❌ Error processing ${billIdentifier}:`, error);
        failCount++;
      }
    }

    console.log(`\n📈 Final Summary:`);
    console.log(`   ✓ Bills Successfully Processed: ${successCount}`);
    console.log(`   ❌ Bills Failed: ${failCount}`);
    console.log(`   📊 Total Bills: ${billsToSummarize.length}`);
    console.log(`   🤖 AI Model Used: ${modelName}`);
    console.log(`   � Total Summaries Generated: ${successCount}\n`);
  } catch (error) {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  }
}

main()
  .then(() => {
    console.log("✅ Done!\n");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
