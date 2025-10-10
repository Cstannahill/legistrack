import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";
import llm from "@/lib/llm";
import { enqueuePayload } from "@/lib/llmRedis";
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

        // Helper: map DB rows into the item shape we expect downstream
        function mapBillRowToItem(b: any) {
          return {
            id: b.id,
            type: "bill" as const,
            title: b.title,
            text: b.fullText,
            meta: {
              billType: b.billType,
              billNumber: b.billNumber,
              congress: b.congress,
            },
          };
        }
        function mapEOToItem(e: any) {
          return {
            id: e.id,
            type: "executive-order" as const,
            title: e.title,
            text: e.fullText,
            meta: { orderNumber: e.orderNumber },
          };
        }

        // Primary attempt: recent items WITH fullText (so we can process immediately)
        const primaryLookbackBills = await db.bill.findMany({
          where: {
            introducedDate: { gte: lookbackDate },
            AND: [
              { fullText: { not: null } }, // require full text present
              {
                OR: [{ summaries: { none: {} } }, { categories: { none: {} } }],
              },
            ],
          },
          take: 50,
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

        const primaryLookbackEOs = await db.executiveOrder.findMany({
          where: {
            signingDate: { gte: lookbackDate },
            AND: [
              { fullText: { not: null } },
              {
                OR: [{ summaries: { none: {} } }, { categories: { none: {} } }],
              },
            ],
          },
          take: 50,
          orderBy: { signingDate: "desc" },
          select: { id: true, orderNumber: true, title: true, fullText: true },
        });

        const billItems = primaryLookbackBills.map(mapBillRowToItem);
        const eoItems = primaryLookbackEOs.map(mapEOToItem);

        // If we already have up to 50 items (combined), return those
        let combined = [...billItems, ...eoItems].slice(0, 50);
        if (combined.length > 0) {
          return {
            categories: categories.map((c) => ({
              slug: c.slug,
              name: c.name,
              description: c.description ?? undefined,
            })),
            items: combined,
          };
        }

        // FALLBACK A: Look for ANY bill/EO in DB that has fullText and no summary (ignore date window)
        // This finds older items that were enriched previously but never summarized.
        const fallbackAnyBills = await db.bill.findMany({
          where: {
            fullText: { not: null },
            OR: [{ summaries: { none: {} } }, { categories: { none: {} } }],
          },
          take: 50,
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

        const fallbackAnyEOs = await db.executiveOrder.findMany({
          where: {
            fullText: { not: null },
            OR: [{ summaries: { none: {} } }, { categories: { none: {} } }],
          },
          take: 50,
          orderBy: { signingDate: "desc" },
          select: { id: true, orderNumber: true, title: true, fullText: true },
        });

        combined = [
          ...fallbackAnyBills.map(mapBillRowToItem),
          ...fallbackAnyEOs.map(mapEOToItem),
        ].slice(0, 50);

        if (combined.length > 0) {
          return {
            categories: categories.map((c) => ({
              slug: c.slug,
              name: c.name,
              description: c.description ?? undefined,
            })),
            items: combined,
          };
        }

        // FALLBACK B: widen the lookback (e.g., another 90 days back) and try again
        const widenedLookback = subDays(lookbackDate, 90);

        const widenedBills = await db.bill.findMany({
          where: {
            introducedDate: { gte: widenedLookback },
            AND: [
              { fullText: { not: null } },
              {
                OR: [{ summaries: { none: {} } }, { categories: { none: {} } }],
              },
            ],
          },
          take: 50,
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

        const widenedEOs = await db.executiveOrder.findMany({
          where: {
            signingDate: { gte: widenedLookback },
            AND: [
              { fullText: { not: null } },
              {
                OR: [{ summaries: { none: {} } }, { categories: { none: {} } }],
              },
            ],
          },
          take: 50,
          orderBy: { signingDate: "desc" },
          select: { id: true, orderNumber: true, title: true, fullText: true },
        });

        combined = [
          ...widenedBills.map(mapBillRowToItem),
          ...widenedEOs.map(mapEOToItem),
        ].slice(0, 50);

        // Final: return whatever we found (may be empty)
        return {
          categories: categories.map((c) => ({
            slug: c.slug,
            name: c.name,
            description: c.description ?? undefined,
          })),
          items: combined,
        };
      }
    );

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
        const results: Array<{
          id: string;
          type: string;
          summaryId?: string | null;
          categoriesApplied: number;
        }> = [];
        const retryQueue: Array<{ item: any; errors: string[] }> = [];

        // helper: per-call timeout
        function timeoutPromise<T>(
          ms: number,
          p: Promise<T>,
          label = "timeout"
        ) {
          return new Promise<T>((resolve, reject) => {
            const t = setTimeout(() => {
              reject(new Error(`${label} after ${ms}ms`));
            }, ms);
            p.then((v) => {
              clearTimeout(t);
              resolve(v);
            }).catch((e) => {
              clearTimeout(t);
              reject(e);
            });
          });
        }

        // helper: small sleep to avoid bursts
        const sleepMs = 300; // adjust as desired
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

        for (const item of enrichedItems) {
          if (!item.text) continue;

          try {
            // Per-item: attempt the LLM call with a timeout so one slow call doesn't stall everything
            const response = await timeoutPromise(
              45_000, // 45s timeout per LLM call (tune if needed)
              llm.summarizeAndCategorize({
                title: item.title,
                text: item.text,
                categories: itemsToProcess.categories,
                billId: item.type === "bill" ? item.id : undefined,
                executiveOrderId:
                  item.type === "executive-order" ? item.id : undefined,
              }),
              "llm.summarizeAndCategorize"
            );

            // Validate response structure and content quality
            const validation = validateLLMResponse(response);

            if (!validation.isValid) {
              console.warn(
                `LLM response validation failed for ${item.id}:`,
                validation.errors
              );

              // If validation fails, enqueue for later re-run (so human can inspect or re-run)
              retryQueue.push({
                item,
                errors: validation.errors,
              });

              // Optionally enqueue payload for later automated processing
              try {
                await enqueuePayload?.({
                  title: item.title,
                  text: item.text,
                  categories: itemsToProcess.categories,
                  billId: item.type === "bill" ? item.id : null,
                  executiveOrderId:
                    item.type === "executive-order" ? item.id : null,
                });
              } catch (e) {
                console.error(
                  "Failed to enqueue invalid/failed item",
                  item.id,
                  e
                );
              }

              // wait a bit before next item
              await sleep(sleepMs);
              continue;
            }

            // Create summary record immediately
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

            // Connect categories (limit to known ones and to max 3)
            if (response.categories && response.categories.length > 0) {
              const validCategories = (response.categories as string[])
                .filter((slug: string) => slug in CATEGORY_MAP)
                .slice(0, 3); // Max 3 categories

              const categoryIds = validCategories.map((slug: string) => ({
                id: CATEGORY_MAP[slug as keyof typeof CATEGORY_MAP],
              }));

              if (categoryIds.length > 0) {
                try {
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
                } catch (updErr) {
                  console.error(
                    `Failed to connect categories for ${item.id}:`,
                    updErr
                  );
                }
              }
            }

            // Push to results
            results.push({
              id: item.id,
              type: item.type,
              summaryId: summaryRecord.id,
              categoriesApplied: response.categories?.length || 0,
            });

            // small cooldown before next request to reduce rate-limit chances
            await sleep(sleepMs);
          } catch (error: any) {
            console.error(`Error processing item ${item.id}:`, error);

            // If the LLM itself returned an ENQUEUED indicator, treat as enqueued
            if (error?.code === "ENQUEUED") {
              console.log(`Item ${item.id} enqueued for later processing`);
              retryQueue.push({
                item,
                errors: [String(error)],
              });
              continue;
            }

            // If timeout or network/LLM error, enqueue item for later processing
            try {
              await enqueuePayload?.({
                title: item.title,
                text: item.text,
                categories: itemsToProcess.categories,
                billId: item.type === "bill" ? item.id : null,
                executiveOrderId:
                  item.type === "executive-order" ? item.id : null,
              });
              retryQueue.push({
                item,
                errors: [String(error)],
              });
              console.log(`Enqueued ${item.id} after error: ${String(error)}`);
            } catch (enqueueErr) {
              // If enqueue failed, add to retryQueue with the error
              console.error(
                "Failed to enqueue after error for item",
                item.id,
                enqueueErr
              );
              retryQueue.push({
                item,
                errors: [String(error), String(enqueueErr)],
              });
            }
          }
        } // end for loop

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
