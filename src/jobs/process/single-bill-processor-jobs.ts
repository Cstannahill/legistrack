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

interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

function validateLLMResponse(response: LLMResponse): ValidationResult {
  const errors: string[] = [];

  if (!response.summary || typeof response.summary !== "string") {
    errors.push("Missing or invalid 'summary' field");
  } else {
    const wordCount = response.summary.trim().split(/\s+/).length;
    if (wordCount < 20) {
      errors.push(`Summary too short: ${wordCount} words (minimum 20)`);
    }
  }

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

  if (response.impactAreas && response.impactAreas.length > 0) {
    response.impactAreas.forEach((area, idx) => {
      if (typeof area !== "string" || area.trim().length < 5) {
        errors.push(`impactArea[${idx}] is invalid or too short`);
      }
    });
  }

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

/**
 * Select a single bill/EO that needs processing using fallback logic -
 */
async function selectSingleItemToProcess() {
  const lookbackDate = subDays(new Date(), 3);

  const categories = await db.category.findMany({
    select: { id: true, name: true, slug: true, description: true },
  });

  // Helper functions to map DB rows
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

  // PRIMARY: Recent items WITH fullText (last 3 days)
  const recentBill = await db.bill.findFirst({
    where: {
      introducedDate: { gte: lookbackDate },
      fullText: { not: null },
      OR: [{ summaries: { none: {} } }, { categories: { none: {} } }],
    },
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

  if (recentBill) {
    return {
      categories: categories.map((c) => ({
        slug: c.slug,
        name: c.name,
        description: c.description ?? undefined,
      })),
      item: mapBillRowToItem(recentBill),
    };
  }

  const recentEO = await db.executiveOrder.findFirst({
    where: {
      signingDate: { gte: lookbackDate },
      fullText: { not: null },
      OR: [{ summaries: { none: {} } }, { categories: { none: {} } }],
    },
    orderBy: { signingDate: "desc" },
    select: { id: true, orderNumber: true, title: true, fullText: true },
  });

  if (recentEO) {
    return {
      categories: categories.map((c) => ({
        slug: c.slug,
        name: c.name,
        description: c.description ?? undefined,
      })),
      item: mapEOToItem(recentEO),
    };
  }

  // FALLBACK A: Any bill/EO with fullText but no summary (ignore date)
  const anyBill = await db.bill.findFirst({
    where: {
      fullText: { not: null },
      OR: [{ summaries: { none: {} } }, { categories: { none: {} } }],
    },
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

  if (anyBill) {
    return {
      categories: categories.map((c) => ({
        slug: c.slug,
        name: c.name,
        description: c.description ?? undefined,
      })),
      item: mapBillRowToItem(anyBill),
    };
  }

  const anyEO = await db.executiveOrder.findFirst({
    where: {
      fullText: { not: null },
      OR: [{ summaries: { none: {} } }, { categories: { none: {} } }],
    },
    orderBy: { signingDate: "desc" },
    select: { id: true, orderNumber: true, title: true, fullText: true },
  });

  if (anyEO) {
    return {
      categories: categories.map((c) => ({
        slug: c.slug,
        name: c.name,
        description: c.description ?? undefined,
      })),
      item: mapEOToItem(anyEO),
    };
  }

  // FALLBACK B: Widen lookback to 93 days (3 months)
  const widenedLookback = subDays(lookbackDate, 90);

  const widenedBill = await db.bill.findFirst({
    where: {
      introducedDate: { gte: widenedLookback },
      fullText: { not: null },
      OR: [{ summaries: { none: {} } }, { categories: { none: {} } }],
    },
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

  if (widenedBill) {
    return {
      categories: categories.map((c) => ({
        slug: c.slug,
        name: c.name,
        description: c.description ?? undefined,
      })),
      item: mapBillRowToItem(widenedBill),
    };
  }

  const widenedEO = await db.executiveOrder.findFirst({
    where: {
      signingDate: { gte: widenedLookback },
      fullText: { not: null },
      OR: [{ summaries: { none: {} } }, { categories: { none: {} } }],
    },
    orderBy: { signingDate: "desc" },
    select: { id: true, orderNumber: true, title: true, fullText: true },
  });

  if (widenedEO) {
    return {
      categories: categories.map((c) => ({
        slug: c.slug,
        name: c.name,
        description: c.description ?? undefined,
      })),
      item: mapEOToItem(widenedEO),
    };
  }

  // Nothing found
  return null;
}

/**
 * Process a single item with validation and error handling
 */
async function processSingleItem(
  item: any,
  categories: any[],
  apiKey: string,
  jobName: string
): Promise<{
  success: boolean;
  summaryId?: string;
  categoriesApplied: number;
  error?: string;
}> {
  if (!item.text) {
    return {
      success: false,
      categoriesApplied: 0,
      error: "No text available",
    };
  }

  try {
    // Call LLM with specific API key
    const response = await llm.summarizeAndCategorizeWithKey({
      title: item.title,
      text: item.text,
      categories,
      billId: item.type === "bill" ? item.id : undefined,
      executiveOrderId: item.type === "executive-order" ? item.id : undefined,
      apiKey,
    });

    // Validate response
    const validation = validateLLMResponse(response);
    if (!validation.isValid) {
      console.warn(
        `[${jobName}] LLM response validation failed for ${item.id}:`,
        validation.errors
      );
      return {
        success: false,
        categoriesApplied: 0,
        error: `Validation failed: ${validation.errors.join(", ")}`,
      };
    }

    // Create summary record
    const summaryRecord = await db.summary.create({
      data: {
        billId: item.type === "bill" ? item.id : null,
        executiveOrderId: item.type === "executive-order" ? item.id : null,
        summaryType: "STANDARD",
        content: response.summary,
        keyPoints: response.keyPoints || [],
        impactAreas: response.impactAreas || [],
        aiModel: response.aiModel,
        confidence: response.confidence,
        generatedAt: new Date(),
      },
    });

    // Connect categories (max 3)
    let categoriesApplied = 0;
    if (response.categories && response.categories.length > 0) {
      const validCategories = (response.categories as string[])
        .filter((slug: string) => slug in CATEGORY_MAP)
        .slice(0, 3);

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
          categoriesApplied = categoryIds.length;
        } catch (updErr) {
          console.error(
            `[${jobName}] Failed to connect categories for ${item.id}:`,
            updErr
          );
        }
      }
    }

    return {
      success: true,
      summaryId: summaryRecord.id,
      categoriesApplied,
    };
  } catch (error: any) {
    console.error(`[${jobName}] Error processing item ${item.id}:`, error);
    return {
      success: false,
      categoriesApplied: 0,
      error: String(error),
    };
  }
}

/**
 * Create a single bill processor job
 */
function createProcessorJob(jobNumber: 1 | 2 | 3, cronMinute: 0 | 20 | 40) {
  const jobId = `single-bill-processor-${jobNumber}`;
  const jobName = `Single Bill Processor ${jobNumber}`;
  const apiKeyEnvVar = `OPENROUTER_API_KEY_${jobNumber}`;

  return inngest.createFunction(
    {
      id: jobId,
      name: jobName,
      retries: 1,
    },
    { cron: `${cronMinute} */1 * * *` }, // Every hour at specified minute
    async ({ step }) => {
      const apiKey = process.env[apiKeyEnvVar];

      if (!apiKey) {
        throw new Error(`${apiKeyEnvVar} not configured`);
      }

      // Step 1: Select single item to process
      const selection = await step.run("select-item", async () => {
        return await selectSingleItemToProcess();
      });

      if (!selection) {
        return {
          message: "No items found to process",
          processed: false,
        };
      }

      const { item, categories } = selection;

      // Step 2: Enrich if needed (bills only)
      if (item.type === "bill" && !item.text) {
        await step.run("enrich-from-congress", async () => {
          const result = await enrichBillFromCongress(item.id);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return result;
        });

        // Refresh item data after enrichment
        const fresh = await db.bill.findUnique({
          where: { id: item.id },
          select: { fullText: true },
        });

        if (fresh?.fullText) {
          item.text = fresh.fullText;
        }
      }

      // Step 3: Process the item
      const result = await step.run("process-item", async () => {
        return await processSingleItem(item, categories, apiKey, jobName);
      });

      // Step 4: Log the job run
      await step.run("log-job-run", async () => {
        await db.jobRun.create({
          data: {
            jobName: jobId,
            status: result.success ? "COMPLETED" : "FAILED",
            itemsProcessed: result.success ? 1 : 0,
            itemsFailed: result.success ? 0 : 1,
            startedAt: new Date(),
            completedAt: new Date(),
            metadata: {
              itemId: item.id,
              itemType: item.type,
              summaryId: result.summaryId,
              categoriesApplied: result.categoriesApplied,
              error: result.error,
            },
          },
        });
      });

      return {
        message: result.success
          ? `Successfully processed ${item.type} ${item.id}`
          : `Failed to process ${item.type} ${item.id}`,
        itemId: item.id,
        itemType: item.type,
        success: result.success,
        summaryId: result.summaryId,
        categoriesApplied: result.categoriesApplied,
        error: result.error,
      };
    }
  );
}

// Export all three processor jobs
export const singleBillProcessor1 = createProcessorJob(1, 0); // Runs at :00
export const singleBillProcessor2 = createProcessorJob(2, 20); // Runs at :20
export const singleBillProcessor3 = createProcessorJob(3, 40); // Runs at :40
