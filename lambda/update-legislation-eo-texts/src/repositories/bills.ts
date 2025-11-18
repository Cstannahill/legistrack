import type { Supabase, BillRecord } from "../types.js";

const BILL_FIELDS = `id, billType, billNumber, congress, title, fullText, fullTextUrl`;

export async function fetchBillsWithoutFullText(
  client: Supabase,
  limit: number
): Promise<BillRecord[]> {
  if (limit <= 0) return [];

  const { data, error } = await client
    .from("Bill")
    .select(BILL_FIELDS)
    .is("fullText", null)
    .order("introducedDate", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load bills without full text: ${error.message}`);
  }

  return (data ?? []) as BillRecord[];
}

export async function updateBillWithFullText(
  client: Supabase,
  billId: string,
  text: string,
  url?: string | null
) {
  const { error } = await client
    .from("Bill")
    .update({ fullText: text, fullTextUrl: url ?? null })
    .eq("id", billId);

  if (error) {
    throw new Error(`Failed to update bill ${billId} with full text: ${error.message}`);
  }
}

export async function updateBillWithTextUrl(
  client: Supabase,
  billId: string,
  url: string
) {
  const { error } = await client
    .from("Bill")
    .update({ fullTextUrl: url })
    .eq("id", billId);

  if (error) {
    throw new Error(`Failed to update bill ${billId} with text URL: ${error.message}`);
  }
}
