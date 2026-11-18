import type { BillStatus } from "@prisma/client";

const BILL_STATUS_MAPPINGS: Array<{ match: RegExp; status: BillStatus }> = [
  { match: /became (public )?law|signed by president/i, status: "BECAME_LAW" },
  { match: /vetoed|returned unsigned/i, status: "VETOED" },
  {
    match: /presented to president|sent to president/i,
    status: "PRESENTED_TO_PRESIDENT",
  },
  {
    match: /\b(?:failed|rejected|not agreed to|disagreed(?:\s+to)?)\b/i,
    status: "FAILED",
  },
  {
    match: /resolving differences|conference/i,
    status: "RESOLVING_DIFFERENCES",
  },
  {
    match: /passed senate|senate passed|(?<!\bnot\s+)\bagreed to in senate/i,
    status: "PASSED_SENATE",
  },
  {
    match: /passed house|house passed|(?<!\bnot\s+)\bagreed to in house/i,
    status: "PASSED_HOUSE",
  },
  {
    match: /reported by committee|committee reported|committee discharged/i,
    status: "REPORTED_BY_COMMITTEE",
  },
  { match: /referred to|committee/i, status: "REFERRED_TO_COMMITTEE" },
];

/**
 * Resolves a bill's `BillStatus` from its latest legislative action text.
 */
export function resolveBillStatusFromText(
  latestActionText?: string | null
): BillStatus {
  const trimmed = latestActionText?.trim();
  if (!trimmed) {
    return "INTRODUCED";
  }

  const resolved = BILL_STATUS_MAPPINGS.find(({ match }) =>
    match.test(trimmed)
  );
  return resolved?.status ?? "INTRODUCED";
}
