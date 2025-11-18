import { createLogger, Logger } from "./logger.js";
import type { CongressClient } from "./congressClient.js";
import type { CongressBillListItem, HydratedBillData } from "./types.js";
import { buildBillIdentifier } from "./utils.js";

export interface HydrationOptions {
  client: CongressClient;
  bill: CongressBillListItem;
  logger?: Logger;
}

export async function hydrateBill(
  options: HydrationOptions
): Promise<HydratedBillData> {
  const { client, bill, logger } = options;
  const scopedLogger =
    logger?.child("hydrate") ?? createLogger({ context: "hydrate" });
  const identifier = buildBillIdentifier(bill);
  scopedLogger.info("Hydrating bill", { identifier });

  const congress = bill.congress;
  const billType = bill.type;
  const billNumber = bill.number;

  const [detail, actionsResponse, amendmentsResponse, cosponsors] =
    await Promise.all([
      client.fetchBillDetail(congress, billType, billNumber),
      client.fetchBillActions(congress, billType, billNumber),
      client.fetchBillAmendments(congress, billType, billNumber),
      client.fetchBillCosponsors(congress, billType, billNumber),
    ]);

  let text: HydratedBillData["text"];
  try {
    text = await client.fetchBillText(congress, billType, billNumber);
  } catch (error) {
    scopedLogger.warn("Failed to fetch bill text, will retry later", {
      identifier,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const actions = detail.bill.actions?.items ?? actionsResponse.actions ?? [];
  const amendments = amendmentsResponse.amendments ?? [];
  const cosponsorList = detail.bill.cosponsors?.items ?? cosponsors;

  scopedLogger.info("Hydration complete", {
    identifier,
    actions: actions.length,
    amendments: amendments.length,
    cosponsors: cosponsorList.length,
    hasText: Boolean(text?.content),
  });

  return {
    bill: detail.bill,
    text: text ?? undefined,
    actions,
    amendments,
    cosponsors: cosponsorList,
  };
}
