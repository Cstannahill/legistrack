// Manual script to fetch bills from Congress.gov
import { config } from "dotenv";
import { fetchLatestBills, fetchBillText } from "@/lib/api/congress";

// Load environment variables from .env file
config();
import { db } from "@/lib/db";
import { CURRENT_CONGRESS } from "@/lib/constants";

// Configurable parameters
const LIMIT = parseInt(process.env.LIMIT || "1000", 10);
const OFFSET = parseInt(process.env.OFFSET || "0", 10);
const FETCH_TEXT = process.env.FETCH_TEXT !== "false"; // Default true
const FETCH_COMPANIONS = process.env.FETCH_COMPANIONS !== "false"; // Default true

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

async function main() {
  console.log(`\n🏛️  Fetching bills from Congress.gov`);
  console.log(`📊 Congress: ${CURRENT_CONGRESS}th`);
  console.log(`📦 Limit: ${LIMIT} bills`);
  console.log(`⏭️  Offset: ${OFFSET}`);
  console.log(`📄 Fetch Full Text: ${FETCH_TEXT ? "Yes" : "No"}\n`);

  try {
    const bills = await fetchLatestBills({
      congress: CURRENT_CONGRESS,
      limit: LIMIT,
      offset: OFFSET,
    });

    console.log(`✓ Found ${bills.length} bills from API\n`);

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

        // introducedDate is REQUIRED - do not use updateDate as fallback
        if (!billData.introducedDate) {
          console.log(`⚠ Skipping ${billIdentifier}: missing introducedDate`);
          skipped++;
          continue;
        }

        const introducedDateStr = billData.introducedDate;

        const introducedDate = new Date(introducedDateStr);
        if (isNaN(introducedDate.getTime())) {
          console.log(
            `⚠ Skipping ${billIdentifier}: invalid date (${introducedDateStr})`
          );
          skipped++;
          continue;
        }

        // Debug logging for the two test bills
        if (billData.number === "4398" || billData.number === "2309") {
          console.log(`\n🔍 DEBUG ${billIdentifier}:`);
          console.log(`   introducedDate: ${introducedDateStr}`);
          console.log(`   updateDate: ${billData.updateDate || "N/A"}`);
          console.log(`   title: ${billData.title?.substring(0, 60)}...`);
        }

        // Attempt to fetch full text if enabled
        let fullText: string | null = null;
        let fullTextUrl: string | undefined = undefined;

        if (FETCH_TEXT) {
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
              // Debug logging for test bills
              if (billData.number === "4398" || billData.number === "2309") {
                console.log(
                  `   ✅ Text fetched: ${fullText.length} characters`
                );
              }
            } else if (textData?.url) {
              fullTextUrl = textData.url;
              textNotAvailable++;
              if (billData.number === "4398" || billData.number === "2309") {
                console.log(`   ⚠️  URL only: ${fullTextUrl}`);
              }
            } else {
              textNotAvailable++;
              if (billData.number === "4398" || billData.number === "2309") {
                console.log(`   ❌ No text available`);
              }
            }

            // Add delay to avoid rate limiting
            await new Promise((resolve) => setTimeout(resolve, 300));
          } catch {
            console.log(`   ⚠️  Could not fetch text for ${billIdentifier}`);
            textNotAvailable++;
          }
        }

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

          // Process companion bills if enabled
          if (FETCH_COMPANIONS) {
            const companions = await processCompanionBills(
              newBill.id,
              billData.type,
              billData.number,
              CURRENT_CONGRESS
            );
            if (companions > 0) {
              console.log(`   🔗 Linked ${companions} companion bill(s)`);
              companionsLinked += companions;
            }
          }
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

          const textIndicator =
            !existing.fullText && fullText ? " 📄 [+text]" : "";
          console.log(`↻ Updated: ${billIdentifier}${textIndicator}`);
          updated++;

          // Process companion bills if enabled
          if (FETCH_COMPANIONS) {
            const companions = await processCompanionBills(
              existing.id,
              billData.type,
              billData.number,
              CURRENT_CONGRESS
            );
            if (companions > 0) {
              console.log(`   🔗 Linked ${companions} companion bill(s)`);
              companionsLinked += companions;
            }
          }
        }
      } catch (error) {
        console.error(`✗ Error processing bill:`, error);
        skipped++;
      }
    }

    console.log(`\n📈 Summary:`);
    console.log(`   ✓ Created: ${created}`);
    console.log(`   ↻ Updated: ${updated}`);
    console.log(`   ✗ Skipped: ${skipped}`);
    console.log(`   📊 Total: ${bills.length}`);
    if (FETCH_TEXT) {
      console.log(`   📄 Full Text Fetched: ${textFetched}`);
      console.log(`   ⚠️  Text Not Available: ${textNotAvailable}`);
    }
    if (FETCH_COMPANIONS) {
      console.log(`   🔗 Companion Links Created: ${companionsLinked}`);
    }
    console.log();
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
