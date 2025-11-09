import { CONGRESS_API_BASE } from "../../src/lib/constants";
import { createLogger, Logger } from "../logger";
import type {
  CongressAmendmentResponse,
  CongressBillActionResponse,
  CongressBillDetail,
  CongressBillListResponse,
  CongressBillTextResponse,
  CongressMemberDetail,
  CongressPersonReference,
  HydratedBillData,
} from "./types";

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

export class CongressClient {
  private readonly apiKey: string;
  private readonly logger: Logger;

  constructor(options: ClientOptions) {
    this.apiKey = options.apiKey;
    this.logger = options.logger ?? createLogger({ context: "CongressClient" });
  }

  private async fetchJson<T>(path: string, params: Record<string, string> = {}): Promise<T> {
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

  async fetchBillPage(options: FetchPageOptions): Promise<CongressBillListResponse> {
    const { congress, billTypes, limit, offset, fromDateTime, toDateTime } = options;
    const params: Record<string, string> = {
      limit: String(limit ?? DEFAULT_LIMIT),
      offset: String(offset ?? 0),
      fromDateTime,
      toDateTime,
    };

    if (billTypes?.length) {
      params.billType = billTypes.join(",");
    }

    return this.fetchJson<CongressBillListResponse>(`/bill/${congress}`, params);
  }

  async fetchBillDetail(
    congress: number,
    billType: string,
    billNumber: string
  ): Promise<CongressBillDetail> {
    return this.fetchJson<CongressBillDetail>(`/bill/${congress}/${billType}/${billNumber}`);
  }

  async fetchBillText(
    congress: number,
    billType: string,
    billNumber: string
  ): Promise<HydratedBillData["text"]> {
    const response = await this.fetchJson<CongressBillTextResponse>(
      `/bill/${congress}/${billType}/${billNumber}/text`
    );

    const version = response.textVersions?.[0];

    if (!version) {
      return undefined;
    }

    const formattedText = version.formats?.find((format) =>
      ["Formatted Text", "TXT", "TEXT"].includes((format.type ?? "").toUpperCase())
    );

    if (!formattedText?.url) {
      return {
        content: null,
        url: version.formats?.[0]?.url,
        date: version.date,
      };
    }

    try {
      const textResponse = await fetch(`${formattedText.url}?api_key=${this.apiKey}`);
      if (textResponse.ok) {
        const raw = await textResponse.text();
        const content = raw.includes("<pre>")
          ? raw.replace(/^.*<pre>/is, "").replace(/<\/pre>.*$/is, "").trim()
          : raw;
        return {
          content,
          url: formattedText.url,
          date: version.date,
        };
      }
    } catch (error) {
      this.logger.warn("Failed to download bill text", {
        error: error instanceof Error ? error.message : String(error),
        billType,
        billNumber,
      });
    }

    return {
      content: null,
      url: formattedText.url,
      date: version.date,
    };
  }

  async fetchBillActions(
    congress: number,
    billType: string,
    billNumber: string
  ): Promise<CongressBillActionResponse> {
    return this.fetchJson<CongressBillActionResponse>(
      `/bill/${congress}/${billType}/${billNumber}/actions`
    );
  }

  async fetchBillAmendments(
    congress: number,
    billType: string,
    billNumber: string
  ): Promise<CongressAmendmentResponse> {
    return this.fetchJson<CongressAmendmentResponse>(
      `/bill/${congress}/${billType}/${billNumber}/amendments`
    );
  }

  async fetchBillCosponsors(
    congress: number,
    billType: string,
    billNumber: string
  ): Promise<CongressPersonReference[]> {
    const data = await this.fetchJson<{ cosponsors?: { items?: CongressPersonReference[] } }>(
      `/bill/${congress}/${billType}/${billNumber}/cosponsors`
    );

    return data.cosponsors?.items ?? [];
  }

  async fetchMember(bioguideId: string): Promise<CongressMemberDetail | null> {
    try {
      return await this.fetchJson<CongressMemberDetail>(`/member/${bioguideId}`);
    } catch (error) {
      this.logger.warn("Failed to fetch member", {
        bioguideId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
