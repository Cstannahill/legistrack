// Script to fetch and update full text for executive orders that are missing it
import { config } from "dotenv";
config();

import { db } from "@/lib/db";
import { fetchExecutiveOrderFullText } from "@/lib/api/federal-register";

// Rate limiting delay (to be nice to the API)
const DELAY_MS = 1000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log("\n🔍 Finding executive orders without full text...\n");

  try {
    // Find all EOs that don't have full text
    const eosWithoutText = await db.executiveOrder.findMany({
      where: {
        fullText: null,
      },
      orderBy: {
        signingDate: "desc",
      },
    });

    if (eosWithoutText.length === 0) {
      console.log("✅ All executive orders already have full text!\n");
      return;
    }

    console.log(
      `📋 Found ${eosWithoutText.length} executive orders without full text\n`
    );
    console.log("🚀 Starting full text fetch...\n");

    let successCount = 0;
    let failCount = 0;

    for (const eo of eosWithoutText) {
      const identifier = `EO ${eo.orderNumber}`;
      console.log(`\n📄 Processing: ${identifier}`);
      console.log(`   Title: ${eo.title.substring(0, 70)}...`);

      // Extract document number from Federal Register URL
      // URL format: https://www.federalregister.gov/documents/2025/01/20/2025-01234/...
      const documentNumber = eo.federalRegisterUrl?.match(
        /\/documents\/\d{4}\/\d{2}\/\d{2}\/([\d-]+)/
      )?.[1];

      if (!documentNumber) {
        console.log(`   ⚠️  Could not extract document number from URL`);
        failCount++;
        continue;
      }

      console.log(`   Document Number: ${documentNumber}`);

      try {
        // Fetch full text from Federal Register
        console.log(`   → Fetching full text from Federal Register API...`);
        const fullText = await fetchExecutiveOrderFullText(documentNumber);

        if (!fullText) {
          console.log(`   ⚠️  No full text available for ${identifier}`);
          failCount++;
          continue;
        }

        // Update the database
        await db.executiveOrder.update({
          where: { id: eo.id },
          data: { fullText },
        });

        const textSizeKB = (fullText.length / 1024).toFixed(1);
        console.log(`   ✅ Updated with ${textSizeKB}KB of text`);
        successCount++;

        // Rate limiting - be nice to the API
        if (eosWithoutText.indexOf(eo) < eosWithoutText.length - 1) {
          await delay(DELAY_MS);
        }
      } catch (error) {
        console.error(
          `   ❌ Failed to fetch full text for ${identifier}:`,
          error instanceof Error ? error.message : String(error)
        );
        failCount++;
      }
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 SUMMARY");
    console.log("=".repeat(60));
    console.log(`✅ Successfully updated: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log(`📝 Total processed: ${eosWithoutText.length}`);
    console.log("");

    if (successCount > 0) {
      console.log(
        "💡 Next step: Run 'npm run summarize-executive-orders' to generate summaries\n"
      );
    }
  } catch (error) {
    console.error("❌ Error:", error);
    throw error;
  } finally {
    await db.$disconnect();
  }
}

main();
