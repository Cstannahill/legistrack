// String and legislative metadata formatting utilities

export function truncate(str: string, maxLength: number = 100): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength).trimEnd() + "...";
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function pluralize(
  count: number,
  singular: string,
  plural?: string
): string {
  if (count === 1) return singular;
  return plural || `${singular}s`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatBillNumber(
  billType: string,
  billNumber: number,
  congress: number
): string {
  return `${billType.toUpperCase()}. ${billNumber} (${congress}th Congress)`;
}

/**
 * Formats a sponsor label without repeating party/state when fullName already includes bracket metadata
 * such as "Rep. Steube, W. Gregory [R-FL-17]".
 */
export function formatSponsorLabel(
  sponsor?: {
    fullName: string;
    party?: string | null;
    state?: string | null;
  } | null
): string {
  if (!sponsor?.fullName) return "";
  if (/\[[^\]]+\]/.test(sponsor.fullName)) {
    return sponsor.fullName;
  }
  const suffix = [sponsor.party, sponsor.state].filter(Boolean).join("-");
  return suffix ? `${sponsor.fullName} (${suffix})` : sponsor.fullName;
}

export type BillStageSummary = {
  step: 1 | 2 | 3 | 4;
  outcome: "active" | "law" | "failed";
};

/**
 * Maps the 10-value BillStatus enum onto a 4-stage legislative progress scale.
 */
export function getBillStageSummary(status: string): BillStageSummary {
  switch (status) {
    case "INTRODUCED":
      return { step: 1, outcome: "active" };
    case "REFERRED_TO_COMMITTEE":
    case "REPORTED_BY_COMMITTEE":
      return { step: 2, outcome: "active" };
    case "PASSED_HOUSE":
    case "PASSED_SENATE":
    case "RESOLVING_DIFFERENCES":
    case "PRESENTED_TO_PRESIDENT":
      return { step: 3, outcome: "active" };
    case "BECAME_LAW":
      return { step: 4, outcome: "law" };
    case "VETOED":
    case "FAILED":
      return { step: 4, outcome: "failed" };
    default:
      return { step: 1, outcome: "active" };
  }
}
