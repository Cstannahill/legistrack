// Background Job: Fetch Executive Orders from Federal Register
import { inngest } from "@/inngest/client";
import {
  fetchExecutiveOrders,
  fetchExecutiveOrderDetails,
  fetchExecutiveOrderFullText,
  type FederalRegisterDocument,
  normalizeConditionsForFederalRegister,
} from "@/lib/api/federal-register";
import { db } from "@/lib/db";
import { ExecutiveOrderType } from "@prisma/client";

const FETCH_TEXT = "true";
const LIMIT = parseInt(process.env.LIMIT || "100", 10);
const PER_PAGE = 40; // Federal Register API max per-page (adjust if your helper enforces other limits)
const PAGE_OFFSET = (() => {
  const raw = process.env.PAGE_OFFSET ?? process.env.OFFSET ?? "0";
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid PAGE_OFFSET/OFFSET provided: '${raw}'`);
  }
  return parsed;
})();

// Map Federal Register subtype to our enum
function mapPresidentialDocType(type: string | undefined): ExecutiveOrderType {
  const normalized = (type || "executive_order")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  switch (normalized) {
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

// Extract EO number from various fields
function extractOrderNumber(doc: FederalRegisterDocument): number | null {
  if (doc.executive_order_number) {
    const num =
      typeof doc.executive_order_number === "string"
        ? parseInt(doc.executive_order_number, 10)
        : (doc.executive_order_number as unknown as number);
    if (!Number.isNaN(num)) return num;
  }

  if (doc.presidential_document_number) {
    const num = parseInt(String(doc.presidential_document_number), 10);
    if (!Number.isNaN(num)) return num;
  }

  // Try title heuristics
  const match = (doc.title || "").match(/(?:Executive Order|EO)\s+(\d{3,})/i);
  if (match) {
    const num = parseInt(match[1], 10);
    if (!Number.isNaN(num)) return num;
  }

  // If document_number has digits, try extracting (fallback)
  if (doc.document_number) {
    const digits = String(doc.document_number).replace(/\D/g, "");
    if (digits.length > 0) {
      const num = parseInt(digits, 10);
      if (!Number.isNaN(num)) return num;
    }
  }

  return null;
}

function inferPresident(doc: FederalRegisterDocument): string {
  if (doc.president?.name) return doc.president.name;

  const dateStr = doc.signing_date || doc.publication_date;
  if (!dateStr) return "Unknown";

  const year = new Date(dateStr).getFullYear();
  // Your earlier mapping; update if inaccurate for future years
  if (year >= 2025) return "Donald J. Trump";
  if (year >= 2021) return "Joseph R. Biden";
  if (year >= 2017) return "Donald J. Trump";
  if (year >= 2009) return "Barack Obama";
  return "Unknown";
}

// Helper to create a fallback numeric ID for non-EOs without numbers
function synthesizeOrderNumber(documentNumber: string): number {
  // deterministic simple hash -> 100000..999999
  const hash =
    Array.from(documentNumber || "").reduce(
      (acc, ch) => acc + ch.charCodeAt(0),
      0
    ) >>> 0;
  return 100000 + (hash % 900000);
}

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
      // Build search conditions (past 30 days by default)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const conditionsRaw = {
        publication_date: { gte: thirtyDaysAgo.toISOString().split("T")[0] },
        presidential_document_type: [
          "executive_order",
          "presidential_memorandum",
          "proclamation",
          "determination",
        ],
      };
      const conditions = normalizeConditionsForFederalRegister(conditionsRaw);
      // We'll page until we've fetched LIMIT items or exhausted results
      const resultsAggregate: Array<{
        action: string;
        id?: string;
        error?: string;
      }> = [];
      let fetchedCount = 0;
      let page = PAGE_OFFSET + 1;
      let keepGoing = true;

      while (keepGoing && fetchedCount < LIMIT) {
        // compute perPage for the final partial page
        const remaining = LIMIT - fetchedCount;
        const perPage = Math.min(PER_PAGE, remaining);

        const pageDocs: FederalRegisterDocument[] = await step.run(
          `fetch-page-${page}`,
          async () => {
            console.log(
              `Fetching page ${page} (perPage=${perPage}) from Federal Register...`
            );
            return await fetchExecutiveOrders({
              page,
              perPage,
              conditions,
            });
          }
        );

        if (!pageDocs || pageDocs.length === 0) {
          // no more docs
          keepGoing = false;
          break;
        }

        for (const listDoc of pageDocs) {
          if (fetchedCount >= LIMIT) {
            keepGoing = false;
            break;
          }

          fetchedCount++;

          try {
            // Fetch detail view to obtain subtype, signing_date, etc.
            const fullDoc = await step.run(
              `fetch-details-${listDoc.document_number}`,
              async () => {
                return await fetchExecutiveOrderDetails(
                  listDoc.document_number
                );
              }
            );

            if (!fullDoc) {
              resultsAggregate.push({
                action: "failed",
                error: "Missing fullDoc",
              });
              continue;
            }

            if (fullDoc.type !== "Presidential Document") {
              // skip non-presidential docs
              resultsAggregate.push({ action: "skipped" });
              continue;
            }

            // Determine subtype and mapped type
            const docSubtype =
              fullDoc.subtype ||
              fullDoc.presidential_document_type ||
              "executive_order";
            const mappedType = mapPresidentialDocType(docSubtype);

            // Extract order number
            let orderNumber = extractOrderNumber(fullDoc);
            if (!orderNumber && mappedType === "EXECUTIVE_ORDER") {
              // skip EO if it truly has no number
              console.log(
                `Skipping EO without number: ${fullDoc.title?.slice(0, 80)}...`
              );
              resultsAggregate.push({ action: "skipped" });
              continue;
            }

            // If still missing, synthesize a deterministic number for non-EOs
            if (!orderNumber) {
              orderNumber = synthesizeOrderNumber(fullDoc.document_number);
            }

            // Parse dates
            const signingDateRaw =
              fullDoc.signing_date || fullDoc.publication_date;
            const signingDate = signingDateRaw
              ? new Date(signingDateRaw)
              : null;
            const publicationDate = fullDoc.publication_date
              ? new Date(fullDoc.publication_date)
              : null;

            if (!signingDate || Number.isNaN(signingDate.getTime())) {
              console.log(
                `Invalid or missing signing date for ${fullDoc.document_number}. Skipping.`
              );
              resultsAggregate.push({ action: "skipped" });
              continue;
            }

            // Check existing (by orderNumber)
            const existing = await db.executiveOrder.findUnique({
              where: { orderNumber },
            });

            // Optionally fetch full text
            let fullText: string | null = null;
            let fullTextUrl: string | null = null;

            if (FETCH_TEXT) {
              try {
                fullText = await fetchExecutiveOrderFullText(
                  fullDoc.document_number
                );
                fullTextUrl =
                  fullDoc.body_html_url ||
                  fullDoc.full_text_xml_url ||
                  fullDoc.pdf_url ||
                  null;
                // be kind to the API
                await new Promise((r) => setTimeout(r, 1500));
              } catch (err) {
                console.warn(
                  `Failed to fetch full text for ${fullDoc.document_number}:`,
                  err
                );
              }
            }

            const presidentName = inferPresident(fullDoc);

            if (!existing) {
              // create
              const created = await db.executiveOrder.create({
                data: {
                  orderNumber,
                  executiveOrderType: mappedType,
                  title: fullDoc.title,
                  signingDate,
                  publicationDate,
                  fullText: fullText ?? null,
                  fullTextUrl,
                  federalRegisterUrl: fullDoc.html_url,
                  presidentName,
                  sourceUrl: fullDoc.html_url,
                  lastFetchedAt: new Date(),
                },
              });

              resultsAggregate.push({ action: "created", id: created.id });
              console.log(
                `✓ Created EO ${orderNumber} - ${fullDoc.title?.slice(
                  0,
                  80
                )}...`
              );
            } else {
              // update if necessary (e.g., fill in missing text or president name)
              const updateData: any = { lastFetchedAt: new Date() };
              let needsUpdate = false;

              if (fullText && !existing.fullText) {
                updateData.fullText = fullText;
                updateData.fullTextUrl = fullTextUrl;
                needsUpdate = true;
              }

              if (
                (!existing.presidentName ||
                  existing.presidentName === "Unknown") &&
                presidentName &&
                presidentName !== "Unknown"
              ) {
                updateData.presidentName = presidentName;
                needsUpdate = true;
              }

              if (needsUpdate) {
                await db.executiveOrder.update({
                  where: { id: existing.id },
                  data: updateData,
                });
                resultsAggregate.push({ action: "updated", id: existing.id });
                console.log(`↻ Updated EO ${orderNumber}`);
              } else {
                resultsAggregate.push({ action: "exists", id: existing.id });
                console.log(`○ Exists EO ${orderNumber}`);
              }
            }
          } catch (err) {
            console.error("Error processing document:", err);
            resultsAggregate.push({ action: "failed", error: String(err) });
          }
        } // end for pageDocs

        // If the number of docs returned is less than perPage, we're at the end
        if (pageDocs.length < perPage) {
          keepGoing = false;
        } else {
          page += 1;
        }
      } // end while paging

      // Trigger summarization for newly created orders
      await step.run("trigger-summarization", async () => {
        const createdItems = resultsAggregate.filter(
          (r) => r.action === "created" && r.id
        );
        for (const { id } of createdItems) {
          if (id) {
            try {
              await inngest.send({
                name: "executive-order/summarize",
                data: { executiveOrderId: id },
              });
            } catch (err) {
              console.warn(
                `Failed to send summarization event for ${id}:`,
                err
              );
            }
          }
        }
        console.log(
          `Triggered summarization for ${createdItems.length} new executive orders`
        );
      });

      // Update jobRun with success
      await step.run("complete-job-run", async () => {
        const itemsProcessed = resultsAggregate.length;
        const itemsFailed = resultsAggregate.filter(
          (r) => r.action === "failed"
        ).length;
        const created = resultsAggregate.filter(
          (r) => r.action === "created"
        ).length;

        await db.jobRun.update({
          where: { id: jobRun.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            itemsProcessed,
            itemsFailed,
            metadata: {
              created,
              durationMs: Date.now() - jobStartTime.getTime(),
            },
          },
        });
      });

      return {
        success: true,
        ordersProcessed: resultsAggregate.length,
        created: resultsAggregate.filter((r) => r.action === "created").length,
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

      // rethrow so Inngest will apply retries
      throw error;
    }
  }
);
