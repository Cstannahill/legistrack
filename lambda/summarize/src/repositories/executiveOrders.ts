import { randomUUID } from "node:crypto";
const nowIso = () => new Date().toISOString();
import type { Supabase } from "../types.js";
import type { ExecutiveOrderRecord, SummarizationResult } from "../types.js";

const EO_FIELDS = `id, orderNumber, executiveOrderType, title, presidentName, signingDate, publicationDate, fullText, fullTextUrl`;

export async function fetchExecutiveOrdersNeedingSummaries(
  client: Supabase,
  limit: number
): Promise<ExecutiveOrderRecord[]> {
  if (limit <= 0) {
    return [];
  }

  const candidateCount = Math.max(limit * 3, limit);
  const { data, error } = await client
    .from("ExecutiveOrder")
    .select(EO_FIELDS)
    .not("fullText", "is", null)
    .order("signingDate", { ascending: false })
    .limit(candidateCount);

  if (error) {
    throw new Error(`Failed to load executive orders: ${error.message}`);
  }

  const rows = (data ?? []) as ExecutiveOrderRecord[];
  const candidates = rows.filter((eo) =>
    typeof eo.fullText === "string" && eo.fullText.trim().length > 0
  );

  return filterExecutiveOrdersWithoutSummary(client, candidates, limit);
}

async function filterExecutiveOrdersWithoutSummary(
  client: Supabase,
  candidates: ExecutiveOrderRecord[],
  limit: number
): Promise<ExecutiveOrderRecord[]> {
  const ids = candidates.map((eo) => eo.id);
  if (!ids.length) return [];

  const { data, error } = await client
    .from("Summary")
    .select("executiveOrderId")
    .eq("summaryType", "STANDARD")
    .in("executiveOrderId", ids);

  if (error) {
    throw new Error(`Failed to load executive order summaries: ${error.message}`);
  }

  const summaryRows = (data ?? []) as Array<{ executiveOrderId: string | null }>;
  const summarizedIds = new Set(
    summaryRows.map((row) => row.executiveOrderId).filter((value): value is string => Boolean(value))
  );

  const unsummarized = candidates.filter((eo) => !summarizedIds.has(eo.id));
  return unsummarized.slice(0, limit);
}

export async function persistExecutiveOrderSummary(
  client: Supabase,
  result: SummarizationResult
): Promise<void> {
  const { error } = await client.from("Summary").insert({
    id: randomUUID(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    executiveOrderId: result.sourceId,
    summaryType: "STANDARD",
    content: result.summary,
    keyPoints: result.keyPoints,
    impactAreas: result.impactAreas,
    aiModel: result.aiModel,
    confidence: result.confidence,
  });

  if (error) {
    throw new Error(`Failed to save executive order summary: ${error.message}`);
  }
}
