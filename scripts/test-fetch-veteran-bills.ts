/**
 * Test Script: Fetch the Veteran Burial Bills
 *
 * This script fetches ONLY the two Veteran Burial bills to test:
 * 1. Correct date usage (introducedDate not updateDate)
 * 2. Full text fetching and storage
 * 3. Proper database insertion
 *
 * After deleting the duplicates from DB, run this to verify the fix.
 */

import "dotenv/config";
import { db } from "../src/lib/db";
import { fetchBillDetails, fetchBillText } from "../src/lib/api/congress";

const CONGRESS = 119;

const TEST_BILLS = [
  { type: "hr", number: 4398, label: "HR 4398 (House)" },
  { type: "s", number: 2309, label: "S 2309 (Senate)" },
];

async function fetchAndStoreBill(
  billType: string,
  billNumber: number,
  label: string
) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`🔍 FETCHING: ${label}`);
  console.log(`${"=".repeat(80)}\n`);

  try {
    // 1. Fetch bill details
    console.log(`1️⃣  Fetching bill details...`);
    const billData = await fetchBillDetails(CONGRESS, billType, billNumber);

    console.log(`   ✅ Title: ${billData.title}`);
    console.log(`   📅 Introduced: ${billData.introducedDate}`);
    console.log(`   🔄 Updated: ${billData.updateDate || "N/A"}`);
    console.log(`   📍 Latest Action: ${billData.latestAction?.text || "N/A"}`);
    console.log(
      `   📆 Action Date: ${billData.latestAction?.actionDate || "N/A"}`
    );

    // 2. Fetch full text
    console.log(`\n2️⃣  Fetching full text...`);
    const textData = await fetchBillText(CONGRESS, billType, billNumber);

    let fullText: string | null = null;
    let fullTextUrl: string | undefined = undefined;

    if (textData?.text) {
      fullText = textData.text;
      fullTextUrl = textData.url;
      console.log(`   ✅ Text fetched: ${fullText.length} characters`);
      console.log(`   🔗 URL: ${fullTextUrl}`);
      console.log(`   📝 Preview: ${fullText.substring(0, 200)}...`);
    } else if (textData?.url) {
      fullTextUrl = textData.url;
      console.log(`   ⚠️  URL only (no text content): ${fullTextUrl}`);
    } else {
      console.log(`   ❌ No text available`);
    }

    // 3. Check if bill exists in database
    console.log(`\n3️⃣  Checking database...`);
    const existing = await db.bill.findFirst({
      where: {
        congress: CONGRESS,
        billType: billType,
        billNumber: billNumber,
      },
    });

    if (existing) {
      console.log(`   ⚠️  Bill already exists in database:`);
      console.log(`      ID: ${existing.id}`);
      console.log(
        `      Introduced: ${
          existing.introducedDate.toISOString().split("T")[0]
        }`
      );
      console.log(
        `      Has Text: ${
          existing.fullText ? `Yes (${existing.fullText.length} chars)` : "No"
        }`
      );
      console.log(
        `\n   ❌ Skipping - delete the bill first if you want to re-fetch`
      );
      return;
    }

    // 4. Create bill in database
    console.log(`\n4️⃣  Creating bill in database...`);

    const introducedDate = new Date(billData.introducedDate);
    const statusDate = new Date(
      billData.latestAction?.actionDate || billData.introducedDate
    );

    const created = await db.bill.create({
      data: {
        billType: billType,
        billNumber: billNumber,
        congress: CONGRESS,
        title: billData.title || `${billType.toUpperCase()} ${billNumber}`,
        officialTitle: billData.title,
        introducedDate,
        currentStatus: "INTRODUCED",
        statusDate,
        sourceUrl: billData.url,
        fullText,
        fullTextUrl,
        lastFetchedAt: new Date(),
      },
    });

    console.log(`   ✅ Bill created successfully!`);
    console.log(`      Database ID: ${created.id}`);
    console.log(
      `      Bill Type: ${created.billType.toUpperCase()} ${created.billNumber}`
    );
    console.log(
      `      Introduced: ${created.introducedDate.toISOString().split("T")[0]}`
    );
    console.log(
      `      Status Date: ${created.statusDate.toISOString().split("T")[0]}`
    );
    console.log(
      `      Full Text: ${
        created.fullText ? `✅ ${created.fullText.length} chars` : "❌ None"
      }`
    );
    console.log(`      URL: ${created.fullTextUrl || "N/A"}`);

    // 5. Verify by reading back from database
    console.log(`\n5️⃣  Verifying data in database...`);
    const verified = await db.bill.findUnique({
      where: { id: created.id },
      select: {
        id: true,
        billType: true,
        billNumber: true,
        title: true,
        introducedDate: true,
        statusDate: true,
        fullText: true,
        fullTextUrl: true,
      },
    });

    if (!verified) {
      console.log(`   ❌ ERROR: Could not read back from database!`);
      return;
    }

    console.log(`   ✅ Verification successful`);
    console.log(`      Title matches: ${verified.title === billData.title}`);
    console.log(
      `      Date matches: ${
        verified.introducedDate.toISOString().split("T")[0] ===
        billData.introducedDate
      }`
    );
    console.log(
      `      Has text: ${
        verified.fullText ? `Yes (${verified.fullText.length})` : "No"
      }`
    );

    if (fullText && !verified.fullText) {
      console.log(
        `\n   ⚠️  WARNING: Text was fetched but NOT saved to database!`
      );
      console.log(`      Fetched: ${fullText.length} chars`);
      console.log(`      In DB: ${verified.fullText?.length || 0} chars`);
    }

    if (fullText && verified.fullText) {
      console.log(`\n   ✅ SUCCESS: Full text saved correctly!`);
    }

    console.log(`\n✅ ${label} completed successfully!\n`);
  } catch (error) {
    console.error(`\n❌ Error processing ${label}:`, error);
    throw error;
  }
}

async function main() {
  console.log(`\n${"█".repeat(80)}`);
  console.log(
    `🧪 TEST: Veteran Burial Bills Fetch - Correct Dates & Text Storage`
  );
  console.log(`${"█".repeat(80)}`);

  console.log(`\nTarget Bills:`);
  TEST_BILLS.forEach((bill) => {
    console.log(
      `  • ${bill.label} - ${bill.type.toUpperCase()} ${bill.number}`
    );
  });

  console.log(`\nExpected Results:`);
  console.log(`  ✅ HR 4398 - Introduced: 2025-07-15`);
  console.log(`  ✅ S 2309  - Introduced: 2025-07-16`);
  console.log(`  ✅ Both bills have full text (~4,200 characters each)`);
  console.log(`  ✅ Text is stored in database\n`);

  for (const bill of TEST_BILLS) {
    await fetchAndStoreBill(bill.type, bill.number, bill.label);
    // Add delay between bills to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log(`📊 FINAL VERIFICATION`);
  console.log(`${"=".repeat(80)}\n`);

  const allBills = await db.bill.findMany({
    where: {
      OR: [
        { billType: "hr", billNumber: 4398, congress: CONGRESS },
        { billType: "s", billNumber: 2309, congress: CONGRESS },
      ],
    },
    select: {
      billType: true,
      billNumber: true,
      title: true,
      introducedDate: true,
      fullText: true,
    },
  });

  console.log(`Found ${allBills.length} bills in database:\n`);

  allBills.forEach((bill) => {
    const dateStr = bill.introducedDate.toISOString().split("T")[0];
    const textStatus = bill.fullText
      ? `✅ ${bill.fullText.length} chars`
      : "❌ NONE";
    console.log(
      `  ${bill.billType.toUpperCase()} ${
        bill.billNumber
      } - ${dateStr} - Text: ${textStatus}`
    );
  });

  const hr4398 = allBills.find(
    (b) => b.billType === "hr" && b.billNumber === 4398
  );
  const s2309 = allBills.find(
    (b) => b.billType === "s" && b.billNumber === 2309
  );

  console.log(`\n${"─".repeat(80)}`);
  console.log(`🎯 TEST RESULTS:\n`);

  if (hr4398) {
    const hr4398Date = hr4398.introducedDate.toISOString().split("T")[0];
    const hr4398DateCorrect = hr4398Date === "2025-07-15";
    const hr4398HasText = !!hr4398.fullText && hr4398.fullText.length > 4000;

    console.log(`HR 4398:`);
    console.log(
      `  Date: ${hr4398DateCorrect ? "✅" : "❌"} ${hr4398Date} ${
        hr4398DateCorrect ? "(correct)" : "(WRONG - should be 2025-07-15)"
      }`
    );
    console.log(
      `  Text: ${hr4398HasText ? "✅" : "❌"} ${
        hr4398.fullText?.length || 0
      } chars ${hr4398HasText ? "(correct)" : "(MISSING)"}`
    );
  } else {
    console.log(`HR 4398: ❌ NOT FOUND IN DATABASE`);
  }

  console.log();

  if (s2309) {
    const s2309Date = s2309.introducedDate.toISOString().split("T")[0];
    const s2309DateCorrect = s2309Date === "2025-07-16";
    const s2309HasText = !!s2309.fullText && s2309.fullText.length > 4000;

    console.log(`S 2309:`);
    console.log(
      `  Date: ${s2309DateCorrect ? "✅" : "❌"} ${s2309Date} ${
        s2309DateCorrect ? "(correct)" : "(WRONG - should be 2025-07-16)"
      }`
    );
    console.log(
      `  Text: ${s2309HasText ? "✅" : "❌"} ${
        s2309.fullText?.length || 0
      } chars ${s2309HasText ? "(correct)" : "(MISSING)"}`
    );
  } else {
    console.log(`S 2309: ❌ NOT FOUND IN DATABASE`);
  }

  const allTestsPassed =
    hr4398 &&
    s2309 &&
    hr4398.introducedDate.toISOString().split("T")[0] === "2025-07-15" &&
    s2309.introducedDate.toISOString().split("T")[0] === "2025-07-16" &&
    hr4398.fullText &&
    hr4398.fullText.length > 4000 &&
    s2309.fullText &&
    s2309.fullText.length > 4000;

  console.log(`\n${"=".repeat(80)}`);
  if (allTestsPassed) {
    console.log(`✅ ALL TESTS PASSED!`);
    console.log(`   • Both bills fetched correctly`);
    console.log(`   • Dates are correct (introducedDate not updateDate)`);
    console.log(`   • Full text fetched and stored successfully`);
  } else {
    console.log(`❌ TESTS FAILED - See details above`);
  }
  console.log(`${"=".repeat(80)}\n`);
}

main()
  .catch((error) => {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
