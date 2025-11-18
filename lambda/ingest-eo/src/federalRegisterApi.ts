import type {
  FederalRegisterDocument,
  FederalRegisterListResponse,
  FetchExecutiveOrdersParams,
} from "./types.js";

const BASE_URL = "https://www.federalregister.gov/api/v1";
const DEFAULT_PER_PAGE = 100;

interface TextContentResult {
  content: string | null;
  url: string | null;
}

export async function fetchExecutiveOrders(
  params: FetchExecutiveOrdersParams = {}
): Promise<FederalRegisterListResponse> {
  const { page = 1, perPage = DEFAULT_PER_PAGE, conditions = {} } = params;

  const url = new URL(`${BASE_URL}/documents.json`);
  url.searchParams.set("page", page.toString());
  url.searchParams.set("per_page", perPage.toString());
  url.searchParams.set("order", "newest");
  url.searchParams.append("conditions[type][]", "PRESDOCU");

  const documentTypes =
    conditions.presidentialDocumentType ??
    (conditions.type?.length ? conditions.type : undefined);
  if (documentTypes?.length) {
    documentTypes.forEach((type) =>
      url.searchParams.append(
        "conditions[presidential_document_type][]",
        type.toLowerCase()
      )
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

  if (conditions.signingDate?.gte) {
    url.searchParams.set(
      "conditions[signing_date][gte]",
      conditions.signingDate.gte
    );
  }
  if (conditions.signingDate?.lte) {
    url.searchParams.set(
      "conditions[signing_date][lte]",
      conditions.signingDate.lte
    );
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Federal Register API error: ${response.status} ${response.statusText} - ${text}`
    );
  }

  const data = (await response.json()) as FederalRegisterListResponse;
  data.results = data.results ?? [];
  return data;
}

export async function fetchExecutiveOrderDetails(
  documentNumber: string
): Promise<FederalRegisterDocument> {
  const response = await fetch(
    `${BASE_URL}/documents/${documentNumber}.json`,
    {
      headers: { Accept: "application/json" },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to fetch executive order detail ${documentNumber}: ${response.status} ${text}`
    );
  }

  return (await response.json()) as FederalRegisterDocument;
}

export async function fetchExecutiveOrderFullText(
  documentNumber: string
): Promise<TextContentResult> {
  const url = `${BASE_URL}/documents/${documentNumber}.json?fields[]=full_text_xml_url&fields[]=body_html_url&fields[]=raw_text_url`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });

  if (!response.ok) {
    return { content: null, url: null };
  }

  const data = (await response.json()) as FederalRegisterDocument;

  const candidateUrls = [
    data.body_html_url,
    data.raw_text_url,
    data.full_text_xml_url,
  ].filter(Boolean) as string[];

  for (const candidate of candidateUrls) {
    try {
      const textResponse = await fetch(candidate);
      if (textResponse.ok) {
        const text = await textResponse.text();
        return { content: text, url: candidate };
      }
    } catch {
      // try next candidate
    }
  }

  return {
    content: null,
    url: candidateUrls[0] ?? null,
  };
}
