import { config } from "dotenv";
config();

import { db } from "@/lib/db";
import { fetchBillDetails } from "@/lib/api/congress";

type OutputRecord = {
  id: string;
  billType: string;
  billNumber: number;
  congress: number;
  introducedDate: string | null;
  error: string | null;
};

async function main() {
  console.log("🔎 Starting introducedDate updater...");

  // Fetch all bills with minimal fields
  const allBills = await db.bill.findMany({
    select: { id: true, billType: true, billNumber: true, congress: true },
  });

  console.log(`Found ${allBills.length} bills to process`);

  const BATCH_SIZE = 100;
  const updatedBills: OutputRecord[] = [];
  const log: string[] = [];

  for (let i = 0; i < allBills.length; i += BATCH_SIZE) {
    const batch = allBills.slice(i, i + BATCH_SIZE);

    // Announce batch purpose and minimal identifiers
    console.log(
      `\n🔁 Processing batch ${Math.floor(i / BATCH_SIZE) + 1} — ${
        batch.length
      } bills. Sample: ${batch
        .slice(0, 3)
        .map((b) => `${b.congress}/${b.billType}/${b.billNumber}`)
        .join(", ")}`
    );

    // Process batch sequentially to avoid aggressive parallel API usage
    for (const bill of batch) {
      const record: OutputRecord = {
        id: bill.id,
        billType: bill.billType,
        billNumber: bill.billNumber,
        congress: bill.congress,
        introducedDate: null,
        error: null,
      };

      try {
        const normalizedType = bill.billType.toLowerCase();

        // Call external API
        const details = await fetchBillDetails(
          bill.congress,
          normalizedType,
          bill.billNumber
        );

        if (!details) {
          record.introducedDate = null;
          record.error = "404 Not Found";
          log.push(`Record ${bill.id} failed: 404 Not Found.`);
          updatedBills.push(record);
          console.log(`   ❌ ${bill.id}: 404 Not Found`);
          continue;
        }

        const introducedRaw = details.introducedDate;
        if (introducedRaw) {
          // Normalize to YYYY-MM-DD
          const parsed = new Date(introducedRaw);
          if (!Number.isNaN(parsed.getTime())) {
            const yyyy = parsed.getFullYear();
            const mm = String(parsed.getMonth() + 1).padStart(2, "0");
            const dd = String(parsed.getDate()).padStart(2, "0");
            const isoDate = `${yyyy}-${mm}-${dd}`;

            // Update DB only if value present and different
            try {
              await db.bill.update({
                where: { id: bill.id },
                data: { introducedDate: new Date(parsed.toISOString()) },
              });

              record.introducedDate = isoDate;
              record.error = null;
              log.push(`Record ${bill.id} updated successfully.`);
              console.log(`   ✅ ${bill.id}: introducedDate set to ${isoDate}`);
            } catch (dbErr) {
              record.introducedDate = isoDate;
              record.error = `DB update error: ${String(dbErr)}`;
              log.push(`Record ${bill.id} failed: DB update error.`);
              console.error(`   ❌ ${bill.id}: DB update error`, dbErr);
            }
          } else {
            record.introducedDate = null;
            record.error = "Invalid date format from API";
            log.push(`Record ${bill.id} failed: Invalid date format.`);
            console.log(`   ❌ ${bill.id}: invalid introducedDate from API`);
          }
        } else {
          record.introducedDate = null;
          record.error = "introducedDate missing in API response";
          log.push(`Record ${bill.id} failed: introducedDate missing.`);
          console.log(`   ⚠️ ${bill.id}: introducedDate missing`);
        }
      } catch (err: unknown) {
        // Capture HTTP errors and others
        const message =
          typeof err === "object" && err !== null && "message" in err
            ? String((err as { message?: unknown }).message)
            : String(err);
        record.introducedDate = null;
        record.error = message;
        log.push(`Record ${bill.id} failed: ${message}`);
        console.error(`   ❌ ${bill.id}: ${message}`);
      }

      updatedBills.push(record);

      // Minimal pacing to be polite to API
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // All done: output JSON to stdout
  const output = { updatedBills, log };

  // Print compact JSON
  console.log("\n--- Result JSON ---");
  console.log(JSON.stringify(output, null, 2));

  // Disconnect DB
  await db.$disconnect();
}

main()
  .then(() => {
    console.log("\n✅ Completed introducedDate updates.");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Fatal error:", err);
    await db.$disconnect();
    process.exit(1);
  });
