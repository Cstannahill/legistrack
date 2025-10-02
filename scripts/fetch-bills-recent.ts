// Fetch bills from the last 30 days only (for testing)
import { config } from "dotenv";
import { fetchLatestBills } from "@/lib/api/congress";

// Load environment variables from .env file
config();
import { db } from "@/lib/db";
import { CURRENT_CONGRESS } from "@/lib/constants";

// Get date 30 days ago
const DAYS_BACK = 30;
const dateFrom = new Date();
dateFrom.setDate(dateFrom.getDate() - DAYS_BACK);
// Remove milliseconds from ISO string (API expects format: 2025-09-01T00:00:00Z)
const fromDate = dateFrom.toISOString().replace(/\.\d{3}Z$/, "Z");
const toDate = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

async function main() {
  console.log(`\n🏛️  Fetching recent bills from Congress.gov`);
  console.log(`📊 Congress: ${CURRENT_CONGRESS}th`);
  console.log(
    `📅 Date Range: Last ${DAYS_BACK} days (from ${fromDate.split("T")[0]})`
  );
  console.log(`⏰ Current Date: ${new Date().toISOString().split("T")[0]}\n`);

  try {
    const bills = await fetchLatestBills({
      congress: CURRENT_CONGRESS,
      limit: 250,
      offset: 0,
      fromDateTime: fromDate,
      toDateTime: toDate,
    });

    console.log(`✓ Found ${bills.length} bills from last ${DAYS_BACK} days\n`);

    if (bills.length === 0) {
      console.log(
        "ℹ️  No bills found in the date range. This is normal if Congress is not in session.\n"
      );
      return;
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

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

        const billIdentifier = `${billData.type} ${billData.number}`;

        // introducedDate is required - use updateDate as fallback if missing
        const introducedDateStr =
          billData.introducedDate || billData.updateDate;

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

        if (!existing) {
          // Create new bill
          await db.bill.create({
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
              lastFetchedAt: new Date(),
            },
          });
          console.log(
            `✓ Created: ${billIdentifier} (${introducedDate.toLocaleDateString()}) - ${billData.title?.substring(
              0,
              50
            )}...`
          );
          created++;
        } else {
          // Update existing bill
          await db.bill.update({
            where: { id: existing.id },
            data: {
              currentStatus: existing.currentStatus,
              statusDate: billData.latestAction?.actionDate
                ? new Date(billData.latestAction.actionDate)
                : existing.statusDate,
              lastFetchedAt: new Date(),
            },
          });
          console.log(`↻ Updated: ${billIdentifier}`);
          updated++;
        }
      } catch (error) {
        console.error(`✗ Error processing bill:`, error);
        skipped++;
      }
    }

    console.log(`\n📈 Summary:`);
    console.log(
      `   📅 Date Range: ${fromDate} to ${
        new Date().toISOString().split("T")[0]
      }`
    );
    console.log(`   ✓ Created: ${created}`);
    console.log(`   ↻ Updated: ${updated}`);
    console.log(`   ✗ Skipped: ${skipped}`);
    console.log(`   📊 Total: ${bills.length}\n`);
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
