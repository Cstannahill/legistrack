import { CONGRESS_API_BASE } from "./constants.js";
import { createLogger, Logger } from "./logger.js";
import type {
  CongressAmendmentResponse,
  CongressBillActionResponse,
  CongressBillDetail,
  CongressBillListResponse,
  CongressBillTextResponse,
  CongressBillTextVersion,
  CongressMemberDetail,
  CongressPersonReference,
  CongressTextFormat,
  HydratedBillData,
} from "./types.js";

interface FetchPageOptions {
  congress: number;
  billTypes?: string[];
  limit: number;
  offset: number;
  fromDateTime: string;
  toDateTime: string;
}

interface ClientOptions {
  apiKey: string;
  logger?: Logger;
}

const DEFAULT_LIMIT = 250;
const TEXT_FORMAT_PRIORITY = [
  "FORMATTED TEXT",
  "TEXT",
  "TXT",
  "XML",
  "PDF",
  "HTML",
];

function normalizeBillType(type: string): string {
  return type.trim().toLowerCase();
}

function normalizeItems<T>(
  input?: T[] | { items?: T[] } | null
): T[] {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  const items = input.items;
  return Array.isArray(items) ? items : [];
}

function formatPriority(type?: string | null): number {
  if (!type) {
    return TEXT_FORMAT_PRIORITY.length + 1;
  }
  const normalized = type.toUpperCase();
  const index = TEXT_FORMAT_PRIORITY.findIndex((entry) =>
    normalized.includes(entry)
  );
  return index === -1 ? TEXT_FORMAT_PRIORITY.length : index;
}

function selectFormat(
  version?: CongressBillTextVersion
): CongressTextFormat | undefined {
  if (!version) return undefined;
  const formats = normalizeItems(version.formats);
  if (formats.length === 0) {
    return undefined;
  }
  return formats
    .map((format) => ({ format, rank: formatPriority(format.type) }))
    .sort((a, b) => a.rank - b.rank)[0]?.format;
}

function buildDownloadUrl(source: string, apiKey: string): string {
  try {
    const url = new URL(source, CONGRESS_API_BASE);
    if (!url.searchParams.has("api_key")) {
      url.searchParams.set("api_key", apiKey);
    }
    return url.toString();
  } catch {
    const separator = source.includes("?") ? "&" : "?";
    return `${source}${separator}api_key=${encodeURIComponent(apiKey)}`;
  }
}

export class CongressClient {
  private readonly apiKey: string;
  private readonly logger: Logger;

  constructor(options: ClientOptions) {
    this.apiKey = options.apiKey;
    this.logger = options.logger ?? createLogger({ context: "CongressClient" });
  }

  private async fetchJson<T>(
    path: string,
    params: Record<string, string> = {}
  ): Promise<T> {
    const url = new URL(`${CONGRESS_API_BASE}${path}`);
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("format", "json");

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    this.logger.debug("Requesting Congress API", { url: url.toString() });

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Congress API request failed (${response.status} ${response.statusText}): ${body}`
      );
    }

    return (await response.json()) as T;
  }

  async fetchBillPage(
    options: FetchPageOptions
  ): Promise<CongressBillListResponse> {
    const { congress, billTypes, limit, offset, fromDateTime, toDateTime } =
      options;
    const params: Record<string, string> = {
      limit: String(limit ?? DEFAULT_LIMIT),
      offset: String(offset ?? 0),
      fromDateTime,
      toDateTime,
    };

    if (billTypes?.length) {
      params.billType = billTypes.map((type) => type.toLowerCase()).join(",");
    }

    return this.fetchJson<CongressBillListResponse>(
      `/bill/${congress}`,
      params
    );
  }

  async fetchBillDetail(
    congress: number,
    billType: string,
    billNumber: string
  ): Promise<CongressBillDetail> {
    const normalizedType = normalizeBillType(billType);
    return this.fetchJson<CongressBillDetail>(
      `/bill/${congress}/${normalizedType}/${billNumber}`
    );
  }

  async fetchBillText(
    congress: number,
    billType: string,
    billNumber: string
  ): Promise<HydratedBillData["text"]> {
    const normalizedType = normalizeBillType(billType);
    const response = await this.fetchJson<CongressBillTextResponse>(
      `/bill/${congress}/${normalizedType}/${billNumber}/text`
    );

    const versions = normalizeItems(response.textVersions);
    if (versions.length === 0) {
      return undefined;
    }

    const sorted = versions.sort((a, b) => {
      const aTime = a?.date ? Date.parse(a.date) : 0;
      const bTime = b?.date ? Date.parse(b.date) : 0;
      return bTime - aTime;
    });

    const preferredVersion =
      sorted.find((version) => selectFormat(version)) ?? sorted[0];
    const selectedFormat = selectFormat(preferredVersion);

    if (!selectedFormat?.url) {
      return {
        content: null,
        url: undefined,
        date: preferredVersion?.date,
      };
    }

    const downloadUrl = buildDownloadUrl(selectedFormat.url, this.apiKey);
    try {
      const textResponse = await fetch(downloadUrl, {
        headers: { Accept: "text/plain, text/html;q=0.9, */*;q=0.1" },
      });
      if (textResponse.ok) {
        const raw = await textResponse.text();
        const content = raw.includes("<pre")
          ? raw
              .replace(/^.*?<pre[^>]*>/is, "")
              .replace(/<\/pre>.*$/is, "")
              .trim()
          : raw;
        return {
          content,
          url: downloadUrl,
          date: preferredVersion?.date,
        };
      }

      this.logger.warn("Bill text download returned non-200", {
        billType,
        billNumber,
        status: textResponse.status,
        statusText: textResponse.statusText,
        url: downloadUrl,
      });
    } catch (error) {
      this.logger.warn("Failed to download bill text", {
        error: error instanceof Error ? error.message : String(error),
        billType,
        billNumber,
        url: downloadUrl,
      });
    }

    return {
      content: null,
      url: downloadUrl,
      date: preferredVersion?.date,
    };
  }

  async fetchBillActions(
    congress: number,
    billType: string,
    billNumber: string
  ): Promise<CongressBillActionResponse> {
    const normalizedType = normalizeBillType(billType);
    return this.fetchJson<CongressBillActionResponse>(
      `/bill/${congress}/${normalizedType}/${billNumber}/actions`
    );
  }

  async fetchBillAmendments(
    congress: number,
    billType: string,
    billNumber: string
  ): Promise<CongressAmendmentResponse> {
    const normalizedType = normalizeBillType(billType);
    return this.fetchJson<CongressAmendmentResponse>(
      `/bill/${congress}/${normalizedType}/${billNumber}/amendments`
    );
  }

  async fetchBillCosponsors(
    congress: number,
    billType: string,
    billNumber: string
  ): Promise<CongressPersonReference[]> {
    const normalizedType = normalizeBillType(billType);
    const data = await this.fetchJson<{
      cosponsors?: { items?: CongressPersonReference[] };
    }>(`/bill/${congress}/${normalizedType}/${billNumber}/cosponsors`);

    return data.cosponsors?.items ?? [];
  }

  async fetchMember(bioguideId: string): Promise<CongressMemberDetail | null> {
    try {
      return await this.fetchJson<CongressMemberDetail>(
        `/member/${bioguideId}`
      );
    } catch (error) {
      this.logger.warn("Failed to fetch member", {
        bioguideId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
