/**
 * Legislation Completeness Check Script
 *
 * Checks how many bills and executive orders are missing:
 * - Tags/Categories
 * - Summaries (STANDARD type)
 * - Full Text
 *
 * Usage:
 *   npm run check-completeness
 */

import "dotenv/config";
import { db } from "../src/lib/db";

interface Stats {
  total: number;
  withoutTags: number;
  withoutSummaries: number;
  withoutFullText: number;
  complete: number;
}

async function checkBills(): Promise<Stats> {
  console.log("\n📊 Checking Bills...");

  // Total bills
  const total = await db.bill.count();

  // Bills without any categories
  const withoutTags = await db.bill.count({
    where: {
      categories: {
        none: {},
      },
    },
  });

  // Bills without STANDARD summaries
  const withoutSummaries = await db.bill.count({
    where: {
      summaries: {
        none: {
          summaryType: "STANDARD",
        },
      },
    },
  });

  // Bills without full text
  const withoutFullText = await db.bill.count({
    where: {
      OR: [{ fullText: null }, { fullText: "" }],
    },
  });

  // Bills that are complete (have all three)
  const complete = await db.bill.count({
    where: {
      AND: [
        {
          categories: {
            some: {},
          },
        },
        {
          summaries: {
            some: {
              summaryType: "STANDARD",
            },
          },
        },
        {
          fullText: {
            not: null,
          },
        },
        {
          fullText: {
            not: "",
          },
        },
      ],
    },
  });

  return {
    total,
    withoutTags,
    withoutSummaries,
    withoutFullText,
    complete,
  };
}

async function checkExecutiveOrders(): Promise<Stats> {
  console.log("\n📊 Checking Executive Orders...");

  // Total executive orders
  const total = await db.executiveOrder.count();

  // EOs without any categories
  const withoutTags = await db.executiveOrder.count({
    where: {
      categories: {
        none: {},
      },
    },
  });

  // EOs without STANDARD summaries
  const withoutSummaries = await db.executiveOrder.count({
    where: {
      summaries: {
        none: {
          summaryType: "STANDARD",
        },
      },
    },
  });

  // EOs without full text
  const withoutFullText = await db.executiveOrder.count({
    where: {
      OR: [{ fullText: null }, { fullText: "" }],
    },
  });

  // EOs that are complete (have all three)
  const complete = await db.executiveOrder.count({
    where: {
      AND: [
        {
          categories: {
            some: {},
          },
        },
        {
          summaries: {
            some: {
              summaryType: "STANDARD",
            },
          },
        },
        {
          fullText: {
            not: null,
          },
        },
        {
          fullText: {
            not: "",
          },
        },
      ],
    },
  });

  return {
    total,
    withoutTags,
    withoutSummaries,
    withoutFullText,
    complete,
  };
}

function printStats(label: string, stats: Stats) {
  const percentage = (count: number) =>
    stats.total > 0 ? ((count / stats.total) * 100).toFixed(1) : "0.0";

  console.log(`\n${"=".repeat(80)}`);
  console.log(`📋 ${label}`);
  console.log(`${"=".repeat(80)}`);
  console.log(`📊 Total:                 ${stats.total.toLocaleString()}`);
  console.log(
    `❌ Without Tags:          ${stats.withoutTags.toLocaleString()} (${percentage(
      stats.withoutTags
    )}%)`
  );
  console.log(
    `❌ Without Summaries:     ${stats.withoutSummaries.toLocaleString()} (${percentage(
      stats.withoutSummaries
    )}%)`
  );
  console.log(
    `❌ Without Full Text:     ${stats.withoutFullText.toLocaleString()} (${percentage(
      stats.withoutFullText
    )}%)`
  );
  console.log(
    `✅ Complete (all 3):      ${stats.complete.toLocaleString()} (${percentage(
      stats.complete
    )}%)`
  );
  console.log(`${"=".repeat(80)}`);
}

async function main() {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`🔍 LEGISLATION COMPLETENESS CHECK`);
  console.log(`${"=".repeat(80)}`);
  console.log(`Checking for missing:`);
  console.log(`  • Tags/Categories`);
  console.log(`  • Summaries (STANDARD type)`);
  console.log(`  • Full Text`);
  console.log(`${"=".repeat(80)}`);

  try {
    // Check bills
    const billStats = await checkBills();
    printStats("BILLS", billStats);

    // Check executive orders
    const eoStats = await checkExecutiveOrders();
    printStats("EXECUTIVE ORDERS", eoStats);

    // Combined totals
    const combinedTotal = billStats.total + eoStats.total;
    const combinedWithoutTags = billStats.withoutTags + eoStats.withoutTags;
    const combinedWithoutSummaries =
      billStats.withoutSummaries + eoStats.withoutSummaries;
    const combinedWithoutFullText =
      billStats.withoutFullText + eoStats.withoutFullText;
    const combinedComplete = billStats.complete + eoStats.complete;

    printStats("COMBINED TOTAL", {
      total: combinedTotal,
      withoutTags: combinedWithoutTags,
      withoutSummaries: combinedWithoutSummaries,
      withoutFullText: combinedWithoutFullText,
      complete: combinedComplete,
    });

    // Action recommendations
    console.log(`\n💡 RECOMMENDED ACTIONS:`);
    console.log(`${"=".repeat(80)}`);

    if (combinedWithoutTags > 0) {
      console.log(
        `\n📌 Tag ${combinedWithoutTags.toLocaleString()} items without categories:`
      );
      console.log(`   npm run tag-bills              # Tag all bills`);
      console.log(
        `   npm run tag-executive-orders   # Tag all executive orders`
      );
      console.log(`   Or with custom batch size:`);
      console.log(`   npx cross-env BATCH_SIZE=20 npm run tag-bills`);
    }

    if (combinedWithoutSummaries > 0) {
      console.log(
        `\n📝 Summarize ${combinedWithoutSummaries.toLocaleString()} items without summaries:`
      );
      console.log(
        `   npm run summarize-bills-openai          # Fast, low cost`
      );
      console.log(`   npm run summarize-bills-anthropic       # High quality`);
      console.log(
        `   npm run summarize-eos-openai            # Executive orders`
      );
      console.log(`   npm run summarize-eos-anthropic`);
      console.log(`   Or with custom batch size:`);
      console.log(
        `   npx cross-env BATCH_SIZE=5 npm run summarize-bills-anthropic`
      );
    }

    if (combinedWithoutFullText > 0) {
      console.log(
        `\n📄 Fetch full text for ${combinedWithoutFullText.toLocaleString()} items:`
      );
      console.log(
        `   npm run fetch-bill-texts        # Fetch missing bill texts`
      );
      console.log(
        `   npm run update-eo-full-text     # Fetch missing EO texts`
      );
    }

    if (combinedComplete === combinedTotal) {
      console.log(
        `\n🎉 All ${combinedTotal.toLocaleString()} items are complete!`
      );
    }

    console.log(`\n${"=".repeat(80)}\n`);
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
