import type { ExecutiveOrderType, FederalRegisterDocument } from "./types.js";

export interface LookupWindow {
  from: Date;
  to: Date;
}

export function determineLookupWindow(
  lookbackDays: number,
  startDate?: string,
  endDate?: string
): LookupWindow {
  const now = new Date();
  const effectiveEnd = endDate ? new Date(endDate) : now;
  const effectiveStart = startDate
    ? new Date(startDate)
    : new Date(effectiveEnd.getTime() - Math.max(1, lookbackDays) * 86_400_000);

  if (Number.isNaN(effectiveStart.getTime())) {
    throw new Error(`Invalid start date provided: ${startDate}`);
  }
  if (Number.isNaN(effectiveEnd.getTime())) {
    throw new Error(`Invalid end date provided: ${endDate}`);
  }
  if (effectiveStart > effectiveEnd) {
    throw new Error(
      `Start date ${effectiveStart.toISOString()} cannot be after end date ${effectiveEnd.toISOString()}`
    );
  }

  return { from: effectiveStart, to: effectiveEnd };
}

export function formatFederalRegisterDate(date: Date): string {
  return date.toISOString().split("T")[0]!;
}

export function safeParseDate(input?: string | null): Date | undefined {
  if (!input) return undefined;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function mapSubtypeToExecutiveOrderType(
  subtype?: string | null
): ExecutiveOrderType {
  const normalized = (subtype ?? "").toLowerCase().replace(/\s+/g, "_");
  switch (normalized) {
    case "presidential_memorandum":
      return "PRESIDENTIAL_MEMORANDUM";
    case "proclamation":
      return "PROCLAMATION";
    case "determination":
      return "DETERMINATION";
    case "executive_order":
    default:
      return "EXECUTIVE_ORDER";
  }
}

export function extractOrderNumber(
  doc: FederalRegisterDocument
): number | null {
  const tryNumber = (value?: string | number | null): number | null => {
    if (value === undefined || value === null) return null;
    const parsed =
      typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  };

  return (
    tryNumber(doc.executive_order_number) ??
    tryNumber(doc.presidential_document_number) ??
    tryNumber(doc.proclamation_number) ??
    extractFromTitle(doc.title) ??
    null
  );
}

function extractFromTitle(title?: string): number | null {
  if (!title) return null;
  const match = title.match(/(?:Executive Order|EO)\s+(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function ensureOrderNumber(
  doc: FederalRegisterDocument,
  fallbackSeed?: string
): number {
  const existing = extractOrderNumber(doc);
  if (existing) {
    return existing;
  }
  const seed = fallbackSeed ?? doc.document_number;
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return 100_000 + (hash % 900_000);
}

export function inferPresidentName(
  doc: FederalRegisterDocument,
  signingDate?: Date
): string {
  if (doc.president?.name) {
    return doc.president.name;
  }

  const dateRef =
    signingDate ??
    safeParseDate(doc.signing_date) ??
    safeParseDate(doc.publication_date) ??
    new Date();
  const year = dateRef.getUTCFullYear();

  if (year >= 2025) return "Donald J. Trump";
  if (year >= 2021) return "Joseph R. Biden";
  if (year >= 2017) return "Donald J. Trump";
  if (year >= 2009) return "Barack Obama";
  if (year >= 2001) return "George W. Bush";
  if (year >= 1993) return "William J. Clinton";
  return "Unknown";
}

export function buildExecutiveOrderIdentifier(
  doc: Pick<FederalRegisterDocument, "document_number" | "title">
): string {
  return `${doc.document_number ?? "unknown"} - ${doc.title ?? "Untitled"}`;
}
