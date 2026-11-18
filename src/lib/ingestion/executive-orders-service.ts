import { db } from "@/lib/db";
import {
  determineLookupWindow,
  type IngestionLogger,
  type TextBackfillSummary,
} from "@/lib/ingestion/bills-service";
import {
  ensureOrderNumber,
  extractOrderNumber,
  fetchExecutiveOrderFullText,
  inferPresidentName,
  mapSubtypeToExecutiveOrderType,
  safeParseDate,
  type ExecutiveOrderType,
  type FederalRegisterClientOptions,
  type FederalRegisterDocument,
  type FederalRegisterLogger,
  type HydratedExecutiveOrder,
} from "@/lib/ingestion/federal-register-client";

export {
  determineLookupWindow,
  ensureOrderNumber,
  extractOrderNumber,
  inferPresidentName,
  mapSubtypeToExecutiveOrderType,
  safeParseDate,
};

export type {
  ExecutiveOrderType,
  FederalRegisterClientOptions,
  FederalRegisterDocument,
  FederalRegisterLogger,
  HydratedExecutiveOrder,
  TextBackfillSummary,
};

export interface PersistedExecutiveOrderResult {
  action: "created" | "updated" | "skipped" | "failed";
  identifier: string;
  executiveOrderId?: string;
  message?: string;
}

export interface PersistExecutiveOrderOptions {
  logger?: IngestionLogger;
}

const defaultLogger: IngestionLogger = {
  debug: () => undefined,
  info: (message, metadata) => console.info(message, metadata ?? ""),
  warn: (message, metadata) => console.warn(message, metadata ?? ""),
  error: (message, metadata) => console.error(message, metadata ?? ""),
};

type ExecutiveOrderPreservableField =
  | "fullText"
  | "fullTextUrl"
  | "presidentName"
  | "sourceUrl"
  | "federalRegisterUrl";

const PRESERVE_FIELDS: readonly ExecutiveOrderPreservableField[] = [
  "fullText",
  "fullTextUrl",
  "presidentName",
  "sourceUrl",
  "federalRegisterUrl",
];

interface ExecutiveOrderBaseData {
  orderNumber: number;
  executiveOrderType: ExecutiveOrderType;
  title: string;
  signingDate: Date;
  publicationDate: Date | null;
  fullText: string | null;
  fullTextUrl: string | null;
  federalRegisterUrl: string | null;
  presidentName: string;
  sourceUrl: string | null;
  lastFetchedAt: Date;
}

type ExistingExecutiveOrderRecord = {
  id: string;
  title: string;
  presidentName: string;
  fullText: string | null;
  fullTextUrl: string | null;
  sourceUrl: string | null;
  federalRegisterUrl: string | null;
};

function isEmptyString(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  );
}

/**
 * Formats a `Date` as `YYYY-MM-DD` for Federal Register query parameters.
 */
export function formatFederalRegisterDate(date: Date): string {
  return date.toISOString().split("T")[0]!;
}

/**
 * Formats a concise human-readable identifier for a Federal Register document.
 */
export function buildExecutiveOrderIdentifier(
  doc: Pick<FederalRegisterDocument, "document_number" | "title">
): string {
  return `${doc.document_number ?? "unknown"} - ${doc.title ?? "Untitled"}`;
}

function extractDocumentNumberFromUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  const documentsMatch = url.match(/\/documents\/\d{4}\/\d{2}\/\d{2}\/([^/?#]+)/i);
  if (documentsMatch?.[1]) {
    return documentsMatch[1];
  }
  const shortMatch = url.match(/\/d\/([^/?#]+)/i);
  return shortMatch?.[1];
}

function normalizeDateInput(value?: Date | string | null): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  return safeParseDate(value);
}

function buildBaseData(
  data: HydratedExecutiveOrder,
  orderNumber: number,
  executiveOrderType: ExecutiveOrderType,
  signingDate: Date,
  publicationDate: Date | null,
  fetchedAt: Date
): ExecutiveOrderBaseData {
  return {
    orderNumber,
    executiveOrderType,
    title: data.title?.trim() ? data.title : "",
    signingDate,
    publicationDate,
    fullText:
      data.fullText && data.fullText.trim().length > 0 ? data.fullText : null,
    fullTextUrl: data.fullTextUrl?.trim() ? data.fullTextUrl : null,
    federalRegisterUrl: data.federalRegisterUrl?.trim()
      ? data.federalRegisterUrl
      : null,
    presidentName: data.presidentName?.trim() ? data.presidentName : "",
    sourceUrl: data.sourceUrl?.trim() ? data.sourceUrl : null,
    lastFetchedAt: fetchedAt,
  };
}

function mergeWithExisting(
  baseData: ExecutiveOrderBaseData,
  existing: ExistingExecutiveOrderRecord | null,
  fallbackPresidentName: string
): ExecutiveOrderBaseData {
  const merged: ExecutiveOrderBaseData = { ...baseData };

  if (existing) {
    if (isEmptyString(merged.title) && !isEmptyString(existing.title)) {
      merged.title = existing.title;
    }

    for (const field of PRESERVE_FIELDS) {
      if (isEmptyString(merged[field]) && !isEmptyString(existing[field])) {
        merged[field] = existing[field] as never;
      }
    }

    if (
      merged.presidentName === "Unknown" &&
      !isEmptyString(existing.presidentName) &&
      existing.presidentName !== "Unknown"
    ) {
      merged.presidentName = existing.presidentName;
    }
  }

  if (isEmptyString(merged.title)) {
    merged.title = "Untitled Executive Order";
  }

  if (isEmptyString(merged.presidentName)) {
    merged.presidentName = fallbackPresidentName || "Unknown";
  }

  return merged;
}

/**
 * Persists a hydrated Federal Register presidential document via Prisma while
 * preserving existing non-empty fields on update.
 */
export async function persistExecutiveOrderPrisma(
  data: HydratedExecutiveOrder,
  options: PersistExecutiveOrderOptions = {}
): Promise<PersistedExecutiveOrderResult> {
  const logger = options.logger ?? defaultLogger;

  const orderNumber =
    typeof data.orderNumber === "number" &&
    Number.isFinite(data.orderNumber) &&
    data.orderNumber > 0
      ? Math.floor(data.orderNumber)
      : ensureOrderNumber({
          document_number: data.documentNumber,
          title: data.title,
          type: "Presidential Document",
        });

  const executiveOrderType = mapSubtypeToExecutiveOrderType(
    data.executiveOrderType
  );
  const identifier = `${orderNumber}-${data.title}`;

  try {
    const signingDate = normalizeDateInput(data.signingDate);
    if (!signingDate) {
      throw new Error(`Invalid signingDate for executive order ${identifier}`);
    }

    const publicationDate = normalizeDateInput(data.publicationDate) ?? null;
    const fetchedAt = new Date();
    const baseData = buildBaseData(
      data,
      orderNumber,
      executiveOrderType,
      signingDate,
      publicationDate,
      fetchedAt
    );

    const fallbackPresidentName = inferPresidentName(
      {
        document_number: data.documentNumber,
        title: data.title,
        type: "Presidential Document",
      },
      signingDate
    );

    const existing = await db.executiveOrder.findUnique({
      where: { orderNumber },
      select: {
        id: true,
        title: true,
        fullText: true,
        fullTextUrl: true,
        presidentName: true,
        sourceUrl: true,
        federalRegisterUrl: true,
      },
    });

    const mergedData = mergeWithExisting(
      baseData,
      existing,
      fallbackPresidentName
    );

    if (existing?.id) {
      const updated = await db.executiveOrder.update({
        where: { id: existing.id },
        data: mergedData,
        select: { id: true },
      });

      logger.info?.("Updated executive order", {
        identifier,
        executiveOrderId: updated.id,
      });

      return {
        action: "updated",
        identifier,
        executiveOrderId: updated.id,
      };
    }

    const created = await db.executiveOrder.create({
      data: mergedData,
      select: { id: true },
    });

    logger.info?.("Created executive order", {
      identifier,
      executiveOrderId: created.id,
    });

    return {
      action: "created",
      identifier,
      executiveOrderId: created.id,
    };
  } catch (error) {
    logger.error?.("Failed to persist executive order", {
      identifier,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      action: "failed",
      identifier,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Queries executive orders missing `fullText` and fetches/updates `fullText` and
 * `fullTextUrl` from the Federal Register API.
 */
export async function backfillMissingEoTexts(
  limit: number,
  options: FederalRegisterClientOptions = {}
): Promise<TextBackfillSummary> {
  const logger = options.logger ?? defaultLogger;

  if (!Number.isFinite(limit) || limit <= 0) {
    return {
      processed: 0,
      updated: 0,
      urlOnly: 0,
      failed: 0,
      updatedIds: [],
    };
  }

  const eos = await db.executiveOrder.findMany({
    where: { fullText: null },
    orderBy: { signingDate: "desc" },
    take: Math.floor(limit),
    select: {
      id: true,
      orderNumber: true,
      title: true,
      signingDate: true,
      federalRegisterUrl: true,
      sourceUrl: true,
      fullTextUrl: true,
    },
  });

  if (eos.length === 0) {
    logger.info?.("All executive orders already have full text");
    return {
      processed: 0,
      updated: 0,
      urlOnly: 0,
      failed: 0,
      updatedIds: [],
    };
  }

  let updated = 0;
  let urlOnly = 0;
  let failed = 0;
  const updatedIds: string[] = [];

  for (const eo of eos) {
    const documentNumber =
      extractDocumentNumberFromUrl(eo.federalRegisterUrl) ??
      extractDocumentNumberFromUrl(eo.sourceUrl);

    if (!documentNumber) {
      failed += 1;
      logger.warn?.("Could not extract Federal Register document number", {
        executiveOrderId: eo.id,
        orderNumber: eo.orderNumber,
      });
      continue;
    }

    try {
      const { content, url } = await fetchExecutiveOrderFullText(
        documentNumber,
        options
      );

      if (content && content.trim().length > 0) {
        await db.executiveOrder.update({
          where: { id: eo.id },
          data: {
            fullText: content,
            ...(url?.trim() ? { fullTextUrl: url } : {}),
          },
        });
        updated += 1;
        updatedIds.push(eo.id);
      } else if (url?.trim()) {
        await db.executiveOrder.update({
          where: { id: eo.id },
          data: {
            fullTextUrl: url,
          },
        });
        urlOnly += 1;
      } else {
        failed += 1;
        logger.warn?.("No full text or URL available for executive order", {
          executiveOrderId: eo.id,
          orderNumber: eo.orderNumber,
          documentNumber,
        });
      }
    } catch (error) {
      failed += 1;
      logger.warn?.("Failed to backfill executive order text", {
        executiveOrderId: eo.id,
        orderNumber: eo.orderNumber,
        documentNumber,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    processed: eos.length,
    updated,
    urlOnly,
    failed,
    updatedIds,
  };
}
