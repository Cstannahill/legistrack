// Background Job: Summarize Bills using AI
import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";
import {
  summarizeBillStandard,
  type SummaryProvider,
} from "@/workflows/summarize-bill-standard";

export const summarizeBillJob = inngest.createFunction(
  {
    id: "summarize-bill",
    retries: 2,
    concurrency: { limit: 5 }, // Limit concurrent AI calls to avoid rate limits
  },
  { event: "bill/summarize" },
  async ({ event, step }) => {
    const { billId } = event.data;

    // Step 1: Ensure bill exists for logging context
    const bill = await step.run("fetch-bill", async () => {
      return await db.bill.findUnique({
        where: { id: billId },
        select: {
          id: true,
          billType: true,
          billNumber: true,
          title: true,
        },
      });
    });

    if (!bill) {
      throw new Error(`Bill not found: ${billId}`);
    }

    const providerEnv =
      (process.env.INGEST_AI_MODEL as SummaryProvider | undefined) ??
      (process.env.AI_MODEL as SummaryProvider | undefined);
    // Step 2: Generate STANDARD summary using shared workflow
    const summaryResult = await step.run(
      "generate-standard-summary",
      async () => {
        return await summarizeBillStandard({
          billId,
          aiModel: providerEnv,
          logger: (message) =>
            console.log(
              `[summarize-bill:${bill.billType.toUpperCase()} ${
                bill.billNumber
              }] ${message}`
            ),
        });
      }
    );

    if (summaryResult.status === "error") {
      throw new Error(
        `Failed to summarize bill ${billId}: ${summaryResult.reason}`
      );
    }

    if (summaryResult.status === "skipped") {
      return {
        success: false,
        status: "skipped",
        reason: summaryResult.reason,
      } as const;
    }

    // Step 3: Auto-categorize the bill now that STANDARD summary exists
    await step.run("categorize-bill", async () => {
      await inngest.send({
        name: "bill/categorize",
        data: { billId: bill.id },
      });
    });

    return {
      success: true,
      summaryId: summaryResult.summaryId,
      model: summaryResult.model,
      durationMs: summaryResult.durationMs,
    };
  }
);
