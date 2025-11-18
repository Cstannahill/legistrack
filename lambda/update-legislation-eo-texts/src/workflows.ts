import { fetchBillText } from "./lib/congress.js";
import { fetchExecutiveOrderFullText } from "./lib/federal-register.js";
import {
  fetchBillsWithoutFullText,
  updateBillWithFullText,
  updateBillWithTextUrl,
} from "./repositories/bills.js";
import {
  fetchExecutiveOrdersWithoutFullText,
  updateExecutiveOrderText,
} from "./repositories/executiveOrders.js";
import type {
  EnvironmentConfig,
  Supabase,
  UpdateSummary,
  BillRecord,
  ExecutiveOrderRecord,
} from "./types.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function updateBillTexts(
  client: Supabase,
  config: EnvironmentConfig
): Promise<UpdateSummary> {
  const requested = config.billBatchSize;
  const bills = await fetchBillsWithoutFullText(client, requested);

  if (bills.length === 0) {
    console.info("[update-texts:bills] All bills already have full text");
    return createSummary(requested, 0, 0, 0, 0);
  }

  console.info(
    `[update-texts:bills] Found ${bills.length} bills missing full text`
  );

  const result = createSummary(requested, bills.length, 0, 0, 0);

  for (let i = 0; i < bills.length; i++) {
    const bill = bills[i]!;
    await handleBill(client, bill, result);
    if (i < bills.length - 1) {
      await delay(config.billDelayMs);
    }
  }

  logBillSummary(result);
  return result;
}

export async function updateExecutiveOrderTexts(
  client: Supabase,
  config: EnvironmentConfig
): Promise<UpdateSummary> {
  const requested = config.executiveOrderBatchSize;
  const eos = await fetchExecutiveOrdersWithoutFullText(client, requested);

  if (eos.length === 0) {
    console.info("[update-texts:eo] All executive orders already have full text");
    return createSummary(requested, 0, 0, 0, 0);
  }

  console.info(
    `[update-texts:eo] Found ${eos.length} executive orders missing full text`
  );

  const result = createSummary(requested, eos.length, 0, 0, 0);

  for (let i = 0; i < eos.length; i++) {
    const eo = eos[i]!;
    await handleExecutiveOrder(client, eo, result);
    if (i < eos.length - 1) {
      await delay(config.executiveOrderDelayMs);
    }
  }

  logExecutiveSummary(result);
  return result;
}

async function handleBill(
  client: Supabase,
  bill: BillRecord,
  summary: UpdateSummary
) {
  const identifier = `${bill.billType.toUpperCase()} ${bill.billNumber}`;
  console.log(`\n[bill] Processing ${identifier}`);

  try {
    const textData = await fetchBillText(
      bill.congress,
      bill.billType,
      bill.billNumber
    );

    if (textData?.text) {
      await updateBillWithFullText(client, bill.id, textData.text, textData.url);
      summary.updated += 1;
      console.log(
        `   ? Saved full text (${textData.text.length} chars) for ${bill.title}`
      );
    } else if (textData?.url) {
      await updateBillWithTextUrl(client, bill.id, textData.url);
      summary.urlOnly += 1;
      console.log(
        `   ?? Text not available yet, stored source URL for ${bill.title}`
      );
    } else {
      summary.failed += 1;
      console.warn(`   ?? No text available for ${bill.title}`);
    }
  } catch (error) {
    summary.failed += 1;
    console.error(
      `   ? Failed to fetch bill text for ${identifier}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function handleExecutiveOrder(
  client: Supabase,
  eo: ExecutiveOrderRecord,
  summary: UpdateSummary
) {
  const identifier = `EO ${eo.orderNumber}`;
  console.log(`\n[eo] Processing ${identifier}`);
  const documentNumber = extractDocumentNumber(eo.federalRegisterUrl ?? "");

  if (!documentNumber) {
    summary.failed += 1;
    console.warn(`   ?? Could not extract document number for ${identifier}`);
    return;
  }

  console.log(`   Federal Register document: ${documentNumber}`);

  try {
    const fullText = await fetchExecutiveOrderFullText(documentNumber);
    if (!fullText) {
      summary.failed += 1;
      console.warn(`   ?? No text available for ${identifier}`);
      return;
    }

    await updateExecutiveOrderText(client, eo.id, fullText);
    summary.updated += 1;
    console.log(
      `   ? Saved ${(fullText.length / 1024).toFixed(1)}KB of text for ${identifier}`
    );
  } catch (error) {
    summary.failed += 1;
    console.error(
      `   ? Failed to fetch EO text for ${identifier}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

function extractDocumentNumber(url: string): string | undefined {
  const match = url.match(/\/documents\/\d{4}\/\d{2}\/\d{2}\/([^/?#]+)/i);
  return match?.[1];
}

function createSummary(
  requested: number,
  processed: number,
  updated: number,
  urlOnly: number,
  failed: number
): UpdateSummary {
  return { requested, processed, updated, urlOnly, failed };
}

function logBillSummary(summary: UpdateSummary) {
  console.log("\n[bill] Summary");
  console.log(`   ? Full text fetched: ${summary.updated}`);
  console.log(`   ?? URLs saved: ${summary.urlOnly}`);
  console.log(`   ? Failed: ${summary.failed}`);
  console.log(`   ?? Total processed: ${summary.processed}`);
}

function logExecutiveSummary(summary: UpdateSummary) {
  console.log("\n[eo] Summary");
  console.log(`   ? Full text fetched: ${summary.updated}`);
  console.log(`   ? Failed: ${summary.failed}`);
  console.log(`   ?? Total processed: ${summary.processed}`);
}
