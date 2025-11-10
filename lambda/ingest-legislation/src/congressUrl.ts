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

export function getCongressGovBillUrl(
  congress: number,
  billType: string,
  billNumber: number
): string {
  const normalizedType = billType.toLowerCase();
  const urlType = BILL_TYPE_URL_MAP[normalizedType];

  if (!urlType) {
    console.warn(`Unknown bill type: ${billType}`);
    return `https://www.congress.gov/bill/${congress}th-congress/${normalizedType}/${billNumber}`;
  }

  return `https://www.congress.gov/bill/${congress}th-congress/${urlType}/${billNumber}`;
}
