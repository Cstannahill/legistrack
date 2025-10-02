// Background Job: Fetch Executive Orders from Federal Register
import { inngest } from "@/inngest/client";
import { fetchExecutiveOrders } from "@/lib/api/federal-register";
import { db } from "@/lib/db";
import { ExecutiveOrderType } from "@prisma/client";

export const fetchExecutiveOrdersJob = inngest.createFunction(
  { id: "fetch-executive-orders", retries: 3 },
  { cron: "0 */12 * * *" }, // Every 12 hours
  async ({ step }) => {
    const jobStartTime = new Date();

    const jobRun = await step.run("create-job-run", async () => {
      return await db.jobRun.create({
        data: {
          jobName: "fetch-executive-orders",
          status: "RUNNING",
        },
      });
    });

    try {
      // Fetch executive orders from the past 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const orders = await step.run("fetch-orders-from-api", async () => {
        console.log("Fetching executive orders from Federal Register...");
        return await fetchExecutiveOrders({
          perPage: 100,
          conditions: {
            publicationDate: {
              gte: ninetyDaysAgo.toISOString().split("T")[0],
            },
            presidentialDocumentType: [
              "executive_order",
              "presidential_memorandum",
              "proclamation",
              "determination",
            ],
          },
        });
      });

      const results = await step.run("process-orders", async () => {
        const processed = [];

        for (const orderData of orders) {
          try {
            const orderNumber =
              orderData.executive_order_number ||
              parseInt(orderData.document_number.replace(/\D/g, ""), 10) ||
              0;

            // Check if executive order exists
            const existing = await db.executiveOrder.findUnique({
              where: { orderNumber },
            });

            const orderType = mapPresidentialDocType(
              orderData.presidential_document_type || "executive_order"
            );

            if (!existing && orderNumber > 0) {
              // Create new executive order
              const newOrder = await db.executiveOrder.create({
                data: {
                  orderNumber,
                  executiveOrderType: orderType,
                  title: orderData.title,
                  signingDate: new Date(
                    orderData.signing_date || orderData.publication_date
                  ),
                  publicationDate: new Date(orderData.publication_date),
                  federalRegisterUrl: orderData.html_url,
                  fullTextUrl: orderData.pdf_url,
                  presidentName: orderData.president?.name || "Unknown",
                  sourceUrl: orderData.html_url,
                },
              });
              processed.push({ id: newOrder.id, action: "created" });
            }
          } catch (error) {
            console.error(`Error processing executive order:`, error);
            processed.push({ action: "failed", error: String(error) });
          }
        }

        return processed;
      });

      // Trigger summarization for new orders
      await step.run("trigger-summarization", async () => {
        const newOrders = results.filter(
          (r): r is { id: string; action: string } =>
            r.action === "created" && "id" in r
        );

        for (const { id } of newOrders) {
          if (id) {
            await inngest.send({
              name: "executive-order/summarize",
              data: { executiveOrderId: id },
            });
          }
        }

        console.log(
          `Triggered summarization for ${newOrders.length} new executive orders`
        );
      });

      // Update job run with success
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
              duration: Date.now() - jobStartTime.getTime(),
            },
          },
        });
      });

      return {
        success: true,
        ordersProcessed: results.length,
        created: results.filter((r) => r.action === "created").length,
      };
    } catch (error) {
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

function mapPresidentialDocType(type: string): ExecutiveOrderType {
  switch (type.toLowerCase().replace(/[\s-]/g, "_")) {
    case "executive_order":
      return "EXECUTIVE_ORDER";
    case "presidential_memorandum":
      return "PRESIDENTIAL_MEMORANDUM";
    case "proclamation":
      return "PROCLAMATION";
    case "determination":
      return "DETERMINATION";
    default:
      return "EXECUTIVE_ORDER";
  }
}
