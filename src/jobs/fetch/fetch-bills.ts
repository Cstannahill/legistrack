// Background Job: Fetch Bills from Congress.gov
import { inngest } from "@/inngest/client";
import { fetchLatestBills } from "@/lib/api/congress";
import { db } from "@/lib/db";
import { CURRENT_CONGRESS } from "@/lib/constants";
import { BillStatus } from "@prisma/client";

export const fetchBillsJob = inngest.createFunction(
  { id: "fetch-bills", retries: 3 },
  { cron: "0 */6 * * *" }, // Every 6 hours
  async ({ step }) => {
    const jobStartTime = new Date();

    // Create job run record
    const jobRun = await step.run("create-job-run", async () => {
      return await db.jobRun.create({
        data: {
          jobName: "fetch-bills",
          status: "RUNNING",
        },
      });
    });

    try {
      // Step 1: Fetch latest bills from Congress.gov
      const bills = await step.run("fetch-bills-from-api", async () => {
        console.log(`Fetching bills for Congress ${CURRENT_CONGRESS}...`);
        return await fetchLatestBills({
          congress: CURRENT_CONGRESS,
          limit: 250,
          offset: 0,
        });
      });

      // Step 2: Process each bill
      const results = await step.run("process-bills", async () => {
        const processed = [];

        for (const billData of bills) {
          try {
            const normalizedBillType = billData.type.toLowerCase();
            const billNumber = parseInt(String(billData.number), 10);

            if (Number.isNaN(billNumber)) {
              console.warn(
                `Skipping bill with invalid number: ${billData.number}`
              );
              processed.push({ action: "skipped", reason: "invalid-number" });
              continue;
            }

            const introducedDateRaw =
              billData.introducedDate ||
              billData.updateDate ||
              billData.latestAction?.actionDate;
            const introducedDate = introducedDateRaw
              ? new Date(introducedDateRaw)
              : undefined;
            const validIntroducedDate =
              introducedDate && !Number.isNaN(introducedDate.getTime())
                ? introducedDate
                : undefined;

            const existing = await db.bill.findUnique({
              where: {
                congress_billType_billNumber: {
                  congress: billData.congress,
                  billType: normalizedBillType,
                  billNumber,
                },
              },
            });

            const latestStatus = mapCongressStatusToBillStatus(
              billData.latestAction?.text || ""
            );

            if (existing) {
              const statusDateRaw = billData.latestAction?.actionDate;
              const parsedStatusDate = statusDateRaw
                ? new Date(statusDateRaw)
                : undefined;
              const statusDate =
                parsedStatusDate && !Number.isNaN(parsedStatusDate.getTime())
                  ? parsedStatusDate
                  : validIntroducedDate ?? existing.statusDate;

              await db.bill.update({
                where: { id: existing.id },
                data: {
                  title: billData.title || existing.title,
                  officialTitle: billData.title || existing.officialTitle,
                  currentStatus: latestStatus,
                  statusDate,
                  introducedDate:
                    validIntroducedDate ?? existing.introducedDate,
                  sourceUrl: billData.url || existing.sourceUrl,
                  lastFetchedAt: new Date(),
                },
              });

              const action =
                existing.currentStatus !== latestStatus
                  ? "updated"
                  : "refreshed";

              processed.push({ id: existing.id, action });
            } else {
              const statusDateRaw = billData.latestAction?.actionDate;
              const parsedStatusDate = statusDateRaw
                ? new Date(statusDateRaw)
                : undefined;
              const statusDate =
                parsedStatusDate && !Number.isNaN(parsedStatusDate.getTime())
                  ? parsedStatusDate
                  : validIntroducedDate ?? new Date();

              const newBill = await db.bill.create({
                data: {
                  billType: normalizedBillType,
                  billNumber,
                  congress: billData.congress,
                  title: billData.title,
                  officialTitle: billData.title,
                  introducedDate: validIntroducedDate ?? new Date(),
                  currentStatus: latestStatus,
                  statusDate,
                  sourceUrl: billData.url,
                  lastFetchedAt: new Date(),
                },
              });
              processed.push({ id: newBill.id, action: "created" });
            }
          } catch (error) {
            console.error(`Error processing bill ${billData.number}:`, error);
            processed.push({ action: "failed", error: String(error) });
          }
        }

        return processed;
      });

      // Step 3: Trigger summarization for new bills
      await step.run("trigger-summarization", async () => {
        const newBills = results.filter(
          (r): r is { id: string; action: string } =>
            r.action === "created" && "id" in r
        );

        for (const { id } of newBills) {
          if (id) {
            await inngest.send({
              name: "bill/summarize",
              data: { billId: id },
            });
          }
        }

        console.log(`Triggered summarization for ${newBills.length} new bills`);
      });

      // Step 4: Update job run with success
      await step.run("complete-job-run", async () => {
        await db.jobRun.update({
          where: { id: jobRun.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            itemsProcessed: results.length,
            itemsFailed: results.filter((r) => r.action === "failed").length,
            metadata: {
              created: results.filter((r) => r.action === "created").length,
              updated: results.filter(
                (r) => r.action === "updated" || r.action === "refreshed"
              ).length,
              duration: Date.now() - jobStartTime.getTime(),
            },
          },
        });
      });

      return {
        success: true,
        billsProcessed: results.length,
        created: results.filter((r) => r.action === "created").length,
        updated: results.filter(
          (r) => r.action === "updated" || r.action === "refreshed"
        ).length,
      };
    } catch (error) {
      // Update job run with failure
      await step.run("fail-job-run", async () => {
        await db.jobRun.update({
          where: { id: jobRun.id },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            error: String(error),
          },
        });
      });

      throw error;
    }
  }
);

// Helper function to map Congress.gov action text to our BillStatus enum
function mapCongressStatusToBillStatus(actionText: string): BillStatus {
  const text = actionText.toLowerCase();

  if (text.includes("became public law") || text.includes("became law")) {
    return "BECAME_LAW";
  }
  if (text.includes("vetoed")) {
    return "VETOED";
  }
  if (
    text.includes("presented to president") ||
    text.includes("sent to president")
  ) {
    return "PRESENTED_TO_PRESIDENT";
  }
  if (text.includes("passed senate") || text.includes("senate passed")) {
    return "PASSED_SENATE";
  }
  if (text.includes("passed house") || text.includes("house passed")) {
    return "PASSED_HOUSE";
  }
  if (
    text.includes("reported by committee") ||
    text.includes("committee reported")
  ) {
    return "REPORTED_BY_COMMITTEE";
  }
  if (text.includes("referred to") || text.includes("committee")) {
    return "REFERRED_TO_COMMITTEE";
  }
  if (text.includes("failed")) {
    return "FAILED";
  }

  return "INTRODUCED";
}
