import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";
import llm from "@/lib/llm";
import type { LLMResponse } from "@/lib/llm";
import { enrichBillFromCongress } from "@/lib/api/congress-detail";
import { subDays } from "date-fns";

// Hardcoded categories for efficient lookup
const CATEGORY_MAP = {
  healthcare: "cmg7fytbq0000vg6k18kspa4q",
  education: "cmg7fytbu0001vg6kwqkx49a9",
  "environment-climate": "cmg7fytbv0002vg6klvv5z7pf",
  "economy-taxes": "cmg7fytbw0003vg6ku8xjua16",
  "defense-security": "cmg7fytbx0004vg6k3xclztrn",
  immigration: "cmg7fytbx0005vg6ka1txz0x8",
  technology: "cmg7fytby0006vg6kwqi3ugel",
  "civil-rights": "cmg7fytbz0007vg6koauerj6j",
  infrastructure: "cmg7fytbz0008vg6kjb817t9j",
  "social-services": "cmg7fytc00009vg6kw0yk4oym",
  "labor-employment": "cmg7fytc1000avg6kgzgsmwvi",
  "agriculture-food": "cmg7fytc2000bvg6kzy7lii91",
  housing: "cmg7fytc3000cvg6kdsn3u9ka",
  "financial-services": "cmg7fytc3000dvg6k62refdjd",
  veterans: "cmg7fytc4000evg6kivpvt0hv",
} as const;

/**
 * Validate LLM response structure and content quality
 */
interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validate LLM response structure and content quality
 */
function validateLLMResponse(response: LLMResponse): ValidationResult {
  const errors: string[] = [];

  // Validate content
  if (!response.summary || typeof response.summary !== "string") {
    errors.push("Missing or invalid 'summary' field");
  } else {
    const wordCount = response.summary.trim().split(/\s+/).length;
    if (wordCount < 20) {
      errors.push(`Summary too short: ${wordCount} words (minimum 20)`);
    }
  }

  // Validate keyPoints
  if (!Array.isArray(response.keyPoints)) {
    errors.push("Missing or invalid 'keyPoints' array");
  } else if (response.keyPoints.length === 0) {
    errors.push("keyPoints array is empty");
  } else {
    response.keyPoints.forEach((point, idx) => {
      if (typeof point !== "string" || point.trim().length < 10) {
        errors.push(`keyPoint[${idx}] is invalid or too short`);
      }
    });
  }

  // Validate impactAreas
  if (response.impactAreas && response.impactAreas.length > 0) {
    response.impactAreas.forEach((area, idx) => {
      if (typeof area !== "string" || area.trim().length < 5) {
        errors.push(`impactArea[${idx}] is invalid or too short`);
      }
    });
  }

  // Validate categories
  if (response.categories && Array.isArray(response.categories)) {
    const invalidCategories = response.categories.filter(
      (slug) => !(slug in CATEGORY_MAP)
    );
    if (invalidCategories.length > 0) {
      errors.push(`Invalid category slugs: ${invalidCategories.join(", ")}`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export const batchSummarizeBillsJob = inngest.createFunction(
  {
    id: "batch-summarize-bills",
    name: "Batch Summarize Bills",
    retries: 2,
  },
  { cron: "0 */1 * * *" },
  async ({ step }) => {
    const lookbackDate = subDays(new Date(), 3);

    // Step 1: Select bills needing summarization
    const itemsToProcess = await step.run(
      "select-recent-unprocessed",
      async () => {
        const categories = await db.category.findMany({
          select: { id: true, name: true, slug: true, description: true },
        });

        const bills = await db.bill.findMany({
          where: {
            introducedDate: { gte: lookbackDate },
            OR: [{ summaries: { none: {} } }, { categories: { none: {} } }],
          },
          take: 50, // Reduced for API rate limiting
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

        const eos = await db.executiveOrder.findMany({
          where: {
            signingDate: { gte: lookbackDate },
            OR: [{ summaries: { none: {} } }, { categories: { none: {} } }],
          },
          take: 2,
          orderBy: { signingDate: "desc" },
          select: { id: true, orderNumber: true, title: true, fullText: true },
        });

        const billItems = bills.map((b) => ({
          id: b.id,
          type: "bill" as const,
          title: b.title,
          text: b.fullText,
          meta: {
            billType: b.billType,
            billNumber: b.billNumber,
            congress: b.congress,
          },
        }));

        const eoItems = eos.map((e) => ({
          id: e.id,
          type: "executive-order" as const,
          title: e.title,
          text: e.fullText,
          meta: { orderNumber: e.orderNumber },
        }));

        return {
          categories: categories.map((c) => ({
            slug: c.slug,
            name: c.name,
            description: c.description ?? undefined,
          })),
          items: [...billItems, ...eoItems],
        };
      }
    );

    if (itemsToProcess.items.length === 0) {
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

    // Step 2: Enrich bills with full text from Congress API
    const enrichmentResults = await step.run(
      "enrich-bills-from-congress",
      async () => {
        const results = [];

        for (const item of itemsToProcess.items) {
          if (item.type === "bill" && !item.text) {
            const result = await enrichBillFromCongress(item.id);
            results.push({ id: item.id, ...result });

            // Rate limiting
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }

        return results;
      }
    );

    // Step 3: Refresh items with enriched data
    const enrichedItems = await step.run("refresh-item-data", async () => {
      const refreshed = [];

      for (const item of itemsToProcess.items) {
        if (item.type === "bill") {
          const fresh = await db.bill.findUnique({
            where: { id: item.id },
            select: {
              fullText: true,
              summaries: { take: 1 },
              categories: { take: 1 },
            },
          });

          if (fresh) {
            refreshed.push({
              ...item,
              text: fresh.fullText,
              needsProcessing:
                fresh.fullText &&
                (!fresh.summaries || fresh.summaries.length === 0),
            });
          }
        } else {
          refreshed.push({ ...item, needsProcessing: !!item.text });
        }
      }

      return refreshed.filter((i) => i.needsProcessing);
    });

    // Step 4: Summarize with LLM
    const summarizationResults = await step.run(
      "summarize-with-llm",
      async () => {
        const results = [];
        const retryQueue = [];

        for (const item of enrichedItems) {
          if (!item.text) continue;

          try {
            const response = await llm.summarizeAndCategorize({
              title: item.title,
              text: item.text,
              categories: itemsToProcess.categories,
            });

            // Validate response
            const validation = validateLLMResponse(response);

            if (!validation.isValid) {
              console.warn(
                `LLM response validation failed for ${item.id}:`,
                validation.errors
              );
              retryQueue.push({
                item,
                errors: validation.errors,
              });
              continue;
            }

            // Create summary record
            const summaryRecord = await db.summary.create({
              data: {
                billId: item.type === "bill" ? item.id : null,
                impactAreas: response.impactAreas || [],
                executiveOrderId:
                  item.type === "executive-order" ? item.id : null,
                summaryType: "STANDARD",
                content: response.summary,
                keyPoints: response.keyPoints || [],

                aiModel: response.aiModel,
                confidence: response.confidence,
                generatedAt: new Date(),
              },
            });

            // Connect categories
            if (response.categories && response.categories.length > 0) {
              const validCategories = response.categories
                .filter((slug: string) => slug in CATEGORY_MAP)
                .slice(0, 3); // Max 3 categories

              const categoryIds = validCategories.map((slug: string) => ({
                id: CATEGORY_MAP[slug as keyof typeof CATEGORY_MAP],
              }));

              if (categoryIds.length > 0) {
                if (item.type === "bill") {
                  await db.bill.update({
                    where: { id: item.id },
                    data: { categories: { connect: categoryIds } },
                  });
                } else {
                  await db.executiveOrder.update({
                    where: { id: item.id },
                    data: { categories: { connect: categoryIds } },
                  });
                }
              }
            }

            results.push({
              id: item.id,
              type: item.type,
              summaryId: summaryRecord.id,
              categoriesApplied: response.categories?.length || 0,
            });
          } catch (error: any) {
            console.error(`Error processing item ${item.id}:`, error);

            if (error.code === "ENQUEUED") {
              console.log(`Item ${item.id} enqueued for later processing`);
            } else {
              retryQueue.push({
                item,
                errors: [String(error)],
              });
            }
          }
        }

        return { results, retryQueue };
      }
    );

    // Step 5: Log completion
    await step.run("log-batch-job", async () => {
      await db.jobRun.create({
        data: {
          jobName: "batch-summarize-bills",
          status: "COMPLETED",
          itemsProcessed: summarizationResults.results.length,
          itemsFailed: summarizationResults.retryQueue.length,
          startedAt: new Date(),
          completedAt: new Date(),
          metadata: {
            itemsFound: itemsToProcess.items.length,
            enriched: enrichmentResults.filter((r) => r.hasText).length,
            validated: summarizationResults.results.length,
            failed: summarizationResults.retryQueue.length,
          },
        },
      });
    });

    return {
      message: "Batch summarization completed",
      itemsFound: itemsToProcess.items.length,
      itemsEnriched: enrichmentResults.filter((r) => r.hasText).length,
      itemsProcessed: summarizationResults.results.length,
      itemsFailed: summarizationResults.retryQueue.length,
      results: summarizationResults.results,
    };
  }
);
