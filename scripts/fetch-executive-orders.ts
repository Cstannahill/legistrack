// Script to fetch Executive Orders from Federal Register API
// Documentation: https://www.federalregister.gov/developers/documentation/api/v1

import { PrismaClient, ExecutiveOrderType } from "@prisma/client";
import {
  fetchExecutiveOrders as fetchFromAPI,
  fetchExecutiveOrderDetails,
  fetchExecutiveOrderFullText,
  type FederalRegisterDocument,
} from "../src/lib/api/federal-register";

const db = new PrismaClient();

// Configuration from environment variables
const FETCH_TEXT = process.env.FETCH_TEXT === "true"; // Default false for speed
const LIMIT = parseInt(process.env.LIMIT || "10000");
const FETCH_ALL_TYPES = process.env.FETCH_ALL_TYPES === "true"; // Default false (only executive orders)
// Optional: start at a specific page offset (0-based). Set PAGE_OFFSET or OFFSET.
const PAGE_OFFSET = (() => {
  const raw = process.env.PAGE_OFFSET ?? process.env.OFFSET ?? "0";
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid PAGE_OFFSET/OFFSET provided: '${raw}'`);
  }
  return parsed;
})();

// Map Federal Register subtype to our enum
// Note: API detail view uses "subtype" field (e.g., "Executive Order")
function mapExecutiveOrderType(
  federalRegisterSubtype: string
): ExecutiveOrderType {
  const normalizedType = federalRegisterSubtype
    .toLowerCase()
    .replace(/\s+/g, "_");

  const typeMap: Record<string, ExecutiveOrderType> = {
    executive_order: "EXECUTIVE_ORDER",
    presidential_memorandum: "PRESIDENTIAL_MEMORANDUM",
    proclamation: "PROCLAMATION",
    determination: "DETERMINATION",
  };

  return typeMap[normalizedType] || "EXECUTIVE_ORDER";
}

// Extract executive order number from title or field
function extractOrderNumber(doc: FederalRegisterDocument): number | null {
  // Try executive_order_number field first (API returns as string)
  if (doc.executive_order_number) {
    const num =
      typeof doc.executive_order_number === "string"
        ? parseInt(doc.executive_order_number, 10)
        : doc.executive_order_number;
    if (!isNaN(num)) {
      return num;
    }
  }

  // Try presidential_document_number field (also returned as string)
  if (doc.presidential_document_number) {
    const num = parseInt(doc.presidential_document_number, 10);
    if (!isNaN(num)) {
      return num;
    }
  }

  // Try to extract from title (e.g., "Executive Order 14001")
  const match = doc.title.match(/(?:Executive Order|EO)\s+(\d+)/i);
  if (match) {
    return parseInt(match[1], 10);
  }

  // For other types, return null
  return null;
}

// Get the president's name (hardcode for now, or extract from metadata)
function getCurrentPresident(doc: FederalRegisterDocument): string {
  // The API doesn't always provide president info in the document
  // We can infer based on signing date or default to current president
  if (doc.president?.name) {
    return doc.president.name;
  }

  // For recent documents (2025+), assume current administration
  const signingDate = doc.signing_date
    ? new Date(doc.signing_date)
    : new Date(doc.publication_date);
  const year = signingDate.getFullYear();

  if (year >= 2025) {
    return "Donald J. Trump"; // 47th President (2025-present)
  } else if (year >= 2021) {
    return "Joseph R. Biden"; // 46th President (2021-2025)
  } else if (year >= 2017) {
    return "Donald J. Trump"; // 45th President (2017-2021)
  } else if (year >= 2009) {
    return "Barack Obama"; // 44th President (2009-2017)
  }

  return "Unknown";
}

async function main() {
  console.log(`🏛️  Fetching Executive Orders from Federal Register API`);
  console.log(`📊 Limit: ${LIMIT}`);
  console.log(`📄 Fetch Full Text: ${FETCH_TEXT ? "Yes" : "No"}`);
  console.log(
    `📋 Document Types: ${
      FETCH_ALL_TYPES ? "All Presidential Documents" : "Executive Orders Only"
    }`
  );
  console.log(`${"=".repeat(80)}\n`);

  try {
    // Build conditions for API call
    const conditions: {
      presidentialDocumentType?: string[];
    } = {};

    if (!FETCH_ALL_TYPES) {
      // Fetch only executive orders
      conditions.presidentialDocumentType = ["executive_order"];
    }
    // If FETCH_ALL_TYPES is true, we don't specify a type filter
    // This will fetch all presidential document types

    // Fetch documents from Federal Register
    console.log(`📥 Fetching ${LIMIT} documents...`);
    if (PAGE_OFFSET > 0) {
      console.log(
        `➡️  Starting at page offset: ${PAGE_OFFSET} (API page ${
          PAGE_OFFSET + 1
        })`
      );
    }
    const documents: FederalRegisterDocument[] = await fetchFromAPI({
      page: PAGE_OFFSET + 1,
      perPage: Math.min(LIMIT, 1000), // API max is 1000
      conditions,
    });

    console.log(`✅ Fetched ${documents.length} documents\n`);

    // Debug: Log first document structure
    if (documents.length > 0) {
      console.log("🔍 DEBUG - First document structure:");
      console.log(JSON.stringify(documents[0], null, 2).substring(0, 1000));
      console.log("\n");
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let textFetched = 0;
    let textNotAvailable = 0;

    for (const doc of documents) {
      try {
        // Fetch full document details to get complete data
        // (List view doesn't include signing_date, executive_order_number, subtype)
        console.log(`📄 Fetching details for ${doc.document_number}...`);
        const fullDoc = await fetchExecutiveOrderDetails(doc.document_number);

        // Debug: Log fields for first 3 documents
        if (created + updated + skipped < 3) {
          console.log(
            `🔍 Document ${fullDoc.document_number}: type="${fullDoc.type}", subtype="${fullDoc.subtype}", exec_order_number="${fullDoc.executive_order_number}"`
          );
        }

        // Skip if not a presidential document
        if (fullDoc.type !== "Presidential Document") {
          console.log(
            `⚠️  Skipping non-presidential document: ${fullDoc.document_number} (type: ${fullDoc.type})`
          );
          skipped++;
          continue;
        }

        // Extract order number from detail view
        const orderNumber = extractOrderNumber(fullDoc);

        // Use subtype from detail view (e.g., "Executive Order", "Presidential Memorandum")
        const docSubtype = fullDoc.subtype || "Executive Order";
        const mappedType = mapExecutiveOrderType(docSubtype);

        // Skip if it's an EO but missing order number
        if (!orderNumber && mappedType === "EXECUTIVE_ORDER") {
          console.log(
            `⚠️  Skipping EO without number: ${fullDoc.title.substring(
              0,
              60
            )}...`
          );
          skipped++;
          continue;
        }

        // Check if document exists
        let existing;
        if (orderNumber) {
          existing = await db.executiveOrder.findUnique({
            where: { orderNumber },
          });
        } else {
          // For non-EO types without order numbers, check by title and date
          existing = await db.executiveOrder.findFirst({
            where: {
              title: fullDoc.title,
              signingDate: new Date(
                fullDoc.signing_date || fullDoc.publication_date
              ),
            },
          });
        }

        const identifier = orderNumber
          ? `${docSubtype} ${orderNumber}`
          : `${docSubtype} (${fullDoc.document_number})`;

        // Parse dates (detail view has signing_date!)
        const signingDate = new Date(
          fullDoc.signing_date || fullDoc.publication_date
        );
        const publicationDate = fullDoc.publication_date
          ? new Date(fullDoc.publication_date)
          : null;

        if (isNaN(signingDate.getTime())) {
          console.log(`⚠️  Skipping ${identifier}: invalid date`);
          skipped++;
          continue;
        }

        // Fetch full text if enabled
        let fullText: string | null = null;
        let fullTextUrl: string | null = null;

        if (FETCH_TEXT) {
          try {
            fullText = await fetchExecutiveOrderFullText(
              fullDoc.document_number
            );
            fullTextUrl =
              fullDoc.body_html_url || fullDoc.full_text_xml_url || null;

            if (fullText) {
              textFetched++;
            } else {
              textNotAvailable++;
            }

            // Rate limiting
            await new Promise((resolve) => setTimeout(resolve, 300));
          } catch (error) {
            console.log(
              `   ⚠️  Could not fetch text for ${identifier}: ${error}`
            );
            textNotAvailable++;
          }
        }

        // Generate a unique order number for non-EO types
        let finalOrderNumber = orderNumber;
        if (!finalOrderNumber) {
          // Use hash of document_number as order number
          const hash = fullDoc.document_number
            .split("")
            .reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0);
          finalOrderNumber = 100000 + (hash % 900000); // Range: 100000-999999
        }

        const presidentName = getCurrentPresident(fullDoc);

        if (!existing) {
          // Create new executive order
          await db.executiveOrder.create({
            data: {
              orderNumber: finalOrderNumber,
              executiveOrderType: mappedType,
              title: fullDoc.title,
              signingDate,
              publicationDate,
              fullText,
              fullTextUrl,
              federalRegisterUrl: fullDoc.html_url,
              presidentName,
              sourceUrl: fullDoc.html_url,
              lastFetchedAt: new Date(),
            },
          });

          const textIndicator = fullText
            ? ` 📄 [${Math.round(fullText.length / 1000)}KB]`
            : fullTextUrl
            ? " 🔗"
            : "";
          const dateStr = signingDate.toISOString().split("T")[0];
          console.log(
            `✓ Created: ${identifier}${textIndicator} [${dateStr}] - ${fullDoc.title.substring(
              0,
              50
            )}...`
          );
          created++;
        } else {
          // Update existing if text is missing
          let needsUpdate = false;
          const updateData: {
            lastFetchedAt: Date;
            fullText?: string | null;
            fullTextUrl?: string | null;
            presidentName?: string;
          } = {
            lastFetchedAt: new Date(),
          };

          // Update full text if we fetched it and it's missing
          if (fullText && !existing.fullText) {
            updateData.fullText = fullText;
            updateData.fullTextUrl = fullTextUrl;
            needsUpdate = true;
          }

          // Update president name if missing
          if (!existing.presidentName || existing.presidentName === "Unknown") {
            updateData.presidentName = presidentName;
            needsUpdate = true;
          }

          if (needsUpdate) {
            await db.executiveOrder.update({
              where: { id: existing.id },
              data: updateData,
            });
            console.log(`↻ Updated: ${identifier}`);
            updated++;
          } else {
            console.log(`○ Exists: ${identifier}`);
            skipped++;
          }
        }
      } catch (error) {
        console.error(`❌ Error processing document:`, error);
        skipped++;
      }
    }

    console.log(`\n${"=".repeat(80)}`);
    console.log(`📊 SUMMARY`);
    console.log(`${"=".repeat(80)}`);
    console.log(`✓ Created: ${created}`);
    console.log(`↻ Updated: ${updated}`);
    console.log(`○ Skipped: ${skipped}`);
    console.log(`📄 Text Fetched: ${textFetched}`);
    console.log(`⚠️  Text N/A: ${textNotAvailable}`);
    console.log(`📊 Total Processed: ${created + updated + skipped}`);
    console.log(`${"=".repeat(80)}\n`);

    if (!FETCH_TEXT && created > 0) {
      console.log(
        `💡 Tip: Run with FETCH_TEXT=true to fetch full text for executive orders`
      );
    }
  } catch (error) {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

main();
