import { db } from "@/lib/db";

const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY || "";
const BASE_URL = "https://api.congress.gov/v3";

interface CongressBillDetail {
  bill: {
    congress: number;
    type: string;
    number: string;
    title: string;
    introducedDate?: string;
    latestAction?: {
      actionDate: string;
      text: string;
    };
    textVersions?: {
      count: number;
      url: string;
    };
    sponsors?: Array<{
      bioguideId: string;
      fullName: string;
      state: string;
      party: string;
      district?: number;
    }>;
    cosponsors?: {
      count: number;
      url: string;
    };
    // Add other fields as needed
  };
}

interface BillTextVersion {
  textVersions: Array<{
    type: string;
    date: string;
    formats: Array<{
      type: string;
      url: string;
    }>;
  }>;
}

/**
 * Fetch full bill details from Congress API
 */
export async function fetchBillDetail(
  congress: number,
  billType: string,
  billNumber: number
): Promise<CongressBillDetail> {
  const url = `${BASE_URL}/bill/${congress}/${billType}/${billNumber}?api_key=${CONGRESS_API_KEY}&format=json`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Congress API error: ${response.status} ${response.statusText}`
    );
  }
  const data = await response.json();
  console.log(`data for detail: ${data}`);
  return data;
}

/**
 * Fetch bill text versions and get the latest full text
 */
export async function fetchBillText(
  congress: number,
  billType: string,
  billNumber: number
): Promise<string | null> {
  const textUrl = `${BASE_URL}/bill/${congress}/${billType}/${billNumber}/text?api_key=${CONGRESS_API_KEY}&format=json`;

  try {
    const response = await fetch(textUrl);

    if (!response.ok) {
      console.warn(
        `No text available for bill ${congress}/${billType}/${billNumber}`
      );
      return null;
    }

    const data: BillTextVersion = await response.json();
    console.log(`data for text: ${data}`);
    // Get the most recent text version
    if (data.textVersions && data.textVersions.length > 0) {
      const latestVersion = data.textVersions[0];

      // Find the text format (prefer txt, then xml)
      const textFormat = latestVersion.formats.find(
        (f) => f.type === "Formatted Text" || f.type === "XML"
      );

      if (textFormat) {
        const textResponse = await fetch(textFormat.url);
        if (textResponse.ok) {
          return await textResponse.text();
        }
      }
    }

    return null;
  } catch (error) {
    console.error(`Error fetching bill text:`, error);
    return null;
  }
}

/**
 * Enrich a bill record with full details from Congress API
 */
export async function enrichBillFromCongress(billId: string): Promise<{
  success: boolean;
  hasText: boolean;
  error?: string;
}> {
  try {
    const bill = await db.bill.findUnique({
      where: { id: billId },
      select: {
        id: true,
        congress: true,
        billType: true,
        billNumber: true,
        fullText: true,
      },
    });

    if (!bill) {
      return { success: false, hasText: false, error: "Bill not found" };
    }

    // Skip if already has full text
    if (bill.fullText) {
      return { success: true, hasText: true };
    }

    // Fetch full details
    const detail = await fetchBillDetail(
      bill.congress,
      bill.billType,
      bill.billNumber
    );

    // Fetch full text
    const fullText = await fetchBillText(
      bill.congress,
      bill.billType,
      bill.billNumber
    );

    // Update bill with enriched data
    const updateData: any = {
      lastFetchedAt: new Date(),
    };

    if (fullText) {
      updateData.fullText = fullText;
      updateData.fullTextUrl = `${BASE_URL}/bill/${bill.congress}/${bill.billType}/${bill.billNumber}/text`;
    }

    // Enrich with sponsor if available
    if (detail.bill.sponsors && detail.bill.sponsors.length > 0) {
      const sponsor = detail.bill.sponsors[0];

      // Find or create sponsor in DB
      const memberRecord = await db.member.findUnique({
        where: { bioguideId: sponsor.bioguideId },
      });

      if (memberRecord) {
        updateData.sponsorId = memberRecord.id;
      }
    }

    await db.bill.update({
      where: { id: billId },
      data: updateData,
    });

    return { success: true, hasText: !!fullText };
  } catch (error) {
    console.error(`Error enriching bill ${billId}:`, error);
    return {
      success: false,
      hasText: false,
      error: String(error),
    };
  }
}
