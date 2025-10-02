/**
 * Single Bill Deep Fetch Test Script
 *
 * This script focuses on ONE bill: "Veteran Burial Timeliness and Death Certificate Accountability Act"
 * We'll fetch ALL available data from Congress.gov API to ensure we're utilizing everything correctly.
 *
 * Known instances:
 * - HR 4398 (119th Congress)
 * - S 2309 (119th Congress)
 *
 * API Endpoints we'll test:
 * 1. GET /bill/{congress}/{billType}/{billNumber} - Main bill details
 * 2. GET /bill/{congress}/{billType}/{billNumber}/actions - All actions/history
 * 3. GET /bill/{congress}/{billType}/{billNumber}/amendments - Amendments
 * 4. GET /bill/{congress}/{billType}/{billNumber}/committees - Committee assignments
 * 5. GET /bill/{congress}/{billType}/{billNumber}/cosponsors - Cosponsors list
 * 6. GET /bill/{congress}/{billType}/{billNumber}/relatedbills - Related bills (companion bills!)
 * 7. GET /bill/{congress}/{billType}/{billNumber}/subjects - Legislative subjects/topics
 * 8. GET /bill/{congress}/{billType}/{billNumber}/summaries - Official summaries
 * 9. GET /bill/{congress}/{billType}/{billNumber}/text - Full text versions
 * 10. GET /bill/{congress}/{billType}/{billNumber}/titles - All title versions
 */

import "dotenv/config";
import { db } from "../src/lib/db";

const BASE_URL = "https://api.congress.gov/v3";
const API_KEY = process.env.CONGRESS_API_KEY!;

interface BillIdentifier {
  congress: number;
  billType: string;
  billNumber: number;
  label: string;
}

// Our test bills
const TEST_BILLS: BillIdentifier[] = [
  {
    congress: 119,
    billType: "hr",
    billNumber: 4398,
    label: "HR 4398 (House)",
  },
  {
    congress: 119,
    billType: "s",
    billNumber: 2309,
    label: "S 2309 (Senate)",
  },
];

async function fetchFromAPI(endpoint: string): Promise<any> {
  const url = `${BASE_URL}${endpoint}${
    endpoint.includes("?") ? "&" : "?"
  }api_key=${API_KEY}&format=json`;

  console.log(`   📡 Fetching: ${endpoint}`);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    if (response.status === 404) {
      console.log(`   ⚠️  Not found (404) - Data may not be available yet`);
      return null;
    }
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

async function fetchBillText(
  congress: number,
  billType: string,
  billNumber: number
): Promise<string | null> {
  const textData = await fetchFromAPI(
    `/bill/${congress}/${billType}/${billNumber}/text`
  );

  if (!textData?.textVersions || textData.textVersions.length === 0) {
    console.log(`   ⚠️  No text versions available`);
    return null;
  }

  const latestVersion = textData.textVersions[0];
  console.log(
    `   📄 Found ${textData.textVersions.length} text version(s), latest: ${latestVersion.type} (${latestVersion.date})`
  );

  const formattedText = latestVersion.formats?.find(
    (f: { type: string; url: string }) =>
      f.type === "Formatted Text" || f.type === "TXT"
  );

  if (formattedText?.url) {
    try {
      const textResponse = await fetch(
        `${formattedText.url}?api_key=${API_KEY}`,
        {
          headers: { Accept: "text/html,text/plain,*/*" },
        }
      );

      if (textResponse.ok) {
        let fullText = await textResponse.text();

        // Extract from HTML if needed
        if (fullText.includes("<html>") && fullText.includes("<pre>")) {
          const preMatch = fullText.match(/<pre>([\s\S]*?)<\/pre>/i);
          if (preMatch) {
            fullText = preMatch[1].trim();
          }
        }

        console.log(`   ✅ Fetched full text: ${fullText.length} characters`);
        return fullText;
      }
    } catch (error) {
      console.error(`   ❌ Error fetching text content:`, error);
    }
  }

  return null;
}

async function analyzeBill(bill: BillIdentifier) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`🔍 ANALYZING: ${bill.label}`);
  console.log(`${"=".repeat(80)}\n`);

  const { congress, billType, billNumber } = bill;

  // 1. Main bill details
  console.log(`\n1️⃣  MAIN BILL DETAILS`);
  const mainData = await fetchFromAPI(
    `/bill/${congress}/${billType}/${billNumber}`
  );

  if (mainData?.bill) {
    const b = mainData.bill;
    console.log(`   Title: ${b.title}`);
    console.log(`   Official Title: ${b.titles?.[0]?.title || "N/A"}`);
    console.log(`   Introduced: ${b.introducedDate}`);
    console.log(`   Latest Action: ${b.latestAction?.text || "N/A"}`);
    console.log(
      `   Latest Action Date: ${b.latestAction?.actionDate || "N/A"}`
    );
    console.log(`   Update Date: ${b.updateDate || "N/A"}`);
    console.log(
      `   Update Date (incl time): ${b.updateDateIncludingText || "N/A"}`
    );
    console.log(`   URL: ${b.url || "N/A"}`);

    // Sponsor info
    if (b.sponsors && b.sponsors.length > 0) {
      const sponsor = b.sponsors[0];
      console.log(
        `   Sponsor: ${sponsor.fullName} (${sponsor.party}-${sponsor.state})`
      );
      console.log(`   Sponsor BioguideID: ${sponsor.bioguideId}`);
    }

    // Policy area
    if (b.policyArea) {
      console.log(`   Policy Area: ${b.policyArea.name}`);
    }

    // Origin chamber
    if (b.originChamber) {
      console.log(`   Origin Chamber: ${b.originChamber}`);
    }

    // Constitutional authority
    if (b.constitutionalAuthorityStatementText) {
      console.log(
        `   Constitutional Authority: ${b.constitutionalAuthorityStatementText.substring(
          0,
          100
        )}...`
      );
    }
  }

  // 2. Actions
  console.log(`\n2️⃣  ACTIONS`);
  const actionsData = await fetchFromAPI(
    `/bill/${congress}/${billType}/${billNumber}/actions`
  );

  if (actionsData?.actions) {
    console.log(`   Found ${actionsData.actions.length} actions`);
    console.log(`   First 3 actions:`);
    actionsData.actions.slice(0, 3).forEach((action: any, i: number) => {
      console.log(`     ${i + 1}. [${action.actionDate}] ${action.text}`);
      if (action.actionCode) {
        console.log(`        Code: ${action.actionCode}`);
      }
    });
  }

  // 3. Amendments
  console.log(`\n3️⃣  AMENDMENTS`);
  const amendmentsData = await fetchFromAPI(
    `/bill/${congress}/${billType}/${billNumber}/amendments`
  );

  if (amendmentsData?.amendments) {
    console.log(`   Found ${amendmentsData.amendments.length} amendments`);
  }

  // 4. Committees
  console.log(`\n4️⃣  COMMITTEES`);
  const committeesData = await fetchFromAPI(
    `/bill/${congress}/${billType}/${billNumber}/committees`
  );

  if (committeesData?.committees) {
    console.log(`   Found ${committeesData.committees.length} committee(s)`);
    committeesData.committees.forEach((committee: any) => {
      console.log(`     - ${committee.name} (${committee.chamber})`);
      if (committee.activities) {
        committee.activities.forEach((activity: any) => {
          console.log(`       * ${activity.name}: ${activity.date || "N/A"}`);
        });
      }
    });
  }

  // 5. Cosponsors
  console.log(`\n5️⃣  COSPONSORS`);
  const cosponsorsData = await fetchFromAPI(
    `/bill/${congress}/${billType}/${billNumber}/cosponsors`
  );

  if (cosponsorsData?.cosponsors) {
    console.log(`   Found ${cosponsorsData.cosponsors.length} cosponsors`);
    console.log(`   First 5:`);
    cosponsorsData.cosponsors.slice(0, 5).forEach((cosponsor: any) => {
      console.log(
        `     - ${cosponsor.fullName} (${cosponsor.party}-${cosponsor.state}) - Sponsored: ${cosponsor.sponsorshipDate}`
      );
    });
  }

  // 6. Related Bills (THIS IS KEY FOR DUPLICATES!)
  console.log(`\n6️⃣  RELATED BILLS ⭐ (Companion bills, etc.)`);
  const relatedData = await fetchFromAPI(
    `/bill/${congress}/${billType}/${billNumber}/relatedbills`
  );

  if (relatedData?.relatedBills) {
    console.log(`   Found ${relatedData.relatedBills.length} related bills`);
    relatedData.relatedBills.forEach((related: any) => {
      console.log(`     - ${related.title}`);
      console.log(`       Type: ${related.type?.toUpperCase() || "N/A"}`);
      console.log(
        `       Bill: ${related.congress}/${related.type}${related.number}`
      );
      console.log(
        `       Relationship: ${
          related.relationshipDetails?.[0]?.type || "N/A"
        }`
      );
    });
  }

  // 7. Subjects
  console.log(`\n7️⃣  SUBJECTS / LEGISLATIVE TERMS`);
  const subjectsData = await fetchFromAPI(
    `/bill/${congress}/${billType}/${billNumber}/subjects`
  );

  if (subjectsData?.subjects?.legislativeSubjects) {
    console.log(
      `   Found ${subjectsData.subjects.legislativeSubjects.length} subjects`
    );
    subjectsData.subjects.legislativeSubjects
      .slice(0, 10)
      .forEach((subject: any) => {
        console.log(`     - ${subject.name}`);
      });
  }

  // 8. Official Summaries
  console.log(`\n8️⃣  OFFICIAL SUMMARIES`);
  const summariesData = await fetchFromAPI(
    `/bill/${congress}/${billType}/${billNumber}/summaries`
  );

  if (summariesData?.summaries) {
    console.log(
      `   Found ${summariesData.summaries.length} official summaries`
    );
    summariesData.summaries.forEach((summary: any, i: number) => {
      console.log(
        `     ${i + 1}. ${summary.versionCode} - ${summary.actionDesc} (${
          summary.updateDate
        })`
      );
      console.log(`        ${summary.text?.substring(0, 200)}...`);
    });
  }

  // 9. Full Text
  console.log(`\n9️⃣  FULL TEXT`);
  const fullText = await fetchBillText(congress, billType, billNumber);

  if (fullText) {
    console.log(`   Preview (first 500 chars):`);
    console.log(`   ${"-".repeat(70)}`);
    console.log(`   ${fullText.substring(0, 500)}`);
    console.log(`   ${"-".repeat(70)}`);
  }

  // 10. Titles
  console.log(`\n🔟 ALL TITLES`);
  const titlesData = await fetchFromAPI(
    `/bill/${congress}/${billType}/${billNumber}/titles`
  );

  if (titlesData?.titles) {
    console.log(`   Found ${titlesData.titles.length} title versions`);
    titlesData.titles.slice(0, 5).forEach((title: any) => {
      console.log(`     - [${title.titleType}] ${title.title}`);
    });
  }

  return {
    mainData,
    actionsData,
    amendmentsData,
    committeesData,
    cosponsorsData,
    relatedData,
    subjectsData,
    summariesData,
    fullText,
    titlesData,
  };
}

async function checkDatabaseForDuplicates() {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`📊 CHECKING DATABASE FOR DUPLICATES`);
  console.log(`${"=".repeat(80)}\n`);

  const veteranBills = await db.bill.findMany({
    where: {
      title: {
        contains: "Veteran Burial",
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      billType: true,
      billNumber: true,
      congress: true,
      title: true,
      introducedDate: true,
      fullText: true,
    },
  });

  console.log(
    `Found ${veteranBills.length} bills matching "Veteran Burial":\n`
  );

  veteranBills.forEach((bill) => {
    console.log(
      `   📄 ${bill.billType.toUpperCase()} ${bill.billNumber} (${
        bill.congress
      }th Congress)`
    );
    console.log(`      Title: ${bill.title}`);
    console.log(`      Introduced: ${bill.introducedDate.toISOString()}`);
    console.log(
      `      Full Text: ${
        bill.fullText ? `${bill.fullText.length} chars` : "❌ NONE"
      }`
    );
    console.log(`      DB ID: ${bill.id}\n`);
  });

  return veteranBills;
}

async function main() {
  console.log(`\n${"█".repeat(80)}`);
  console.log(`🔬 SINGLE BILL DEEP ANALYSIS TEST`);
  console.log(
    `   Testing: Veteran Burial Timeliness and Death Certificate Accountability Act`
  );
  console.log(`${"█".repeat(80)}`);

  // First, check what's in our database
  await checkDatabaseForDuplicates();

  // Analyze both bills from the API
  const results = [];

  for (const bill of TEST_BILLS) {
    const result = await analyzeBill(bill);
    results.push({ bill, data: result });

    // Pause between bills
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Summary comparison
  console.log(`\n${"=".repeat(80)}`);
  console.log(`📋 COMPARISON SUMMARY`);
  console.log(`${"=".repeat(80)}\n`);

  console.log(`HR 4398 vs S 2309:`);
  console.log(
    `   Both have full text available: ${
      results[0].data.fullText && results[1].data.fullText ? "✅" : "❌"
    }`
  );

  if (results[0].data.relatedData && results[1].data.relatedData) {
    console.log(`\n   🔗 Related Bills Analysis:`);
    console.log(
      `      HR 4398 has ${
        results[0].data.relatedData.relatedBills?.length || 0
      } related bills`
    );
    console.log(
      `      S 2309 has ${
        results[1].data.relatedData.relatedBills?.length || 0
      } related bills`
    );

    // Check if they reference each other
    const hr4398Related = results[0].data.relatedData.relatedBills || [];
    const s2309Related = results[1].data.relatedData.relatedBills || [];

    const hr4398ReferencesS2309 = hr4398Related.some(
      (r: any) => r.type === "s" && r.number === 2309
    );
    const s2309ReferencesHr4398 = s2309Related.some(
      (r: any) => r.type === "hr" && r.number === 4398
    );

    console.log(
      `      HR 4398 references S 2309: ${hr4398ReferencesS2309 ? "✅" : "❌"}`
    );
    console.log(
      `      S 2309 references HR 4398: ${s2309ReferencesHr4398 ? "✅" : "❌"}`
    );

    if (hr4398ReferencesS2309 || s2309ReferencesHr4398) {
      console.log(
        `\n      💡 These are companion bills! They should be linked in our database.`
      );
    }
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log(`✅ ANALYSIS COMPLETE`);
  console.log(`${"=".repeat(80)}\n`);

  console.log(`NEXT STEPS:`);
  console.log(
    `1. Review the API responses above to see what data we're missing`
  );
  console.log(
    `2. Update our schema to store: related bills, subjects, official summaries`
  );
  console.log(
    `3. Implement companion bill linking (detect via relatedBills API)`
  );
  console.log(`4. Update fetch scripts to use introducedDate (not updateDate)`);
  console.log(`5. Ensure full text is being fetched and stored correctly`);
}

main()
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
