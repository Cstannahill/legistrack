import { db } from "@/lib/db";
import type { LegislationSummaryPreview } from "@/types/legislation";

/**
 * Fetches concise summary previews (preferring BRIEF, falling back to STANDARD)
 * in a single batched query for a list of bill IDs and executive order IDs.
 */
export async function fetchSummaryPreviews(
  billIds: string[],
  eoIds: string[]
): Promise<{
  billSummaries: Map<string, LegislationSummaryPreview>;
  eoSummaries: Map<string, LegislationSummaryPreview>;
}> {
  const billSummaries = new Map<string, LegislationSummaryPreview>();
  const eoSummaries = new Map<string, LegislationSummaryPreview>();

  if (billIds.length === 0 && eoIds.length === 0) {
    return { billSummaries, eoSummaries };
  }

  const orFilters: Array<Record<string, unknown>> = [];
  if (billIds.length > 0) orFilters.push({ billId: { in: billIds } });
  if (eoIds.length > 0) orFilters.push({ executiveOrderId: { in: eoIds } });

  const rows = await db.summary.findMany({
    where: {
      OR: orFilters,
      summaryType: { in: ["BRIEF", "STANDARD"] },
    },
    select: {
      billId: true,
      executiveOrderId: true,
      summaryType: true,
      content: true,
      keyPoints: true,
    },
  });

  const pickBest = (
    map: Map<string, LegislationSummaryPreview>,
    key: string,
    row: { summaryType: string; content: string; keyPoints: string[] }
  ) => {
    const existing = map.get(key);
    if (!existing || (existing.summaryType !== "BRIEF" && row.summaryType === "BRIEF")) {
      map.set(key, {
        summaryType: row.summaryType,
        content: row.content,
        keyPoints: row.keyPoints,
      });
    }
  };

  for (const row of rows) {
    if (!row.content) continue;
    if (row.billId) pickBest(billSummaries, row.billId, row);
    if (row.executiveOrderId) pickBest(eoSummaries, row.executiveOrderId, row);
  }

  return { billSummaries, eoSummaries };
}
