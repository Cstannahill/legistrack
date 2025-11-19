import { summarizeItems } from "./summarizer.js";
import { fetchBillsNeedingSummaries, persistBillSummary } from "./repositories/bills.js";
import {
  fetchExecutiveOrdersNeedingSummaries,
  persistExecutiveOrderSummary,
} from "./repositories/executiveOrders.js";
import type {
  BatchProcessMetrics,
  BillRecord,
  EnvironmentConfig,
  ExecutiveOrderRecord,
  SummarizationItem,
  SummarizationResult,
  Supabase,
} from "./types.js";

function createMetrics(): BatchProcessMetrics {
  return {
    requested: 0,
    prepared: 0,
    summarized: 0,
    persisted: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
}

export async function processBillSummaries(
  client: Supabase,
  config: EnvironmentConfig,
  batchSizeOverride?: number
): Promise<BatchProcessMetrics> {
  const metrics = createMetrics();
  const batchSize =
    typeof batchSizeOverride === "number" && batchSizeOverride >= 0
      ? batchSizeOverride
      : config.billBatchSize;
  metrics.requested = batchSize;

  const bills = await fetchBillsNeedingSummaries(client, batchSize);
  metrics.prepared = bills.length;

  if (bills.length === 0) {
    console.info("[summarize:bills] No bills found that require summaries");
    return metrics;
  }

  const items = bills.map((bill) => mapBillToItem(bill));

  let summaries: SummarizationResult[] = [];
  try {
    summaries = await summarizeItems({
      items,
      modelKey: config.billModelKey,
      preferredKeyIndex: config.billKeyIndex,
      config,
      label: "bill-batch",
    });
  } catch (error) {
    metrics.failed = bills.length;
    metrics.errors.push({
      id: "bill-batch",
      reason: error instanceof Error ? error.message : String(error),
    });
    console.error("[summarize:bills] Summarizer call failed", error);
    return metrics;
  }

  const summaryMap = new Map(summaries.map((item) => [item.sourceId, item]));

  for (const bill of items) {
    const summary = summaryMap.get(bill.sourceId);
    if (!summary || !summary.summary) {
      metrics.failed += 1;
      metrics.errors.push({
        id: bill.sourceId,
        reason: "Model response missing summary",
      });
      console.warn("[summarize:bills] Model returned no summary", bill.sourceId);
      continue;
    }

    try {
      await persistBillSummary(client, summary);
      metrics.summarized += 1;
      metrics.persisted += 1;
    } catch (error) {
      metrics.failed += 1;
      metrics.errors.push({
        id: bill.sourceId,
        reason: error instanceof Error ? error.message : String(error),
      });
      console.error("[summarize:bills] Failed to persist summary", {
        id: bill.sourceId,
        error,
      });
    }
  }

  return metrics;
}

export async function processExecutiveOrderSummaries(
  client: Supabase,
  config: EnvironmentConfig
): Promise<BatchProcessMetrics> {
  const metrics = createMetrics();
  metrics.requested = config.executiveOrderBatchSize;

  const eos = await fetchExecutiveOrdersNeedingSummaries(
    client,
    config.executiveOrderBatchSize
  );
  metrics.prepared = eos.length;

  if (eos.length === 0) {
    console.info("[summarize:eo] No executive orders found that require summaries");
    return metrics;
  }

  const items = eos.map((eo) => mapExecutiveOrderToItem(eo));

  let summaries: SummarizationResult[] = [];
  try {
    summaries = await summarizeItems({
      items,
      modelKey: config.executiveOrderModelKey,
      preferredKeyIndex: config.executiveOrderKeyIndex,
      config,
      label: "eo-batch",
    });
  } catch (error) {
    metrics.failed = eos.length;
    metrics.errors.push({
      id: "eo-batch",
      reason: error instanceof Error ? error.message : String(error),
    });
    console.error("[summarize:eo] Summarizer call failed", error);
    return metrics;
  }

  const summaryMap = new Map(summaries.map((item) => [item.sourceId, item]));

  for (const item of items) {
    const summary = summaryMap.get(item.sourceId);
    if (!summary || !summary.summary) {
      metrics.failed += 1;
      metrics.errors.push({
        id: item.sourceId,
        reason: "Model response missing summary",
      });
      console.warn("[summarize:eo] Model returned no summary", item.sourceId);
      continue;
    }

    try {
      await persistExecutiveOrderSummary(client, summary);
      metrics.summarized += 1;
      metrics.persisted += 1;
    } catch (error) {
      metrics.failed += 1;
      metrics.errors.push({
        id: item.sourceId,
        reason: error instanceof Error ? error.message : String(error),
      });
      console.error("[summarize:eo] Failed to persist summary", {
        id: item.sourceId,
        error,
      });
    }
  }

  return metrics;
}

function mapBillToItem(bill: BillRecord): SummarizationItem {
  const fallbackTitle = `${bill.billType.toUpperCase()} ${bill.billNumber}`;
  return {
    sourceId: bill.id,
    kind: "bill",
    title: bill.title || bill.shortTitle || fallbackTitle,
    text: bill.fullText ?? "",
    metadata: {
      billType: bill.billType,
      billNumber: bill.billNumber,
      congress: bill.congress,
      currentStatus: bill.currentStatus,
      introducedDate: bill.introducedDate,
      statusDate: bill.statusDate,
    },
  };
}

function mapExecutiveOrderToItem(eo: ExecutiveOrderRecord): SummarizationItem {
  return {
    sourceId: eo.id,
    kind: "executive_order",
    title: eo.title,
    text: eo.fullText ?? "",
    metadata: {
      orderNumber: eo.orderNumber,
      executiveOrderType: eo.executiveOrderType,
      presidentName: eo.presidentName,
      signingDate: eo.signingDate,
      publicationDate: eo.publicationDate,
    },
  };
}
