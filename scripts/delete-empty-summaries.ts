// Script to find and delete summaries with empty content
// This helps ensure bills are properly picked up by summarization scripts

import { db } from "@/lib/db";
import * as readline from "readline";

interface EmptySummary {
  id: string;
  summaryType: string;
  billId?: string;
  executiveOrderId?: string;
  createdAt: Date;
  bill?: {
    billType: string;
    billNumber: number;
    congress: number;
    title: string;
  };
  executiveOrder?: {
    orderNumber: number;
    title: string;
  };
}

async function findEmptySummaries() {
  console.log("🔍 Searching for summaries with empty content...\n");

  // Find summaries where content is empty string or only whitespace
  const emptySummaries = await db.summary.findMany({
    where: {
      OR: [
        { content: "" },
        { content: { in: ["", " ", "  "] } }, // Empty or whitespace
      ],
    },
    include: {
      bill: {
        select: {
          billType: true,
          billNumber: true,
          congress: true,
          title: true,
        },
      },
      executiveOrder: {
        select: {
          orderNumber: true,
          title: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return emptySummaries as EmptySummary[];
}

async function displaySummaries(summaries: EmptySummary[]) {
  if (summaries.length === 0) {
    console.log("✅ No empty summaries found! All summaries have content.\n");
    return;
  }

  console.log(
    `📋 Found ${summaries.length} summary/summaries with empty content:\n`
  );
  console.log("─".repeat(80));

  summaries.forEach((summary, index) => {
    console.log(`\n${index + 1}. Summary ID: ${summary.id}`);
    console.log(`   Type: ${summary.summaryType}`);
    console.log(`   Created: ${summary.createdAt.toLocaleString()}`);

    if (summary.bill) {
      const billId = `${summary.bill.billType.toUpperCase()} ${
        summary.bill.billNumber
      }`;
      console.log(`   Bill: ${billId} (${summary.bill.congress}th Congress)`);
      console.log(
        `   Title: ${summary.bill.title.substring(0, 80)}${
          summary.bill.title.length > 80 ? "..." : ""
        }`
      );
    }

    if (summary.executiveOrder) {
      console.log(
        `   Executive Order: EO ${summary.executiveOrder.orderNumber}`
      );
      console.log(
        `   Title: ${summary.executiveOrder.title.substring(0, 80)}${
          summary.executiveOrder.title.length > 80 ? "..." : ""
        }`
      );
    }
  });

  console.log("\n" + "─".repeat(80));
}

async function promptConfirmation(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      "\n⚠️  Do you want to DELETE these summaries? (yes/no): ",
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === "yes");
      }
    );
  });
}

async function deleteSummaries(summaries: EmptySummary[]) {
  console.log("\n🗑️  Deleting empty summaries...");

  const summaryIds = summaries.map((s) => s.id);

  const result = await db.summary.deleteMany({
    where: {
      id: {
        in: summaryIds,
      },
    },
  });

  console.log(`✅ Successfully deleted ${result.count} summary/summaries\n`);

  // Show which bills/EOs are now available for re-summarization
  console.log("📝 These items are now available for re-summarization:");
  summaries.forEach((summary, index) => {
    if (summary.bill) {
      const billId = `${summary.bill.billType.toUpperCase()} ${
        summary.bill.billNumber
      }`;
      console.log(`   ${index + 1}. ${billId} (${summary.summaryType})`);
    }
    if (summary.executiveOrder) {
      console.log(
        `   ${index + 1}. EO ${summary.executiveOrder.orderNumber} (${
          summary.summaryType
        })`
      );
    }
  });
  console.log("");
}

async function main() {
  try {
    console.log("🚀 Empty Summary Cleanup Script\n");
    console.log(
      "This script will help you find and delete summaries with empty content."
    );
    console.log(
      "Empty summaries prevent bills from being picked up by summarization scripts.\n"
    );

    // Step 1: Find empty summaries
    const emptySummaries = await findEmptySummaries();

    // Step 2: Display them
    await displaySummaries(emptySummaries);

    // If no empty summaries, exit
    if (emptySummaries.length === 0) {
      process.exit(0);
    }

    // Step 3: Ask for confirmation
    const confirmed = await promptConfirmation();

    if (!confirmed) {
      console.log("\n❌ Deletion cancelled. No changes made.\n");
      process.exit(0);
    }

    // Step 4: Delete the summaries
    await deleteSummaries(emptySummaries);

    console.log(
      "✨ Done! You can now run your summarization script to generate new summaries.\n"
    );
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

main();
