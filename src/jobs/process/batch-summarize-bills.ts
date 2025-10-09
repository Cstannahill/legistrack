// Batch Summarization Job - Fan-out pattern
import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";
import llm from "@/lib/llm";
import { subDays } from "date-fns";

export const batchSummarizeBillsJob = inngest.createFunction(
  {
    id: "batch-summarize-bills",
    name: "Batch Summarize Bills",
    retries: 2,
  },
  { cron: "0 */4 * * *" }, // Run every 4 hours
  async ({ step }) => {
    // Step 1: Determine lookback window and select items from both tables
    const lookbackDate = subDays(new Date(), 3);

    const itemsToProcess = await step.run(
      "select-recent-unprocessed",
      async () => {
        // Fetch categories once for LLM prompt (slug,name,description)
        const categories = await db.category.findMany({
          select: { id: true, name: true, slug: true, description: true },
        });

        // Bills introduced within lookback that are missing summary OR categories
        const bills = await db.bill.findMany({
          where: {
            introducedDate: { gte: lookbackDate },
            OR: [{ summaries: { none: {} } }, { categories: { none: {} } }],
          },
          take: 200,
          orderBy: { introducedDate: "desc" },
          select: {
            id: true,
            billType: true,
            billNumber: true,
            congress: true,
            title: true,
            fullText: true,
          },
        });

        // Executive Orders signed within lookback that are missing summary OR categories
        const eos = await db.executiveOrder.findMany({
          where: {
            signingDate: { gte: lookbackDate },
            OR: [{ summaries: { none: {} } }, { categories: { none: {} } }],
          },
          take: 200,
          orderBy: { signingDate: "desc" },
          select: { id: true, orderNumber: true, title: true, fullText: true },
        });

        // Normalize items to unified shape
        const billItems = bills.map((b) => ({
          id: b.id,
          type: "bill",
          title: b.title,
          text: b.fullText ?? null,
          meta: {
            billType: b.billType,
            billNumber: b.billNumber,
            congress: b.congress,
          },
        }));

        const eoItems = eos.map((e) => ({
          id: e.id,
          type: "executive-order",
          title: e.title,
          text: e.fullText ?? null,
          meta: { orderNumber: e.orderNumber },
        }));

        return { categories, items: [...billItems, ...eoItems] };
      }
    );

    const categories = itemsToProcess.categories.map((c) => ({
      slug: c.slug,
      name: c.name,
      description: c.description ?? undefined,
    }));
    const items = itemsToProcess.items;

    if (items.length === 0) {
      // Log jobRun with zero items
      await step.run("log-batch-job", async () => {
        await db.jobRun.create({
          data: {
            jobName: "batch-summarize-bills",
            status: "COMPLETED",
            itemsProcessed: 0,
            startedAt: new Date(),
            completedAt: new Date(),
          },
        });
      });

      return { message: "No recent items to summarize", itemsFound: 0 };
    }

    // Step 2: Now that selection is complete, call LLM for each item that still needs work
    const results: { id: string; type: string; summaryId: string }[] = [];

    for (const it of items) {
      // Double-check DB state before making LLM call
      if (it.type === "bill") {
        const fresh = await db.bill.findUnique({
          where: { id: it.id },
          select: { summaries: { take: 1 }, categories: { take: 1 } },
        });
        if (
          fresh?.summaries &&
          fresh.summaries.length > 0 &&
          fresh?.categories &&
          fresh.categories.length > 0
        ) {
          continue; // already summarized and categorized
        }
      } else {
        const fresh = await db.executiveOrder.findUnique({
          where: { id: it.id },
          select: { summaries: { take: 1 }, categories: { take: 1 } },
        });
        if (
          fresh?.summaries &&
          fresh.summaries.length > 0 &&
          fresh?.categories &&
          fresh.categories.length > 0
        ) {
          continue;
        }
      }

      try {
        const response = await llm.summarizeAndCategorize({
          title: it.title,
          text: it.text ?? null,
          categories,
        });

        // Persist summary
        const summaryRecord = await db.summary.create({
          data: {
            billId: it.type === "bill" ? it.id : null,
            executiveOrderId: it.type === "executive-order" ? it.id : null,
            summaryType: "STANDARD",
            content: response.summary,
            keyPoints: response.keyPoints,
            aiModel: response.aiModel,
            confidence: response.confidence ?? undefined,
            generatedAt: new Date(),
          },
        });

        // Connect categories by slug if provided
        if (response.categories && response.categories.length > 0) {
          // map slugs to ids
          const matched = await db.category.findMany({
            where: { slug: { in: response.categories } },
            select: { id: true, slug: true },
          });
          const ids = matched.map((m) => ({ id: m.id }));

          if (ids.length > 0) {
            if (it.type === "bill") {
              await db.bill.update({
                where: { id: it.id },
                data: { categories: { connect: ids } },
              });
            } else {
              await db.executiveOrder.update({
                where: { id: it.id },
                data: { categories: { connect: ids } },
              });
            }
          }
        }

        results.push({ id: it.id, type: it.type, summaryId: summaryRecord.id });
      } catch (error) {
        console.error(`Error processing item ${it.id}:`, error);
      }
    }

    // Step 3: Log the batch job run
    await step.run("log-batch-job", async () => {
      await db.jobRun.create({
        data: {
          jobName: "batch-summarize-bills",
          status: "COMPLETED",
          itemsProcessed: results.length,
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });
    });

    return {
      message: "Batch summarization completed",
      itemsFound: items.length,
      itemsProcessed: results.length,
      results,
    };
  }
);
