// Background Job: Summarize Bills using AI
import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";
import { generateSummary } from "@/lib/ai/summarizer";
import { fetchBillText } from "@/lib/api/congress";

export const summarizeBillJob = inngest.createFunction(
  {
    id: "summarize-bill",
    retries: 2,
    concurrency: { limit: 5 }, // Limit concurrent AI calls to avoid rate limits
  },
  { event: "bill/summarize" },
  async ({ event, step }) => {
    const { billId } = event.data;

    // Step 1: Fetch bill details
    const bill = await step.run("fetch-bill", async () => {
      return await db.bill.findUnique({
        where: { id: billId },
        include: {
          sponsor: true,
          actions: {
            orderBy: { actionDate: "desc" },
            take: 10,
          },
        },
      });
    });

    if (!bill) {
      throw new Error(`Bill not found: ${billId}`);
    }

    // Step 2: Fetch full text if not already stored
    const fullText = await step.run("fetch-full-text", async () => {
      if (bill.fullText) return bill.fullText;

      // Try to fetch from Congress.gov API
      const textData = await fetchBillText(
        bill.congress,
        bill.billType,
        bill.billNumber
      );

      if (textData?.url) {
        const response = await fetch(textData.url);
        const text = await response.text();

        // Update bill with full text
        await db.bill.update({
          where: { id: billId },
          data: { fullText: text, fullTextUrl: textData.url },
        });

        return text;
      }

      // If no full text available, use title
      return bill.title;
    });

    // Step 3: Generate different summary types
    const summaries = await step.run("generate-summaries", async () => {
      const summaryTypes = ["BRIEF", "STANDARD", "ELI5"] as const;
      const results = [];

      for (const type of summaryTypes) {
        try {
          const summary = await generateSummary({
            title: bill.title,
            fullText: fullText,
            billType: bill.billType,
            sponsor: bill.sponsor?.fullName,
            status: bill.currentStatus,
            summaryType: type,
          });

          const created = await db.summary.create({
            data: {
              billId: bill.id,
              summaryType: type,
              content: summary.content,
              keyPoints: summary.keyPoints,
              impactAreas: summary.impactAreas,
              aiModel: summary.model,
              confidence: summary.confidence,
            },
          });

          results.push(created);
        } catch (error) {
          console.error(`Failed to generate ${type} summary:`, error);
        }
      }

      return results;
    });

    // Step 4: Auto-categorize the bill
    await step.run("categorize-bill", async () => {
      await inngest.send({
        name: "bill/categorize",
        data: { billId: bill.id },
      });
    });

    return {
      success: true,
      summariesCreated: summaries.length,
    };
  }
);
