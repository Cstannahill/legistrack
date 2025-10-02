// Batch Summarization Job - Fan-out pattern
import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";

export const batchSummarizeBillsJob = inngest.createFunction(
  {
    id: "batch-summarize-bills",
    name: "Batch Summarize Bills",
    retries: 2,
  },
  { cron: "0 2 * * *" }, // Run daily at 2 AM
  async ({ step }) => {
    // Step 1: Find bills without summaries
    const billsToSummarize = await step.run(
      "find-bills-without-summaries",
      async () => {
        const bills = await db.bill.findMany({
          where: {
            summaries: {
              none: {}, // Bills with no summaries
            },
          },
          take: 100, // Process 100 bills per batch
          orderBy: { introducedDate: "desc" },
          select: {
            id: true,
            billType: true,
            billNumber: true,
            congress: true,
            title: true,
          },
        });

        return bills;
      }
    );

    if (billsToSummarize.length === 0) {
      return {
        message: "No bills to summarize",
        billsFound: 0,
        billsQueued: 0,
      };
    }

    // Step 2: Fan out - Send events to trigger individual summarization jobs
    const queuedJobs = await step.run("queue-summarization-jobs", async () => {
      const jobs = [];

      for (const bill of billsToSummarize) {
        // Send event to trigger the summarize-legislation job
        await inngest.send({
          name: "bill/summarize",
          data: {
            billId: bill.id,
            congress: bill.congress,
            billType: bill.billType,
            billNumber: bill.billNumber,
          },
        });

        jobs.push({
          billId: bill.id,
          identifier: `${bill.billType} ${bill.billNumber}`,
        });
      }

      return jobs;
    });

    // Step 3: Log the batch job run
    await step.run("log-batch-job", async () => {
      await db.jobRun.create({
        data: {
          jobName: "batch-summarize-bills",
          status: "SUCCESS",
          itemsProcessed: queuedJobs.length,
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });
    });

    return {
      message: "Batch summarization jobs queued",
      billsFound: billsToSummarize.length,
      billsQueued: queuedJobs.length,
      jobs: queuedJobs,
    };
  }
);
