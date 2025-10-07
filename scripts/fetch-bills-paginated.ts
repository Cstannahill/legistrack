// Paginated script to fetch ALL bills from Congress.gov
// Automatically handles the 250-result API limit
import { config } from "dotenv";
import { fetchLatestBills, fetchBillText } from "@/lib/api/congress";

// Load environment variables from .env file
config();
import { db } from "@/lib/db";
import { CURRENT_CONGRESS } from "@/lib/constants";
import { CompanionType } from "@prisma/client";

// Configurable parameters
const TOTAL_BILLS = parseInt(process.env.TOTAL_BILLS || "100000", 10);
const FETCH_TEXT = process.env.FETCH_TEXT === "true"; // Default false (fetch during summarization)
const FETCH_COMPANIONS = process.env.FETCH_COMPANIONS !== "false"; // Default true
const START_DATE = process.env.START_DATE;
const END_DATE = process.env.END_DATE;
const LOOKBACK_DAYS = process.env.LOOKBACK_DAYS;
const BATCH_SIZE = 250; // Congress.gov API maximum
// Optional: start at a specific page offset (page index, 0-based). Can be set via PAGE_OFFSET or OFFSET env var.
const PAGE_OFFSET = (() => {
  const raw = process.env.PAGE_OFFSET ?? process.env.OFFSET ?? "0";
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid PAGE_OFFSET/OFFSET provided: '${raw}'`);
  }
  return parsed;
})();

const formatCongressTimestamp = (value: Date) =>
  value.toISOString().replace(/\.\d{3}Z$/, "Z");

const parseCongressNumber = (value: string) => {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid congress number provided: '${value}'`);
  }
  return parsed;
};

const congressFromDate = (isoString: string) => {
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Unable to derive congress from invalid date '${isoString}'`
    );
  }
  const year = parsed.getUTCFullYear();
  if (year < 1789) {
    throw new Error(
      `Congress inference only supported for years 1789 and later (received ${year}).`
    );
  }
  return Math.floor((year - 1789) / 2) + 1;
};

const formatCongressLabel = (value: number) => {
  const lastTwo = value % 100;
  const last = value % 10;
  let suffix = "th";
  if (lastTwo < 11 || lastTwo > 13) {
    if (last === 1) suffix = "st";
    else if (last === 2) suffix = "nd";
    else if (last === 3) suffix = "rd";
  }
  return `${value}${suffix}`;
};

function resolveDateRange(): { fromDateTime?: string; toDateTime?: string } {
  const normalizeDate = (value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid date value provided: '${value}'`);
    }
    return formatCongressTimestamp(parsed);
  };

  if (LOOKBACK_DAYS) {
    const days = parseInt(LOOKBACK_DAYS, 10);
    if (Number.isNaN(days) || days <= 0) {
      throw new Error(
        `LOOKBACK_DAYS must be a positive integer. Received '${LOOKBACK_DAYS}'.`
      );
    }

    const toRaw = END_DATE
      ? normalizeDate(END_DATE)
      : formatCongressTimestamp(new Date());
    const toDate = new Date(toRaw);
    const fromDate = new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000);
    return {
      fromDateTime: formatCongressTimestamp(fromDate),
      toDateTime: toRaw,
    };
  }

  return {
    fromDateTime: START_DATE ? normalizeDate(START_DATE) : undefined,
    toDateTime: END_DATE ? normalizeDate(END_DATE) : undefined,
  };
}

const { fromDateTime, toDateTime } = resolveDateRange();

const CONGRESS_ENV =
  process.env.FETCH_CONGRESS ??
  process.env.CONGRESS ??
  process.env.CONGRESS_NUMBER;

let TARGET_CONGRESS = CURRENT_CONGRESS;
let congressNote: string | undefined;

const derivedFromCongress = fromDateTime
  ? congressFromDate(fromDateTime)
  : undefined;
const derivedToCongress = toDateTime ? congressFromDate(toDateTime) : undefined;

if (CONGRESS_ENV) {
  TARGET_CONGRESS = parseCongressNumber(CONGRESS_ENV);
  congressNote = `override via FETCH_CONGRESS (${TARGET_CONGRESS})`;
} else if (
  derivedFromCongress !== undefined &&
  derivedToCongress !== undefined &&
  derivedFromCongress !== derivedToCongress
) {
  TARGET_CONGRESS = derivedFromCongress;
  congressNote = `range spans ${formatCongressLabel(
    derivedFromCongress
  )} – ${formatCongressLabel(derivedToCongress)}; using start date congress`;
} else if (
  derivedFromCongress !== undefined &&
  derivedFromCongress !== CURRENT_CONGRESS
) {
  TARGET_CONGRESS = derivedFromCongress;
  congressNote = "auto-detected from start date";
} else if (
  derivedFromCongress === undefined &&
  derivedToCongress !== undefined &&
  derivedToCongress !== CURRENT_CONGRESS
) {
  TARGET_CONGRESS = derivedToCongress;
  congressNote = "auto-detected from end date";
}

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
      const companionTypeValue: CompanionType = relationshipType.includes(
        "Identical"
      )
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
            relationshipType: companionTypeValue,
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

async function fetchBatch(
  offset: number,
  limit: number,
  fetchText: boolean
): Promise<{
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  unchanged: number;
  textFetched: number;
  textNotAvailable: number;
  companionsLinked: number;
}> {
  const bills = await fetchLatestBills({
    congress: TARGET_CONGRESS,
    limit,
    offset,
    fromDateTime,
    toDateTime,
  });

  const fetchedCount = bills.length;

  if (fetchedCount === 0) {
    return {
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      unchanged: 0,
      textFetched: 0,
      textNotAvailable: 0,
      companionsLinked: 0,
    };
  }

  let created = 0;
  const updated = 0;
  let skipped = 0;
  let unchanged = 0;
  let textFetched = 0;
  let textNotAvailable = 0;
  let companionsLinked = 0;

  for (const billData of bills) {
    try {
      // Check if bill exists
      const existing = await db.bill.findFirst({
        where: {
          congress: TARGET_CONGRESS,
          billType: billData.type.toLowerCase(), // Normalize to lowercase
          billNumber: parseInt(billData.number), // Convert string to number
        },
      });

      const billIdentifier = `${billData.type.toUpperCase()} ${
        billData.number
      }`;

      if (existing) {
        console.log(`⏭️ Existing: ${billIdentifier} (unchanged)`);
        unchanged++;
        continue;
      }

      // Try introducedDate first, fall back to updateDate, then latestAction date
      const introducedDateStr =
        billData.introducedDate ||
        billData.updateDate ||
        billData.latestAction?.actionDate;

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

      // Attempt to fetch full text if enabled
      let fullText: string | null = null;
      let fullTextUrl: string | undefined = undefined;

      if (fetchText) {
        try {
          const textData = await fetchBillText(
            TARGET_CONGRESS,
            billData.type,
            parseInt(billData.number)
          );

          if (textData?.text) {
            fullText = textData.text;
            fullTextUrl = textData.url;
            textFetched++;
          } else if (textData?.url) {
            fullTextUrl = textData.url;
            textNotAvailable++;
          } else {
            textNotAvailable++;
          }

          // Add delay to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 300));
        } catch {
          console.log(`   ⚠️  Could not fetch text for ${billIdentifier}`);
          textNotAvailable++;
        }
      }

      const newBill = await db.bill.create({
        data: {
          billType: billData.type.toLowerCase(), // Normalize to lowercase
          billNumber: parseInt(billData.number), // Convert string to number
          congress: TARGET_CONGRESS,
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
      const billId = newBill.id;

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
        const companionsFound = await processCompanionBills(
          billId,
          billData.type,
          billData.number,
          TARGET_CONGRESS
        );
        if (companionsFound > 0) {
          console.log(`   🔗 Linked ${companionsFound} companion bill(s)`);
          companionsLinked += companionsFound;
        }

        // Add delay after companion detection
        if (companionsFound > 0) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
    } catch (error) {
      console.error(`✗ Error processing bill:`, error);
      skipped++;
    }
  }

  return {
    fetched: fetchedCount,
    created,
    updated,
    skipped,
    unchanged,
    textFetched,
    textNotAvailable,
    companionsLinked,
  };
}

async function main() {
  console.log(`\n🏛️  Fetching bills from Congress.gov (Paginated)`);
  const congressLabel = formatCongressLabel(TARGET_CONGRESS);
  console.log(
    `📊 Congress: ${congressLabel}${congressNote ? ` (${congressNote})` : ""}`
  );
  console.log(`📦 Total Bills to Fetch: ${TOTAL_BILLS}`);
  console.log(`📄 Fetch Full Text: ${FETCH_TEXT ? "Yes" : "No"}`);
  console.log(`🔗 Fetch Companions: ${FETCH_COMPANIONS ? "Yes" : "No"}`);
  console.log(`⚡ Batch Size: ${BATCH_SIZE} (API limit)`);
  if (fromDateTime || toDateTime) {
    console.log(
      `🗓️  Date Range: ${fromDateTime ?? "(open)"} → ${toDateTime ?? "(open)"}`
    );
  }
  if (
    derivedFromCongress !== undefined &&
    derivedToCongress !== undefined &&
    derivedFromCongress !== derivedToCongress
  ) {
    console.log(
      `⚠️  Date range spans multiple Congress sessions (${formatCongressLabel(
        derivedFromCongress
      )} → ${formatCongressLabel(
        derivedToCongress
      )}). Run once per session or set FETCH_CONGRESS to override.`
    );
  }
  console.log();

  const numBatches = Math.ceil(TOTAL_BILLS / BATCH_SIZE);
  console.log(`🔢 Will process ${numBatches} batch(es)`);
  if (PAGE_OFFSET > 0) {
    console.log(
      `➡️  Starting at page offset: ${PAGE_OFFSET} (skip ${
        PAGE_OFFSET * BATCH_SIZE
      } records)`
    );
  }
  console.log();

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalUnchanged = 0;
  let totalTextFetched = 0;
  let totalTextNotAvailable = 0;
  let totalCompanionsLinked = 0;
  let totalFetched = 0;

  try {
    // start from PAGE_OFFSET (page index), do not exceed numBatches
    if (PAGE_OFFSET >= numBatches) {
      console.log(
        `⚠️  PAGE_OFFSET (${PAGE_OFFSET}) >= total batches (${numBatches}). Nothing to do.`
      );
      return;
    }

    for (let batchNum = PAGE_OFFSET; batchNum < numBatches; batchNum++) {
      const offset = batchNum * BATCH_SIZE;
      const remainingBills = TOTAL_BILLS - offset;
      const batchLimit = Math.min(BATCH_SIZE, remainingBills);

      console.log(
        `\n📦 Batch ${
          batchNum + 1
        }/${numBatches} (offset: ${offset}, limit: ${batchLimit})`
      );
      console.log(`${"=".repeat(60)}\n`);

      const batchResults = await fetchBatch(offset, batchLimit, FETCH_TEXT);

      totalCreated += batchResults.created;
      totalUpdated += batchResults.updated;
      totalSkipped += batchResults.skipped;
      totalUnchanged += batchResults.unchanged;
      totalTextFetched += batchResults.textFetched;
      totalTextNotAvailable += batchResults.textNotAvailable;
      totalCompanionsLinked += batchResults.companionsLinked;
      totalFetched += batchResults.fetched;

      console.log(`\n📊 Batch ${batchNum + 1} Summary:`);
      console.log(`   📨 API Results: ${batchResults.fetched}`);
      console.log(`   ✓ Created: ${batchResults.created}`);
      console.log(`   ↻ Updated: ${batchResults.updated}`);
      console.log(`   ✗ Skipped: ${batchResults.skipped}`);
      console.log(`   ⏭️  Unchanged: ${batchResults.unchanged}`);
      if (FETCH_TEXT) {
        console.log(`   📄 Text Fetched: ${batchResults.textFetched}`);
        console.log(`   ⚠️  Text N/A: ${batchResults.textNotAvailable}`);
      }
      if (FETCH_COMPANIONS) {
        console.log(
          `   🔗 Companions Linked: ${batchResults.companionsLinked}`
        );
      }

      let continuePaging = true;

      if (batchResults.fetched === 0) {
        console.log(
          `   ⚠️  Congress.gov returned no results for this batch. Ending pagination early.`
        );
        continuePaging = false;
      } else if (batchResults.fetched < batchLimit) {
        console.log(
          `   ℹ️  Received ${batchResults.fetched} result(s), fewer than the requested ${batchLimit}. Assuming end of available data.`
        );
        continuePaging = false;
      }

      if (!continuePaging) {
        break;
      }

      // Add a delay between batches to be nice to the API
      if (batchNum < numBatches - 1) {
        console.log(`\n⏳ Waiting 2 seconds before next batch...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`\n📈 FINAL SUMMARY (All Batches):`);
    console.log(`   📨 Total API Results: ${totalFetched}`);
    console.log(`   ✓ Total Created: ${totalCreated}`);
    console.log(`   ↻ Total Updated: ${totalUpdated}`);
    console.log(`   ✗ Total Skipped: ${totalSkipped}`);
    console.log(`   ⏭️  Total Unchanged: ${totalUnchanged}`);
    console.log(
      `   📊 Total Processed: ${totalCreated + totalUpdated + totalSkipped}`
    );
    if (totalFetched === 0) {
      console.log(
        `   ⚠️  No results retrieved. Verify the date range and congress selection.`
      );
    }
    if (FETCH_TEXT) {
      console.log(`   📄 Total Text Fetched: ${totalTextFetched}`);
      console.log(`   ⚠️  Total Text N/A: ${totalTextNotAvailable}`);
    }
    if (FETCH_COMPANIONS) {
      console.log(`   🔗 Total Companions Linked: ${totalCompanionsLinked}`);
    }
    console.log();

    if (totalCreated > 0 && !FETCH_TEXT) {
      console.log(
        `💡 Tip: Run 'npm run fetch-bill-texts' to fetch full text for new bills!\n`
      );
    }

    if (totalCreated > 0 || totalTextFetched > 0) {
      console.log(
        `💡 Tip: Run 'npm run summarize-bills' to generate AI summaries!\n`
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
