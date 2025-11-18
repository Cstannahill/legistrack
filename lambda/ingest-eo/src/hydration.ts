import { createLogger, Logger } from "./logger.js";
import {
  fetchExecutiveOrderDetails,
  fetchExecutiveOrderFullText,
} from "./federalRegisterApi.js";
import type {
  FederalRegisterDocument,
  HydratedExecutiveOrder,
} from "./types.js";
import {
  ensureOrderNumber,
  inferPresidentName,
  mapSubtypeToExecutiveOrderType,
  safeParseDate,
} from "./utils.js";

export interface HydrationOptions {
  document: FederalRegisterDocument;
  fetchFullText: boolean;
  logger?: Logger;
}

export async function hydrateExecutiveOrder(
  options: HydrationOptions
): Promise<HydratedExecutiveOrder> {
  const logger = options.logger ?? createLogger({ context: "hydrate-eo" });
  const baseDoc = options.document;
  const detail = await fetchExecutiveOrderDetails(baseDoc.document_number);

  const signingDate =
    safeParseDate(detail.signing_date) ??
    safeParseDate(baseDoc.signing_date) ??
    safeParseDate(detail.publication_date) ??
    safeParseDate(baseDoc.publication_date);

  if (!signingDate) {
    throw new Error(
      `Missing signing date for document ${baseDoc.document_number}`
    );
  }

  const publicationDate =
    safeParseDate(detail.publication_date) ??
    safeParseDate(baseDoc.publication_date);

  const orderNumber = ensureOrderNumber(detail, baseDoc.document_number);
  const executiveOrderType = mapSubtypeToExecutiveOrderType(
    detail.subtype ?? detail.presidential_document_type ?? baseDoc.subtype
  );
  const presidentName = inferPresidentName(detail, signingDate);

  let fullTextContent: string | null = null;
  let fullTextUrl =
    detail.body_html_url ??
    detail.raw_text_url ??
    detail.full_text_xml_url ??
    baseDoc.body_html_url ??
    baseDoc.raw_text_url ??
    null;

  if (options.fetchFullText) {
    try {
      const { content, url } = await fetchExecutiveOrderFullText(
        detail.document_number
      );
      if (content) {
        fullTextContent = content;
      }
      if (url) {
        fullTextUrl = url;
      }
    } catch (error) {
      logger.warn("Failed to download executive order full text", {
        documentNumber: detail.document_number,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    documentNumber: detail.document_number,
    orderNumber,
    executiveOrderType,
    title: detail.title ?? baseDoc.title ?? "Untitled Executive Order",
    signingDate,
    publicationDate,
    federalRegisterUrl: detail.html_url ?? baseDoc.html_url,
    sourceUrl: detail.html_url ?? baseDoc.html_url,
    presidentName,
    summary: detail.abstract ?? baseDoc.abstract,
    fullText: fullTextContent,
    fullTextUrl,
  };
}
