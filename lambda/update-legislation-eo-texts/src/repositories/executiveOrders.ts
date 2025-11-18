import type { Supabase, ExecutiveOrderRecord } from "../types.js";

const EO_FIELDS = `id, orderNumber, title, signingDate, fullText, federalRegisterUrl`;

export async function fetchExecutiveOrdersWithoutFullText(
  client: Supabase,
  limit: number
): Promise<ExecutiveOrderRecord[]> {
  if (limit <= 0) return [];

  const { data, error } = await client
    .from("ExecutiveOrder")
    .select(EO_FIELDS)
    .is("fullText", null)
    .order("signingDate", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load executive orders without full text: ${error.message}`);
  }

  return (data ?? []) as ExecutiveOrderRecord[];
}

export async function updateExecutiveOrderText(
  client: Supabase,
  eoId: string,
  text: string
) {
  const { error } = await client
    .from("ExecutiveOrder")
    .update({ fullText: text })
    .eq("id", eoId);

  if (error) {
    throw new Error(`Failed to update executive order ${eoId}: ${error.message}`);
  }
}
