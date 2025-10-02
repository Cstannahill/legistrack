// Paginated script to fetch ALL bills from Congress.gov
// Automatically handles the 250-result API limit
import { config } from "dotenv";
import { fetchLatestBills, fetchBillText } from "@/lib/api/congress";

// Load environment variables from .env file
config();
import { db } from "@/lib/db";
import { CURRENT_CONGRESS } from "@/lib/constants";

// Configurable parameters
const TOTAL_BILLS = parseInt(process.env.TOTAL_BILLS || "1000", 10);
const FETCH_TEXT = process.env.FETCH_TEXT === "true"; // Default false (fetch during summarization)
const FETCH_COMPANIONS = process.env.FETCH_COMPANIONS !== "false"; // Default true
const BATCH_SIZE = 250; // Congress.gov API maximum

/**
 * Fetch related bills and create companion relationships
 */
async function processCompanionBills(
  billId: string,
  billType: string,
  billNumber: string,
  congress: number
) {
  try {
    // Fetch related bills from Congress.gov API
    const relatedUrl = `https://api.congress.gov/v3/bill/${congress}/${billType.toLowerCase()}/${billNumber}/relatedbills?api_key=${
      process.env.CONGRESS_API_KEY
    }`;
    const response = await fetch(relatedUrl);
    const data = await response.json();

    if (!data.relatedBills || data.relatedBills.length === 0) {
      return 0; // No related bills
    }

    let companionsCreated = 0;

    for (const related of data.relatedBills) {
      // Only process companion bills (same title/content, different chamber)
      const relationshipType = related.relationshipDetails?.[0]?.type;
      if (
        !relationshipType ||
        (!relationshipType.includes("Related bill") &&
          !relationshipType.includes("Identical bill"))
      ) {
        continue;
      }

      // Parse companion bill details
      const companionCongress = related.congress;
      const companionType = related.type;
      const companionNumber = related.number;

      // Find the companion bill in our database
      const companionBill = await db.bill.findFirst({
        where: {
          congress: companionCongress,
          billType: companionType,
          billNumber: parseInt(companionNumber),
        },
      });

      if (!companionBill) {
        // Companion bill not in our DB yet (might be fetched later)
        continue;
      }

      // Determine companion type
      const companionTypeValue = relationshipType.includes("Identical")
        ? "IDENTICAL"
        : "RELATED";

      // Check if relationship already exists
      const existingRelation = await db.companionBill.findFirst({
        where: {
          OR: [
            {
              sourceBillId: billId,
              companionBillId: companionBill.id,
            },
            {
              sourceBillId: companionBill.id,
              companionBillId: billId,
            },
          ],
        },
      });

      if (!existingRelation) {
        // Create bidirectional companion relationship
        await db.companionBill.create({
          data: {
            sourceBillId: billId,
            companionBillId: companionBill.id,
            relationshipType: companionTypeValue as any,
          },
        });

        companionsCreated++;
      }
    }

    return companionsCreated;
  } catch (error) {
    console.error(`   ⚠️  Error fetching companion bills:`, error);
    return 0;
  }
}

async function fetchBatch(
  offset: number,
  limit: number,
  fetchText: boolean
): Promise<{
  created: number;
  updated: number;
  skipped: number;
  textFetched: number;
  textNotAvailable: number;
  companionsLinked: number;
}> {
  const bills = await fetchLatestBills({
    congress: CURRENT_CONGRESS,
    limit,
    offset,
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let textFetched = 0;
  let textNotAvailable = 0;
  let companionsLinked = 0;

  for (const billData of bills) {
    try {
      // Check if bill exists
      const existing = await db.bill.findFirst({
        where: {
          congress: CURRENT_CONGRESS,
          billType: billData.type.toLowerCase(), // Normalize to lowercase
          billNumber: parseInt(billData.number), // Convert string to number
        },
      });

      const billIdentifier = `${billData.type.toUpperCase()} ${
        billData.number
      }`;

      // Try introducedDate first, fall back to updateDate, then latestAction date
      const introducedDateStr =
        billData.introducedDate ||
        billData.updateDate ||
        billData.latestAction?.actionDate;

      if (!introducedDateStr) {
        console.log(`⚠ Skipping ${billIdentifier}: no date available`);
        skipped++;
        continue;
      }

      const introducedDate = new Date(introducedDateStr);

      if (isNaN(introducedDate.getTime())) {
        console.log(
          `⚠ Skipping ${billIdentifier}: invalid date (${introducedDateStr})`
        );
        skipped++;
        continue;
      }

      // Attempt to fetch full text if enabled
      let fullText: string | null = null;
      let fullTextUrl: string | undefined = undefined;

      if (fetchText) {
        try {
          const textData = await fetchBillText(
            CURRENT_CONGRESS,
            billData.type,
            parseInt(billData.number)
          );

          if (textData?.text) {
            fullText = textData.text;
            fullTextUrl = textData.url;
            textFetched++;
          } else if (textData?.url) {
            fullTextUrl = textData.url;
            textNotAvailable++;
          } else {
            textNotAvailable++;
          }

          // Add delay to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 300));
        } catch {
          console.log(`   ⚠️  Could not fetch text for ${billIdentifier}`);
          textNotAvailable++;
        }
      }

      let billId: string;

      if (!existing) {
        // Create new bill
        const newBill = await db.bill.create({
          data: {
            billType: billData.type.toLowerCase(), // Normalize to lowercase
            billNumber: parseInt(billData.number), // Convert string to number
            congress: CURRENT_CONGRESS,
            title: billData.title || `${billData.type} ${billData.number}`,
            officialTitle: billData.title,
            introducedDate,
            currentStatus: "INTRODUCED",
            statusDate: new Date(
              billData.latestAction?.actionDate || billData.introducedDate
            ),
            sourceUrl: billData.url,
            fullText,
            fullTextUrl,
            lastFetchedAt: new Date(),
          },
        });
        billId = newBill.id;

        const textIndicator = fullText
          ? ` 📄 [${Math.round(fullText.length / 1000)}KB]`
          : fullTextUrl
          ? " 🔗"
          : "";
        const dateStr = introducedDate.toISOString().split("T")[0];
        console.log(
          `✓ Created: ${billIdentifier}${textIndicator} [${dateStr}] - ${billData.title?.substring(
            0,
            50
          )}...`
        );
        created++;
      } else {
        // Update existing bill (and add full text if we don't have it yet)
        await db.bill.update({
          where: { id: existing.id },
          data: {
            statusDate: billData.latestAction?.actionDate
              ? new Date(billData.latestAction.actionDate)
              : existing.statusDate,
            lastFetchedAt: new Date(),
            // Only update text fields if we don't have them yet
            ...(!existing.fullText &&
              fullText && {
                fullText,
                fullTextUrl,
              }),
            ...(!existing.fullTextUrl &&
              !fullText &&
              fullTextUrl && {
                fullTextUrl,
              }),
          },
        });
        billId = existing.id;

        const textIndicator =
          !existing.fullText && fullText ? " 📄 [+text]" : "";
        console.log(`↻ Updated: ${billIdentifier}${textIndicator}`);
        updated++;
      }

      // Process companion bills if enabled
      if (FETCH_COMPANIONS) {
        const companionsFound = await processCompanionBills(
          billId,
          billData.type,
          billData.number,
          CURRENT_CONGRESS
        );
        if (companionsFound > 0) {
          console.log(`   🔗 Linked ${companionsFound} companion bill(s)`);
          companionsLinked += companionsFound;
        }

        // Add delay after companion detection
        if (companionsFound > 0) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
    } catch (error) {
      console.error(`✗ Error processing bill:`, error);
      skipped++;
    }
  }

  return {
    created,
    updated,
    skipped,
    textFetched,
    textNotAvailable,
    companionsLinked,
  };
}

async function main() {
  console.log(`\n🏛️  Fetching bills from Congress.gov (Paginated)`);
  console.log(`📊 Congress: ${CURRENT_CONGRESS}th`);
  console.log(`📦 Total Bills to Fetch: ${TOTAL_BILLS}`);
  console.log(`📄 Fetch Full Text: ${FETCH_TEXT ? "Yes" : "No"}`);
  console.log(`🔗 Fetch Companions: ${FETCH_COMPANIONS ? "Yes" : "No"}`);
  console.log(`⚡ Batch Size: ${BATCH_SIZE} (API limit)\n`);

  const numBatches = Math.ceil(TOTAL_BILLS / BATCH_SIZE);
  console.log(`🔢 Will process ${numBatches} batch(es)\n`);

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalTextFetched = 0;
  let totalTextNotAvailable = 0;
  let totalCompanionsLinked = 0;

  try {
    for (let batchNum = 0; batchNum < numBatches; batchNum++) {
      const offset = batchNum * BATCH_SIZE;
      const remainingBills = TOTAL_BILLS - offset;
      const batchLimit = Math.min(BATCH_SIZE, remainingBills);

      console.log(
        `\n📦 Batch ${
          batchNum + 1
        }/${numBatches} (offset: ${offset}, limit: ${batchLimit})`
      );
      console.log(`${"=".repeat(60)}\n`);

      const batchResults = await fetchBatch(offset, batchLimit, FETCH_TEXT);

      totalCreated += batchResults.created;
      totalUpdated += batchResults.updated;
      totalSkipped += batchResults.skipped;
      totalTextFetched += batchResults.textFetched;
      totalTextNotAvailable += batchResults.textNotAvailable;
      totalCompanionsLinked += batchResults.companionsLinked;

      console.log(`\n📊 Batch ${batchNum + 1} Summary:`);
      console.log(`   ✓ Created: ${batchResults.created}`);
      console.log(`   ↻ Updated: ${batchResults.updated}`);
      console.log(`   ✗ Skipped: ${batchResults.skipped}`);
      if (FETCH_TEXT) {
        console.log(`   📄 Text Fetched: ${batchResults.textFetched}`);
        console.log(`   ⚠️  Text N/A: ${batchResults.textNotAvailable}`);
      }
      if (FETCH_COMPANIONS) {
        console.log(
          `   🔗 Companions Linked: ${batchResults.companionsLinked}`
        );
      }

      // Add a delay between batches to be nice to the API
      if (batchNum < numBatches - 1) {
        console.log(`\n⏳ Waiting 2 seconds before next batch...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`\n📈 FINAL SUMMARY (All Batches):`);
    console.log(`   ✓ Total Created: ${totalCreated}`);
    console.log(`   ↻ Total Updated: ${totalUpdated}`);
    console.log(`   ✗ Total Skipped: ${totalSkipped}`);
    console.log(
      `   📊 Total Processed: ${totalCreated + totalUpdated + totalSkipped}`
    );
    if (FETCH_TEXT) {
      console.log(`   📄 Total Text Fetched: ${totalTextFetched}`);
      console.log(`   ⚠️  Total Text N/A: ${totalTextNotAvailable}`);
    }
    if (FETCH_COMPANIONS) {
      console.log(`   🔗 Total Companions Linked: ${totalCompanionsLinked}`);
    }
    console.log();

    if (totalCreated > 0 && !FETCH_TEXT) {
      console.log(
        `💡 Tip: Run 'npm run fetch-bill-texts' to fetch full text for new bills!\n`
      );
    }

    if (totalCreated > 0 || totalTextFetched > 0) {
      console.log(
        `💡 Tip: Run 'npm run summarize-bills' to generate AI summaries!\n`
      );
    }
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
