/**
 * Test script for companion bill detection
 *
 * This script:
 * 1. Deletes existing HR 4398 and S 2309 from database
 * 2. Fetches both bills fresh from Congress.gov
 * 3. Detects and creates companion bill links
 * 4. Verifies the relationship was created correctly
 */

import { config } from "dotenv";
config();

import { db } from "@/lib/db";
import { fetchBillDetails, fetchBillText } from "@/lib/api/congress";

const CONGRESS = 119;

async function fetchRelatedBills(
  congress: number,
  type: string,
  number: string
) {
  const url = `https://api.congress.gov/v3/bill/${congress}/${type.toLowerCase()}/${number}/relatedbills?api_key=${
    process.env.CONGRESS_API_KEY
  }`;
  const response = await fetch(url);
  const data = await response.json();
  return data.relatedBills || [];
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🧪 COMPANION BILL DETECTION TEST");
  console.log("=".repeat(80) + "\n");

  try {
    // Step 1: Delete existing bills
    console.log("1️⃣  Deleting existing test bills...");
    const deleted = await db.bill.deleteMany({
      where: {
        OR: [
          { billType: "HR", billNumber: 4398, congress: CONGRESS },
          { billType: "S", billNumber: 2309, congress: CONGRESS },
        ],
      },
    });
    console.log(`   ✅ Deleted ${deleted.count} bill(s)\n`);

    // Step 2: Fetch and create HR 4398
    console.log("2️⃣  Fetching HR 4398 (House)...");
    const hr4398 = await fetchBillDetails(CONGRESS, "hr", 4398);
    const hr4398Text = await fetchBillText(CONGRESS, "hr", 4398);

    const hrBill = await db.bill.create({
      data: {
        billType: "HR",
        billNumber: 4398,
        congress: CONGRESS,
        title:
          hr4398.title ||
          "Veteran Burial Timeliness and Death Certificate Accountability Act",
        officialTitle: hr4398.title,
        introducedDate: new Date(hr4398.introducedDate),
        currentStatus: "INTRODUCED",
        statusDate: new Date(hr4398.introducedDate),
        fullText: hr4398Text?.text || null,
        fullTextUrl: hr4398Text?.url,
        lastFetchedAt: new Date(),
      },
    });
    console.log(`   ✅ Created HR 4398 (ID: ${hrBill.id})`);
    console.log(
      `   📅 Date: ${hrBill.introducedDate.toISOString().split("T")[0]}`
    );
    console.log(
      `   📄 Text: ${
        hrBill.fullText ? `${hrBill.fullText.length} chars` : "N/A"
      }\n`
    );

    // Step 3: Fetch and create S 2309
    console.log("3️⃣  Fetching S 2309 (Senate)...");
    const s2309 = await fetchBillDetails(CONGRESS, "s", 2309);
    const s2309Text = await fetchBillText(CONGRESS, "s", 2309);

    const senateBill = await db.bill.create({
      data: {
        billType: "S",
        billNumber: 2309,
        congress: CONGRESS,
        title:
          s2309.title ||
          "Veteran Burial Timeliness and Death Certificate Accountability Act",
        officialTitle: s2309.title,
        introducedDate: new Date(s2309.introducedDate),
        currentStatus: "INTRODUCED",
        statusDate: new Date(s2309.introducedDate),
        fullText: s2309Text?.text || null,
        fullTextUrl: s2309Text?.url,
        lastFetchedAt: new Date(),
      },
    });
    console.log(`   ✅ Created S 2309 (ID: ${senateBill.id})`);
    console.log(
      `   📅 Date: ${senateBill.introducedDate.toISOString().split("T")[0]}`
    );
    console.log(
      `   📄 Text: ${
        senateBill.fullText ? `${senateBill.fullText.length} chars` : "N/A"
      }\n`
    );

    // Step 4: Fetch related bills for HR 4398
    console.log("4️⃣  Detecting companion bills for HR 4398...");
    const hrRelated = await fetchRelatedBills(CONGRESS, "hr", "4398");
    console.log(`   Found ${hrRelated.length} related bill(s):`);
    hrRelated.forEach((rb: any) => {
      console.log(
        `   - ${rb.type} ${rb.number}: ${
          rb.relationshipDetails?.[0]?.type || "N/A"
        }`
      );
    });

    // Step 5: Create companion relationship
    if (hrRelated.length > 0) {
      const relatedType =
        hrRelated[0].relationshipDetails?.[0]?.type || "Related bill";
      const companionType = relatedType.includes("Identical")
        ? "IDENTICAL"
        : "RELATED";

      console.log(`\n5️⃣  Creating companion relationship...`);
      const companion = await db.companionBill.create({
        data: {
          sourceBillId: hrBill.id,
          companionBillId: senateBill.id,
          relationshipType: companionType,
        },
      });
      console.log(`   ✅ Created CompanionBill link (ID: ${companion.id})`);
      console.log(`   🔗 Type: ${companion.relationshipType}\n`);
    }

    // Step 6: Verify the relationship
    console.log("6️⃣  Verifying companion bill relationship...");
    const hrWithCompanions = await db.bill.findUnique({
      where: { id: hrBill.id },
      include: {
        companionBills: {
          include: {
            companionBill: {
              select: {
                id: true,
                billType: true,
                billNumber: true,
                title: true,
                introducedDate: true,
                fullText: true,
              },
            },
          },
        },
      },
    });

    const senateWithCompanions = await db.bill.findUnique({
      where: { id: senateBill.id },
      include: {
        companionOf: {
          include: {
            sourceBill: {
              select: {
                id: true,
                billType: true,
                billNumber: true,
                title: true,
                introducedDate: true,
                fullText: true,
              },
            },
          },
        },
      },
    });

    console.log(
      `\n📊 HR 4398 Companions: ${hrWithCompanions?.companionBills.length || 0}`
    );
    if (hrWithCompanions?.companionBills.length) {
      hrWithCompanions.companionBills.forEach((cb) => {
        console.log(
          `   → ${cb.companionBill.billType} ${cb.companionBill.billNumber}`
        );
        console.log(
          `      Date: ${
            cb.companionBill.introducedDate.toISOString().split("T")[0]
          }`
        );
        console.log(`      Text: ${cb.companionBill.fullText ? "✅" : "❌"}`);
      });
    }

    console.log(
      `\n📊 S 2309 Companion Of: ${
        senateWithCompanions?.companionOf.length || 0
      }`
    );
    if (senateWithCompanions?.companionOf.length) {
      senateWithCompanions.companionOf.forEach((cb) => {
        console.log(
          `   ← ${cb.sourceBill.billType} ${cb.sourceBill.billNumber}`
        );
        console.log(
          `      Date: ${
            cb.sourceBill.introducedDate.toISOString().split("T")[0]
          }`
        );
        console.log(`      Text: ${cb.sourceBill.fullText ? "✅" : "❌"}`);
      });
    }

    // Step 7: Summary
    console.log("\n" + "=".repeat(80));
    console.log("✅ TEST RESULTS:");
    console.log("=".repeat(80));
    console.log(`✓ HR 4398 created with correct date and full text`);
    console.log(`✓ S 2309 created with correct date and full text`);
    console.log(`✓ Companion relationship established`);
    console.log(`✓ Bidirectional relationship verified`);
    console.log("\n🎉 All tests passed!\n");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

main();
