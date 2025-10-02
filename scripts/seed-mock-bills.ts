// Test script with mock data (no API key required)
import { config } from "dotenv";
import { db } from "@/lib/db";
import { BillStatus } from "@prisma/client";

// Load environment variables from .env file
config();

const MOCK_BILLS = [
  {
    congress: 119,
    billType: "hr",
    billNumber: 1,
    title:
      "To provide for reconciliation pursuant to titles II and V of the concurrent resolution on the budget for fiscal year 2024.",
    introducedDate: new Date("2025-09-15"),
    currentStatus: "INTRODUCED",
  },
  {
    congress: 119,
    billType: "s",
    billNumber: 1,
    title:
      "A bill to amend the Internal Revenue Code of 1986 to extend certain provisions, and for other purposes.",
    introducedDate: new Date("2025-09-20"),
    currentStatus: "INTRODUCED",
  },
  {
    congress: 119,
    billType: "hr",
    billNumber: 2,
    title:
      "To address the impact of climate change on agriculture, and for other purposes.",
    introducedDate: new Date("2025-09-25"),
    currentStatus: "INTRODUCED",
  },
];

async function main() {
  console.log("\n🧪 Inserting mock bills for testing\n");

  let created = 0;

  for (const billData of MOCK_BILLS) {
    try {
      const existing = await db.bill.findFirst({
        where: {
          congress: billData.congress,
          billType: billData.billType,
          billNumber: billData.billNumber,
        },
      });

      if (!existing) {
        await db.bill.create({
          data: {
            ...billData,
            statusDate: billData.introducedDate,
            sourceUrl: `https://www.congress.gov/bill/${billData.congress}th-congress/${billData.billType}/${billData.billNumber}`,
            lastFetchedAt: new Date(),
          },
        });
        console.log(
          `✓ Created: ${billData.billType.toUpperCase()} ${billData.billNumber}`
        );
        created++;
      } else {
        console.log(
          `- Skipped: ${billData.billType.toUpperCase()} ${
            billData.billNumber
          } (already exists)`
        );
      }
    } catch (error) {
      console.error(`✗ Error:`, error);
    }
  }

  console.log(`\n📈 Summary:`);
  console.log(`   ✓ Created: ${created}`);
  console.log(`   📊 Total: ${MOCK_BILLS.length}\n`);
  console.log(`💡 Now run: npm run summarize-bills\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
