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

type EnrichInput =
  | string // db id (old behaviour)
  | {
      // either an explicit db/external billId (if you have one), OR the congress/triple
      billId?: string;
      congress?: number | string;
      billType?: string;
      billNumber?: string;
    };
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
  console.log(`data for detail: ${JSON.stringify(data)}`);
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
    console.log(`data for text: ${JSON.stringify(data)}`);
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
export async function enrichBillFromCongress(input: EnrichInput): Promise<{
  success: boolean;
  hasText: boolean;
  billId?: string; // DB id we ended up enriching (useful for callers)
  error?: string;
}> {
  try {
    // Normalize input
    let dbId: string | undefined;
    let congress: number | string | undefined;
    let billType: string | undefined;
    let billNumber: string | undefined;

    if (typeof input === "string") {
      dbId = input;
    } else {
      // input is object
      if (input.billId) dbId = input.billId;
      congress = input.congress;
      billType = input.billType;
      billNumber = input.billNumber;
    }

    // Helper to fetch detail/text from congress API using congress + billType + billNumber
    async function fetchDetailAndText(
      c: number | string,
      bt: string,
      bn: string
    ) {
      const detail = await fetchBillDetail(c as number, bt, Number(bn));
      const fullText = await fetchBillText(c as number, bt, Number(bn));
      return { detail, fullText };
    }

    // Step A: If we have a DB id, try to load
    let bill = null;
    if (dbId) {
      bill = await db.bill.findUnique({
        where: { id: dbId },
        select: {
          id: true,
          congress: true,
          billType: true,
          billNumber: true,
          fullText: true,
        },
      });

      if (!bill && congress && billType && billNumber) {
        // If the caller passed both a dbId and the triple but db lookup failed,
        // fallback to looking up by triple.
        bill = await db.bill.findFirst({
          where: {
            congress: Number(congress),
            billType,
            billNumber: Number(billNumber),
          },
          select: {
            id: true,
            congress: true,
            billType: true,
            billNumber: true,
            fullText: true,
          },
        });
      }
    } else if (congress && billType && billNumber) {
      // Step B: No dbId - look for a DB record matching the triple
      bill = await db.bill.findFirst({
        where: {
          congress: Number(congress),
          billType,
          billNumber: Number(billNumber),
        },
        select: {
          id: true,
          congress: true,
          billType: true,
          billNumber: true,
          fullText: true,
        },
      });
    }

    // If no bill record exists but we have the triple, fetch details and create a minimal record
    if (!bill) {
      if (!(congress && billType && billNumber)) {
        return {
          success: false,
          hasText: false,
          error:
            "Missing identifiers: provide either DB id (string) or congress+billType+billNumber.",
        };
      }

      // Fetch from congress so we can create a DB row
      const { detail, fullText } = await fetchDetailAndText(
        congress,
        billType,
        billNumber
      );

      // Build minimal create payload from what the congress API returned.
      // Adjust fields below to match your DB schema as needed.
      const createPayload: any = {
        congress: Number(congress),
        billType,
        billNumber,
        title: detail?.bill?.title ?? `${billType} ${billNumber}`,
        lastFetchedAt: new Date(),
      };

      if (fullText) {
        createPayload.fullText = fullText;
        createPayload.fullTextUrl = `${BASE_URL}/bill/${congress}/${billType}/${billNumber}/text`;
      }

      // Try to create the record (wrap in try/catch in case of uniqueness constraints)
      try {
        const created = await db.bill.create({
          data: createPayload,
          select: {
            id: true,
            congress: true,
            billType: true,
            billNumber: true,
            fullText: true,
          },
        });
        bill = created;
      } catch (createErr) {
        // If create fails (e.g., race / unique constraint), try to re-find the bill
        bill = await db.bill.findFirst({
          where: {
            congress: Number(congress),
            billType,
            billNumber: Number(billNumber),
          },
          select: {
            id: true,
            congress: true,
            billType: true,
            billNumber: true,
            fullText: true,
          },
        });

        if (!bill) {
          // If still not found, return an error
          return {
            success: false,
            hasText: !!fullText,
            error: `Failed to create or locate bill record for ${congress} ${billType} ${billNumber}: ${String(
              createErr
            )}`,
          };
        }
      }
    }

    // At this point we have a DB bill row
    const targetBillId = bill.id;

    // Skip if already has full text
    if (bill.fullText) {
      return { success: true, hasText: true, billId: targetBillId };
    }

    // If we reached here, we need to fetch details and full text using the triple
    const c = bill.congress;
    const bt = bill.billType;
    const bn = bill.billNumber;

    const { detail, fullText } = await fetchDetailAndText(c, bt, String(bn));

    const updateData: any = {
      lastFetchedAt: new Date(),
    };

    if (fullText) {
      updateData.fullText = fullText;
      updateData.fullTextUrl = `${BASE_URL}/bill/${c}/${bt}/${bn}/text`;
    }

    // Enrich with sponsor if available (same as your current logic)
    if (detail?.bill?.sponsors && detail.bill.sponsors.length > 0) {
      const sponsor = detail.bill.sponsors[0];
      const memberRecord = await db.member.findUnique({
        where: { bioguideId: sponsor.bioguideId },
      });
      if (memberRecord) {
        updateData.sponsorId = memberRecord.id;
      }
    }

    await db.bill.update({
      where: { id: targetBillId },
      data: updateData,
    });

    return { success: true, hasText: !!fullText, billId: targetBillId };
  } catch (error) {
    console.error(
      `Error enriching bill input=${JSON.stringify(input)}:`,
      error
    );
    return {
      success: false,
      hasText: false,
      error: String(error),
    };
  }
}
