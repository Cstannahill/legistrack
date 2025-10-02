/**
 * Utilities for generating Congress.gov URLs
 */

/**
 * Bill type mappings for Congress.gov URLs
 */
const BILL_TYPE_URL_MAP: Record<string, string> = {
  hr: "house-bill",
  hres: "house-resolution",
  hjres: "house-joint-resolution",
  hconres: "house-concurrent-resolution",
  s: "senate-bill",
  sres: "senate-resolution",
  sjres: "senate-joint-resolution",
  sconres: "senate-concurrent-resolution",
};

/**
 * Generates a human-readable Congress.gov URL for a bill
 *
 * @param congress - Congress number (e.g., 119)
 * @param billType - Bill type (e.g., "HR", "S", "SRES")
 * @param billNumber - Bill number (e.g., 427)
 * @returns Congress.gov URL (e.g., https://www.congress.gov/bill/119th-congress/senate-resolution/427)
 */
export function getCongressGovBillUrl(
  congress: number,
  billType: string,
  billNumber: number
): string {
  const normalizedType = billType.toLowerCase();
  const urlType = BILL_TYPE_URL_MAP[normalizedType];

  if (!urlType) {
    console.warn(`Unknown bill type: ${billType}`);
    // Fallback to basic format
    return `https://www.congress.gov/bill/${congress}th-congress/${normalizedType}/${billNumber}`;
  }

  return `https://www.congress.gov/bill/${congress}th-congress/${urlType}/${billNumber}`;
}

/**
 * Generates a human-readable Congress.gov URL from a bill object
 */
export function getBillCongressUrl(bill: {
  congress: number;
  billType: string;
  billNumber: number;
}): string {
  return getCongressGovBillUrl(bill.congress, bill.billType, bill.billNumber);
}

/**
 * Examples:
 * - getCongressGovBillUrl(119, 'SRES', 427) → https://www.congress.gov/bill/119th-congress/senate-resolution/427
 * - getCongressGovBillUrl(119, 'HR', 5370) → https://www.congress.gov/bill/119th-congress/house-bill/5370
 * - getCongressGovBillUrl(119, 'S', 1234) → https://www.congress.gov/bill/119th-congress/senate-bill/1234
 */
