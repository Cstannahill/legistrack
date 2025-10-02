// Congress.gov API Client
// Documentation: https://api.congress.gov/

// Read API key dynamically so dotenv has time to load
const getCongressAPIKey = () => process.env.CONGRESS_API_KEY!;
const BASE_URL = "https://api.congress.gov/v3";

interface FetchBillsParams {
  congress: number;
  limit?: number;
  offset?: number;
  fromDateTime?: string;
  toDateTime?: string;
}

export async function fetchLatestBills(params: FetchBillsParams) {
  const {
    congress,
    limit = 250,
    offset = 0,
    fromDateTime,
    toDateTime,
  } = params;

  const url = new URL(`${BASE_URL}/bill/${congress}`);
  url.searchParams.set("api_key", getCongressAPIKey());
  url.searchParams.set("limit", limit.toString());
  url.searchParams.set("offset", offset.toString());
  url.searchParams.set("format", "json");

  if (fromDateTime) url.searchParams.set("fromDateTime", fromDateTime);
  if (toDateTime) url.searchParams.set("toDateTime", toDateTime);

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    next: { revalidate: 3600 }, // Cache for 1 hour
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Congress API Error Details:", errorText);
    throw new Error(
      `Congress API error: ${response.status} - ${response.statusText}\nDetails: ${errorText}`
    );
  }

  const data = await response.json();
  return data.bills || [];
}

export async function fetchBillDetails(
  congress: number,
  billType: string,
  billNumber: number
) {
  const url = `${BASE_URL}/bill/${congress}/${billType}/${billNumber}`;

  const response = await fetch(
    `${url}?api_key=${getCongressAPIKey()}&format=json`,
    {
      headers: { Accept: "application/json" },
      next: { revalidate: 1800 }, // Cache for 30 minutes
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch bill details: ${response.status}`);
  }

  const data = await response.json();
  return data.bill;
}

export async function fetchBillText(
  congress: number,
  billType: string,
  billNumber: number
) {
  const url = `${BASE_URL}/bill/${congress}/${billType}/${billNumber}/text`;

  const response = await fetch(
    `${url}?api_key=${getCongressAPIKey()}&format=json`,
    {
      headers: { Accept: "application/json" },
    }
  );

  if (!response.ok) {
    return null; // Bill text may not be available yet
  }

  const data = await response.json();
  const textVersions = data.textVersions || [];

  if (textVersions.length === 0) {
    return null;
  }

  // Get the most recent text version
  const latestVersion = textVersions[0];

  // Try to fetch the actual text content from the formatted text URL
  const formattedText = latestVersion.formats?.find(
    (f: { type: string; url: string }) =>
      f.type === "Formatted Text" || f.type === "TXT"
  );

  if (formattedText?.url) {
    try {
      const textResponse = await fetch(
        `${formattedText.url}?api_key=${getCongressAPIKey()}`,
        {
          headers: { Accept: "text/html,text/plain,*/*" },
        }
      );

      if (textResponse.ok) {
        let fullText = await textResponse.text();

        // Extract text from HTML if wrapped in <html><body><pre> tags
        if (fullText.includes("<html>") && fullText.includes("<pre>")) {
          const preMatch = fullText.match(/<pre>([\s\S]*?)<\/pre>/i);
          if (preMatch) {
            fullText = preMatch[1].trim();
          }
        }

        return {
          text: fullText,
          url: formattedText.url,
          date: latestVersion.date,
        };
      }
    } catch (error) {
      console.error("Error fetching full text content:", error);
    }
  }

  // Fallback: return just the URL if we can't fetch the text
  return {
    text: null,
    url: formattedText?.url || latestVersion.formats?.[0]?.url,
    date: latestVersion.date,
  };
}

export async function fetchBillActions(
  congress: number,
  billType: string,
  billNumber: number
) {
  const url = `${BASE_URL}/bill/${congress}/${billType}/${billNumber}/actions`;

  const response = await fetch(
    `${url}?api_key=${getCongressAPIKey()}&format=json`,
    {
      headers: { Accept: "application/json" },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch bill actions: ${response.status}`);
  }

  const data = await response.json();
  return data.actions || [];
}

export async function fetchVotes(
  congress: number,
  chamber: "house" | "senate"
) {
  const url = `${BASE_URL}/vote/${congress}/${chamber}`;

  const response = await fetch(
    `${url}?api_key=${getCongressAPIKey()}&format=json`,
    {
      headers: { Accept: "application/json" },
      next: { revalidate: 1800 },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch votes: ${response.status}`);
  }

  const data = await response.json();
  return data.votes || [];
}

export async function fetchMember(bioguideId: string) {
  const url = `${BASE_URL}/member/${bioguideId}`;

  const response = await fetch(
    `${url}?api_key=${getCongressAPIKey()}&format=json`,
    {
      headers: { Accept: "application/json" },
      next: { revalidate: 86400 }, // Cache for 24 hours
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch member: ${response.status}`);
  }

  const data = await response.json();
  return data.member;
}

// Type definitions for Congress.gov API responses
export interface CongressBill {
  congress: number;
  type: string;
  number: number;
  title: string;
  introducedDate: string;
  latestAction: {
    actionDate: string;
    text: string;
    status?: string;
  };
  url: string;
  sponsors?: Array<{
    bioguideId: string;
    fullName: string;
    party: string;
    state: string;
  }>;
}

export interface CongressVote {
  congress: number;
  chamber: string;
  rollCallNumber: number;
  voteDate: string;
  voteQuestion: string;
  result: string;
  yeas: number;
  nays: number;
  present: number;
  notVoting: number;
}
