// Federal Register API Client
// Documentation: https://www.federalregister.gov/developers/documentation/api/v1

const BASE_URL = "https://www.federalregister.gov/api/v1";

interface FetchExecutiveOrdersParams {
  page?: number;
  perPage?: number;
  conditions?: {
    publicationDate?: {
      gte?: string;
      lte?: string;
    };
    type?: string[];
    presidentialDocumentType?: string[];
  };
}

export async function fetchExecutiveOrders(
  params: FetchExecutiveOrdersParams = {}
) {
  const { page = 1, perPage = 100, conditions = {} } = params;

  const url = new URL(`${BASE_URL}/documents.json`);
  url.searchParams.set("page", page.toString());
  url.searchParams.set("per_page", perPage.toString());
  url.searchParams.set("order", "newest");

  // Filter for presidential documents using the correct type filter
  // Note: Use PRESDOCU as the type filter (it works), but responses will have type: "Presidential Document"
  url.searchParams.append("conditions[type][]", "PRESDOCU");

  if (conditions.presidentialDocumentType) {
    conditions.presidentialDocumentType.forEach((type) => {
      url.searchParams.append("conditions[presidential_document_type][]", type);
    });
  } else {
    // Default to executive orders
    url.searchParams.append(
      "conditions[presidential_document_type][]",
      "executive_order"
    );
  }

  if (conditions.publicationDate?.gte) {
    url.searchParams.set(
      "conditions[publication_date][gte]",
      conditions.publicationDate.gte
    );
  }

  if (conditions.publicationDate?.lte) {
    url.searchParams.set(
      "conditions[publication_date][lte]",
      conditions.publicationDate.lte
    );
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `Federal Register API error: ${response.status} - ${response.statusText}`
    );
  }

  const data = await response.json();
  return data.results || [];
}

export async function fetchExecutiveOrderDetails(documentNumber: string) {
  const url = `${BASE_URL}/documents/${documentNumber}.json`;

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch executive order: ${response.status}`);
  }

  return await response.json();
}

export async function fetchExecutiveOrderFullText(documentNumber: string) {
  const url = `${BASE_URL}/documents/${documentNumber}.json?fields[]=full_text_xml_url&fields[]=body_html_url&fields[]=raw_text_url`;

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();

  // Try to fetch the actual text content
  if (data.body_html_url) {
    const textResponse = await fetch(data.body_html_url);
    if (textResponse.ok) {
      return await textResponse.text();
    }
  }

  if (data.raw_text_url) {
    const textResponse = await fetch(data.raw_text_url);
    if (textResponse.ok) {
      return await textResponse.text();
    }
  }

  return null;
}
export function normalizeConditionsForFederalRegister(
  input: Record<string, any>
) {
  const mapKey = (k: string) =>
    k
      .replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
      .replace(/^_/, "") // camelCase -> snake_case
      .replace(/[^\w_]/g, "_");

  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(input)) {
    out[mapKey(k)] = v;
  }
  return out;
}

// Type definitions for Federal Register API responses
export interface FederalRegisterDocument {
  document_number: string;
  type: string;
  presidential_document_type?: string;
  subtype?: string; // e.g., "Executive Order", "Presidential Memorandum"
  title: string;
  signing_date?: string;
  publication_date: string;
  executive_order_number?: number | string; // API returns as string in detail view
  presidential_document_number?: string;
  proclamation_number?: number | string;
  president?: {
    name: string;
  };
  html_url: string;
  pdf_url?: string;
  abstract?: string;
  full_text_xml_url?: string;
  body_html_url?: string;
  raw_text_url?: string;
}

export type ExecutiveOrderType =
  | "executive_order"
  | "presidential_memorandum"
  | "proclamation"
  | "determination";
