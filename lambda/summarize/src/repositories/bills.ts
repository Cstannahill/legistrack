import { randomUUID } from "node:crypto";
const nowIso = () => new Date().toISOString();
import type { Supabase } from "../types.js";
import type { BillRecord, SummarizationResult } from "../types.js";

const BILL_FIELDS = `id, billType, billNumber, congress, title, shortTitle, currentStatus, statusDate, introducedDate, fullText, fullTextUrl`;

export async function fetchBillsNeedingSummaries(
  client: Supabase,
  limit: number
): Promise<BillRecord[]> {
  if (limit <= 0) {
    return [];
  }

  const candidateCount = Math.max(limit * 3, limit);
  const { data, error } = await client
    .from("Bill")
    .select(BILL_FIELDS)
    .not("fullText", "is", null)
    .order("introducedDate", { ascending: false })
    .limit(candidateCount);

  if (error) {
    throw new Error(`Failed to load bills: ${error.message}`);
  }

  const rows = (data ?? []) as BillRecord[];
  const candidates = rows.filter((bill) =>
    typeof bill.fullText === "string" && bill.fullText.trim().length > 0
  );

  return filterBillsWithoutStandardSummary(client, candidates, limit);
}

async function filterBillsWithoutStandardSummary(
  client: Supabase,
  candidates: BillRecord[],
  limit: number
): Promise<BillRecord[]> {
  const ids = candidates.map((bill) => bill.id);
  if (!ids.length) return [];

  const { data, error } = await client
    .from("Summary")
    .select("billId")
    .eq("summaryType", "STANDARD")
    .in("billId", ids);

  if (error) {
    throw new Error(`Failed to load bill summaries: ${error.message}`);
  }

  const summaryRows = (data ?? []) as Array<{ billId: string | null }>;
  const summarizedIds = new Set(
    summaryRows.map((row) => row.billId).filter((value): value is string => Boolean(value))
  );

  const unsummarized = candidates.filter((bill) => !summarizedIds.has(bill.id));
  return unsummarized.slice(0, limit);
}

export async function persistBillSummary(
  client: Supabase,
  result: SummarizationResult
): Promise<void> {
  const { error } = await client.from("Summary").insert({
    id: randomUUID(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    billId: result.sourceId,
    summaryType: "STANDARD",
    content: result.summary,
    keyPoints: result.keyPoints,
    impactAreas: result.impactAreas,
    aiModel: result.aiModel,
    confidence: result.confidence,
  });

  if (error) {
    throw new Error(`Failed to save bill summary: ${error.message}`);
  }
}


