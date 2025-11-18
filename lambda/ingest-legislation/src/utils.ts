import { addDays } from "./addDays.js";
import type {
  BillStatus,
  BillStatusResolution,
  CongressBillAction,
  CongressBillDetail,
  CongressBillListItem,
  CongressPersonReference,
} from "./types.js";

const STATUS_MAPPINGS: Array<{ match: RegExp; status: BillStatus }> = [
  { match: /became (public )?law/i, status: "BECAME_LAW" },
  { match: /vetoed/i, status: "VETOED" },
  {
    match: /presented to president|sent to president/i,
    status: "PRESENTED_TO_PRESIDENT",
  },
  { match: /passed senate|senate passed/i, status: "PASSED_SENATE" },
  { match: /passed house|house passed/i, status: "PASSED_HOUSE" },
  {
    match: /reported by committee|committee reported/i,
    status: "REPORTED_BY_COMMITTEE",
  },
  { match: /referred to|committee/i, status: "REFERRED_TO_COMMITTEE" },
  { match: /failed/i, status: "FAILED" },
];

export function resolveStatus(
  bill: CongressBillDetail["bill"],
  actions: CongressBillAction[],
  fallbackDate: Date
): BillStatusResolution {
  const latestActionText = bill.latestAction?.text ?? actions[0]?.text ?? "";
  const resolved = STATUS_MAPPINGS.find(({ match }) =>
    match.test(latestActionText)
  );
  const status: BillStatus = resolved?.status ?? "INTRODUCED";

  const statusDateRaw = bill.latestAction?.actionDate ?? actions[0]?.actionDate;
  const parsedStatusDate = statusDateRaw ? new Date(statusDateRaw) : undefined;
  const statusDate =
    parsedStatusDate && !Number.isNaN(parsedStatusDate.getTime())
      ? parsedStatusDate
      : fallbackDate;

  return { status, statusDate };
}

export function determineLookupWindow(
  lookbackDays: number,
  startDate?: string,
  endDate?: string
): { from: Date; to: Date } {
  const now = new Date();
  const effectiveEnd = endDate ? new Date(endDate) : now;
  const effectiveStart = startDate
    ? new Date(startDate)
    : addDays(effectiveEnd, -Math.max(lookbackDays, 1));

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

export function formatForCongressApi(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function buildBillIdentifier(
  item: CongressBillListItem | CongressBillDetail["bill"]
): string {
  const billType = "billType" in item ? item.billType ?? "" : item.type ?? "";
  const billNumber =
    "billNumber" in item ? item.billNumber ?? "" : item.number ?? "";
  const congress = item.congress ?? "?";
  return `${congress}-${String(billType).toUpperCase()}-${billNumber}`;
}

export function normalizePersonName(person: CongressPersonReference): {
  firstName: string;
  lastName: string;
  fullName: string;
} {
  const firstName = person.firstName ?? person.fullName?.split(" ")[0] ?? "";
  const lastName =
    person.lastName ??
    (person.fullName && person.fullName.includes(" ")
      ? person.fullName.split(" ").slice(-1)[0]
      : "");
  const fullName = person.fullName ?? `${firstName} ${lastName}`.trim();

  return { firstName, lastName, fullName };
}
