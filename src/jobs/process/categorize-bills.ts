// Background Job: Auto-categorize Bills using AI
import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";
import { categorizeBill } from "@/lib/ai/categorizer";

export const categorizeBillJob = inngest.createFunction(
  { id: "categorize-bill" },
  { event: "bill/categorize" },
  async ({ event, step }) => {
    const { billId } = event.data;

    // Fetch bill with summary
    const bill = await step.run("fetch-bill", async () => {
      return await db.bill.findUnique({
        where: { id: billId },
        include: {
          summaries: {
            where: { summaryType: "STANDARD" },
            take: 1,
          },
        },
      });
    });

    if (!bill) {
      throw new Error(`Bill not found: ${billId}`);
    }

    // Get all available categories
    const categories = await step.run("fetch-categories", async () => {
      return await db.category.findMany({
        select: { id: true, slug: true, name: true, description: true },
      });
    });

    // Use AI to categorize
    const assignedCategories = await step.run("assign-categories", async () => {
      const summary = bill.summaries[0]?.content || bill.title;

      const categorySlugs = await categorizeBill({
        title: bill.title,
        summary,
        availableCategories: categories,
      });

      const categoryIds = categories
        .filter((cat) => categorySlugs.includes(cat.slug))
        .map((cat) => ({ id: cat.id }));

      if (categoryIds.length > 0) {
        await db.bill.update({
          where: { id: billId },
          data: {
            categories: {
              connect: categoryIds,
            },
          },
        });
      }

      return categorySlugs;
    });

    return {
      success: true,
      categories: assignedCategories,
    };
  }
);
