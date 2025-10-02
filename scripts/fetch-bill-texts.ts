// Script to fetch full text for bills that don't have it yet
import { config } from "dotenv";
import { fetchBillText } from "@/lib/api/congress";

// Load environment variables from .env file
config();
import { db } from "@/lib/db";

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "20", 10);

async function main() {
  console.log(`\n📄 Fetching full text for bills`);
  console.log(`📦 Batch Size: ${BATCH_SIZE} bills\n`);

  try {
    // Find bills without full text
    const billsWithoutText = await db.bill.findMany({
      where: {
        fullText: null,
      },
      take: BATCH_SIZE,
      orderBy: { introducedDate: "desc" },
      select: {
        id: true,
        billType: true,
        billNumber: true,
        congress: true,
        title: true,
      },
    });

    if (billsWithoutText.length === 0) {
      console.log("ℹ️  All bills have full text or no bills found.\n");
      return;
    }

    console.log(`✓ Found ${billsWithoutText.length} bills without full text\n`);

    let successCount = 0;
    let notAvailableCount = 0;
    let failCount = 0;

    for (const bill of billsWithoutText) {
      const billIdentifier = `${bill.billType.toUpperCase()} ${
        bill.billNumber
      }`;
      console.log(`📄 Processing: ${billIdentifier}`);

      try {
        const textData = await fetchBillText(
          bill.congress,
          bill.billType,
          bill.billNumber
        );

        if (textData?.text) {
          // Update bill with full text
          await db.bill.update({
            where: { id: bill.id },
            data: {
              fullText: textData.text,
              fullTextUrl: textData.url,
            },
          });

          console.log(
            `   ✓ Fetched full text (${
              textData.text.length
            } chars) - ${bill.title?.substring(0, 50)}...`
          );
          successCount++;
        } else if (textData?.url) {
          // Text not available yet, but we have a URL
          await db.bill.update({
            where: { id: bill.id },
            data: {
              fullTextUrl: textData.url,
            },
          });

          console.log(
            `   ⚠️  Text not available yet, saved URL - ${bill.title?.substring(
              0,
              50
            )}...`
          );
          notAvailableCount++;
        } else {
          console.log(
            `   ⚠️  No text available - ${bill.title?.substring(0, 50)}...`
          );
          notAvailableCount++;
        }

        // Add a small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`   ✗ Error: ${error}`);
        failCount++;
      }
    }

    console.log(`\n📈 Summary:`);
    console.log(`   ✓ Full Text Fetched: ${successCount}`);
    console.log(`   ⚠️  Not Available Yet: ${notAvailableCount}`);
    console.log(`   ✗ Failed: ${failCount}`);
    console.log(`   📊 Total Processed: ${billsWithoutText.length}\n`);

    if (successCount > 0) {
      console.log(
        `💡 Tip: Run 'npm run summarize-bills' to generate AI summaries for these bills!\n`
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
