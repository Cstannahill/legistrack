import { CONGRESS_API_BASE } from "@/lib/constants";

const DEFAULT_LIMIT = 250;
const DEFAULT_REQUEST_INTERVAL_MS = 1000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRY_BACKOFF_MS = 30_000;
const CONGRESS_DOWNLOAD_BASE = "https://www.congress.gov";

const TEXT_FORMAT_PRIORITY = [
  "FORMATTED TEXT",
  "TEXT",
  "TXT",
  "XML",
  "PDF",
  "HTML",
] as const;

export type Chamber = "HOUSE" | "SENATE";

export type BillStatus =
  | "INTRODUCED"
  | "REFERRED_TO_COMMITTEE"
  | "REPORTED_BY_COMMITTEE"
  | "PASSED_HOUSE"
  | "PASSED_SENATE"
  | "RESOLVING_DIFFERENCES"
  | "PRESENTED_TO_PRESIDENT"
  | "BECAME_LAW"
  | "VETOED"
  | "FAILED";

export interface CongressBillListItem {
  congress: number;
  type: string;
  number: string;
  title: string;
  updateDate?: string;
  introducedDate?: string;
  latestAction?: {
    actionDate?: string;
    text?: string;
  };
  url?: string;
}

export interface CongressBillListResponse {
  bills: CongressBillListItem[];
  pagination?: {
    count?: number;
    limit?: number;
    offset?: number;
    next?: string;
  };
}

export interface CongressName {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  middleName?: string;
  suffix?: string;
}

export interface CongressPersonReference extends CongressName {
  bioguideId?: string;
  party?: string;
  state?: string;
  chamber?: Chamber | string;
  district?: number | string | null;
}

export interface CongressBillAction {
  actionDate?: string;
  actionCode?: string;
  type?: string;
  sourceSystem?: {
    code?: string | number;
    name?: string;
  };
  text?: string;
}

export interface CongressBillActionResponse {
  actions?: CongressBillAction[] | { items?: CongressBillAction[] };
}

export interface CongressAmendmentSummary {
  number?: string;
  type?: string;
  congress?: number;
  status?: string;
  statusDate?: string;
  description?: string;
  purpose?: string;
  sponsor?: CongressPersonReference | null;
}

export interface CongressAmendmentResponse {
  amendments?: CongressAmendmentSummary[] | { items?: CongressAmendmentSummary[] };
}

export interface CongressBillDetail {
  bill: {
    billType?: string;
    type?: string;
    billNumber?: string;
    number?: string;
    congress?: number;
    title?: string;
    shortTitle?: string;
    introducedDate?: string;
    latestAction?: {
      actionDate?: string;
      text?: string;
      description?: string;
    };
    committees?: Array<{
      name?: string;
    }>;
    subjects?: Array<{
      name?: string;
    }>;
    policyArea?: { name?: string } | null;
    laws?: Array<{ lawNumber?: string; number?: string; type?: string }>;
    sponsor?: CongressPersonReference | null;
    sponsors?: CongressPersonReference[];
    cosponsors?: {
      count?: number;
      url?: string;
      items?: CongressPersonReference[];
    };
    relatedBills?: Array<{
      type?: string;
      number?: string;
      congress?: number;
      relationship?: string;
    }>;
    actions?: {
      url?: string;
      count?: number;
      items?: CongressBillAction[];
    };
  };
}

export interface CongressTextFormat {
  type?: string;
  url?: string;
}

export interface CongressBillTextVersion {
  type?: string;
  date?: string;
  formats?: CongressTextFormat[] | { items?: CongressTextFormat[] };
}

export interface CongressBillTextResponse {
  textVersions?:
    | CongressBillTextVersion[]
    | {
        items?: CongressBillTextVersion[];
      };
}

export interface CongressMemberDetail {
  member?: {
    bioguideId?: string;
    officialName?: string;
    firstName?: string;
    lastName?: string;
    middleName?: string;
    suffix?: string;
    party?: string;
    state?: string;
    district?: string | number;
    chamber?: {
      code?: string;
      name?: string;
    };
    terms?: Array<{
      startYear?: number;
      endYear?: number;
      party?: string;
      state?: string;
      district?: string | number;
      chamber?: string;
      startDate?: string;
      endDate?: string;
    }>;
    depiction?: {
      url?: string;
    };
    website?: string;
    officialWebsiteUrl?: string;
  };
}

export interface HydratedBillText {
  content: string | null;
  url?: string;
  date?: string;
}

export interface HydratedBillData {
  bill: CongressBillDetail["bill"];
  text?: HydratedBillText;
  actions: CongressBillAction[];
  amendments: CongressAmendmentSummary[];
  cosponsors: CongressPersonReference[];
}

export interface FetchBillPageOptions {
  congress: number;
  billTypes?: string[];
  limit?: number;
  offset?: number;
  fromDateTime?: string;
  toDateTime?: string;
}

export interface CongressClientLogger {
  debug?: (message: string, metadata?: Record<string, unknown>) => void;
  info?: (message: string, metadata?: Record<string, unknown>) => void;
  warn?: (message: string, metadata?: Record<string, unknown>) => void;
  error?: (message: string, metadata?: Record<string, unknown>) => void;
}

export interface CongressClientOptions {
  apiKey?: string;
  requestIntervalMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  logger?: CongressClientLogger;
}

export interface HydrateBillOptions {
  client: CongressClient;
  bill: CongressBillListItem;
  logger?: CongressClientLogger;
}

class CongressApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CongressApiError";
    this.status = status;
  }
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultLogger: CongressClientLogger = {
  debug: () => undefined,
  info: (message, metadata) => console.info(message, metadata ?? ""),
  warn: (message, metadata) => console.warn(message, metadata ?? ""),
  error: (message, metadata) => console.error(message, metadata ?? ""),
};

function normalizeNonNegativeInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function normalizeBillType(type: string): string {
  return type.trim().toLowerCase();
}

function normalizeItems<T>(input?: T[] | { items?: T[] } | null): T[] {
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
  const withUrl = formats.filter((format) => Boolean(format.url?.trim()));
  const candidates = withUrl.length > 0 ? withUrl : formats;
  return candidates
    .map((format) => ({ format, rank: formatPriority(format.type) }))
    .sort((a, b) => a.rank - b.rank)[0]?.format;
}

function buildPublicBillUrl(source: string): string {
  try {
    const url = source.startsWith("http")
      ? new URL(source)
      : new URL(source, CONGRESS_DOWNLOAD_BASE);
    url.searchParams.delete("api_key");
    return url.toString();
  } catch {
    return source;
  }
}

function buildDownloadUrl(source: string, apiKey: string): string {
  try {
    const url = source.startsWith("http")
      ? new URL(source)
      : new URL(source, CONGRESS_DOWNLOAD_BASE);
    if (!url.searchParams.has("api_key")) {
      url.searchParams.set("api_key", apiKey);
    }
    return url.toString();
  } catch {
    const separator = source.includes("?") ? "&" : "?";
    return `${source}${separator}api_key=${encodeURIComponent(apiKey)}`;
  }
}

function redactUrlApiKey(rawUrl: string): string {
  return rawUrl.replace(/([?&]api_key=)[^&#]*/gi, "$1***");
}

function extractBillTextContent(raw: string): string {
  const preMatch = raw.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i);
  if (preMatch) {
    return preMatch[1].trim();
  }
  if (/<pre\b/i.test(raw)) {
    return raw.replace(/^[\s\S]*?<pre\b[^>]*>/i, "").trim();
  }
  return raw;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

function parseRetryAfterMs(response: Response): number | null {
  const headerValue = response.headers?.get?.("retry-after");
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10) * 1000;
  }
  const timestamp = Date.parse(trimmed);
  if (!Number.isNaN(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }
  return null;
}

function computeRetryDelayMs(
  attempt: number,
  baseRetryDelayMs: number,
  response?: Response
): number {
  if (baseRetryDelayMs <= 0) {
    return 0;
  }
  const exponential = Math.min(
    MAX_RETRY_BACKOFF_MS,
    baseRetryDelayMs * 2 ** attempt
  );
  const retryAfterMs = response ? parseRetryAfterMs(response) : null;
  if (retryAfterMs !== null) {
    return Math.min(MAX_RETRY_BACKOFF_MS, Math.max(exponential, retryAfterMs));
  }
  return exponential;
}

async function readSafeErrorText(response: Response): Promise<string> {
  try {
    return typeof response.text === "function" ? await response.text() : "";
  } catch {
    return "";
  }
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel?.();
  } catch {
    // Ignore stream cancellation errors before retry
  }
}

/**
 * Throttled, retried, `no-store` client for Congress.gov API v3 and bill text downloads.
 */
export class CongressClient {
  private readonly configuredApiKey?: string;
  private readonly requestIntervalMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;
  private readonly logger: CongressClientLogger;
  private requestChain: Promise<void> = Promise.resolve();
  private lastRequestTime: number | null = null;

  constructor(options: CongressClientOptions = {}) {
    this.configuredApiKey = options.apiKey;
    this.requestIntervalMs = normalizeNonNegativeInt(
      options.requestIntervalMs,
      DEFAULT_REQUEST_INTERVAL_MS
    );
    this.maxRetries = normalizeNonNegativeInt(
      options.maxRetries,
      DEFAULT_MAX_RETRIES
    );
    this.retryDelayMs = normalizeNonNegativeInt(
      options.retryDelayMs,
      DEFAULT_RETRY_DELAY_MS
    );
    this.timeoutMs = normalizePositiveInt(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS
    );
    this.logger = options.logger ?? defaultLogger;
  }

  private resolveApiKey(): string {
    const key = (this.configuredApiKey ?? process.env.CONGRESS_API_KEY)?.trim();
    if (!key) {
      throw new Error("CONGRESS_API_KEY is not configured");
    }
    return key;
  }

  private runWithThrottle<T>(operation: () => Promise<T>): Promise<T> {
    const execute = async (): Promise<T> => {
      if (this.requestIntervalMs > 0) {
        const now = Date.now();
        const wait =
          this.lastRequestTime === null
            ? 0
            : Math.max(0, this.lastRequestTime + this.requestIntervalMs - now);
        if (wait > 0) {
          await delay(wait);
        }
        this.lastRequestTime = Date.now();
      }
      return operation();
    };

    const result = this.requestChain.then(execute, execute);
    this.requestChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(
        new Error(`Congress request timed out after ${this.timeoutMs}ms`)
      );
    }, this.timeoutMs);

    try {
      return await fetch(url, {
        ...init,
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchWithThrottleAndRetry(
    url: string,
    init: RequestInit
  ): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.runWithThrottle(() =>
          this.fetchWithTimeout(url, init)
        );

        if (isRetryableStatus(response.status) && attempt < this.maxRetries) {
          const waitMs = computeRetryDelayMs(
            attempt,
            this.retryDelayMs,
            response
          );
          this.logger.warn?.("Retrying transient Congress HTTP error", {
            status: response.status,
            attempt: attempt + 1,
            maxRetries: this.maxRetries,
            url: redactUrlApiKey(url),
          });
          await discardResponseBody(response);
          if (waitMs > 0) {
            await delay(waitMs);
          }
          continue;
        }

        return response;
      } catch (error) {
        lastError = error;
        if (attempt >= this.maxRetries) {
          throw error;
        }
        const waitMs = computeRetryDelayMs(attempt, this.retryDelayMs);
        this.logger.warn?.("Retrying Congress request after network error", {
          attempt: attempt + 1,
          maxRetries: this.maxRetries,
          url: redactUrlApiKey(url),
          error: error instanceof Error ? error.message : String(error),
        });
        if (waitMs > 0) {
          await delay(waitMs);
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Congress request failed after retries");
  }

  private buildApiUrl(path: string, params: Record<string, string> = {}): string {
    const url = new URL(`${CONGRESS_API_BASE}${path}`);
    url.searchParams.set("api_key", this.resolveApiKey());
    url.searchParams.set("format", "json");

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    return url.toString();
  }

  private async fetchJson<T>(
    path: string,
    params: Record<string, string> = {}
  ): Promise<T> {
    const requestUrl = this.buildApiUrl(path, params);
    this.logger.debug?.("Requesting Congress API", {
      url: redactUrlApiKey(requestUrl),
    });

    const response = await this.fetchWithThrottleAndRetry(requestUrl, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const body = await readSafeErrorText(response);
      throw new CongressApiError(
        `Congress API request failed (${response.status} ${response.statusText ?? ""}): ${body}`,
        response.status
      );
    }

    return (await response.json()) as T;
  }

  /**
   * Fetches one page of bills from `/bill/{congress}`.
   */
  async fetchBillPage(
    options: FetchBillPageOptions
  ): Promise<CongressBillListResponse> {
    const { congress, billTypes, limit, offset, fromDateTime, toDateTime } =
      options;
    const params: Record<string, string> = {
      limit: String(limit ?? DEFAULT_LIMIT),
      offset: String(offset ?? 0),
    };

    if (fromDateTime) {
      params.fromDateTime = fromDateTime;
    }
    if (toDateTime) {
      params.toDateTime = toDateTime;
    }
    if (billTypes?.length) {
      params.billType = billTypes.map((type) => normalizeBillType(type)).join(",");
    }

    return this.fetchJson<CongressBillListResponse>(
      `/bill/${congress}`,
      params
    );
  }

  /**
   * Fetches bill detail metadata from `/bill/{congress}/{billType}/{billNumber}`.
   */
  async fetchBillDetail(
    congress: number,
    billType: string,
    billNumber: string | number
  ): Promise<CongressBillDetail> {
    const normalizedType = normalizeBillType(billType);
    return this.fetchJson<CongressBillDetail>(
      `/bill/${congress}/${normalizedType}/${billNumber}`
    );
  }

  /**
   * Fetches bill actions from `/bill/{congress}/{billType}/{billNumber}/actions`.
   */
  async fetchBillActions(
    congress: number,
    billType: string,
    billNumber: string | number
  ): Promise<CongressBillActionResponse> {
    const normalizedType = normalizeBillType(billType);
    return this.fetchJson<CongressBillActionResponse>(
      `/bill/${congress}/${normalizedType}/${billNumber}/actions`
    );
  }

  /**
   * Fetches bill amendments from `/bill/{congress}/{billType}/{billNumber}/amendments`.
   */
  async fetchBillAmendments(
    congress: number,
    billType: string,
    billNumber: string | number
  ): Promise<CongressAmendmentResponse> {
    const normalizedType = normalizeBillType(billType);
    return this.fetchJson<CongressAmendmentResponse>(
      `/bill/${congress}/${normalizedType}/${billNumber}/amendments`
    );
  }

  /**
   * Fetches bill cosponsors from `/bill/{congress}/{billType}/{billNumber}/cosponsors`.
   */
  async fetchBillCosponsors(
    congress: number,
    billType: string,
    billNumber: string | number
  ): Promise<CongressPersonReference[]> {
    const normalizedType = normalizeBillType(billType);
    const data = await this.fetchJson<{
      cosponsors?: { items?: CongressPersonReference[] } | CongressPersonReference[];
    }>(`/bill/${congress}/${normalizedType}/${billNumber}/cosponsors`);

    return normalizeItems(data.cosponsors);
  }

  /**
   * Fetches the latest bill text version prioritizing `FORMATTED TEXT`, `TEXT`, and `TXT`,
   * extracting `<pre>` inner text when wrapped in HTML.
   */
  async fetchBillText(
    congress: number,
    billType: string,
    billNumber: string | number
  ): Promise<HydratedBillData["text"]> {
    const normalizedType = normalizeBillType(billType);
    const metadataUrl = this.buildApiUrl(
      `/bill/${congress}/${normalizedType}/${billNumber}/text`
    );
    const metadataResponse = await this.fetchWithThrottleAndRetry(metadataUrl, {
      headers: { Accept: "application/json" },
    });

    if (metadataResponse.status === 404) {
      await discardResponseBody(metadataResponse);
      return undefined;
    }

    if (!metadataResponse.ok) {
      const body = await readSafeErrorText(metadataResponse);
      throw new CongressApiError(
        `Congress API request failed (${metadataResponse.status} ${metadataResponse.statusText ?? ""}): ${body}`,
        metadataResponse.status
      );
    }

    const response = (await metadataResponse.json()) as CongressBillTextResponse;
    const versions = normalizeItems(response.textVersions);
    if (versions.length === 0) {
      return undefined;
    }

    const sorted = [...versions].sort((a, b) => {
      const aTime = a?.date ? Date.parse(a.date) : 0;
      const bTime = b?.date ? Date.parse(b.date) : 0;
      return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
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

    const publicUrl = buildPublicBillUrl(selectedFormat.url);
    const downloadUrl = buildDownloadUrl(selectedFormat.url, this.resolveApiKey());

    try {
      const textResponse = await this.fetchWithThrottleAndRetry(downloadUrl, {
        headers: { Accept: "text/plain, text/html;q=0.9, */*;q=0.1" },
      });

      if (textResponse.ok) {
        const raw = await textResponse.text();
        return {
          content: extractBillTextContent(raw),
          url: publicUrl,
          date: preferredVersion?.date,
        };
      }

      this.logger.warn?.("Bill text download returned non-200", {
        billType,
        billNumber,
        status: textResponse.status,
        statusText: textResponse.statusText,
        url: publicUrl,
      });
      await discardResponseBody(textResponse);
    } catch (error) {
      this.logger.warn?.("Failed to download bill text", {
        error: error instanceof Error ? error.message : String(error),
        billType,
        billNumber,
        url: publicUrl,
      });
    }

    return {
      content: null,
      url: publicUrl,
      date: preferredVersion?.date,
    };
  }

  /**
   * Fetches member details from `/member/{bioguideId}`, returning `null` on failure.
   */
  async fetchMember(bioguideId: string): Promise<CongressMemberDetail | null> {
    try {
      return await this.fetchJson<CongressMemberDetail>(
        `/member/${encodeURIComponent(bioguideId)}`
      );
    } catch (error) {
      this.logger.warn?.("Failed to fetch member", {
        bioguideId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Hydrates full bill metadata, actions, amendments, cosponsors, and optional bill text.
   */
  async hydrateBill(
    bill: CongressBillListItem,
    loggerOverride?: CongressClientLogger
  ): Promise<HydratedBillData> {
    const scopedLogger = loggerOverride ?? this.logger;
    const { congress, type: billType, number: billNumber } = bill;
    const identifier = `${congress}-${billType.toUpperCase()}-${billNumber}`;

    scopedLogger.info?.("Hydrating bill", { identifier });

    const [detail, actionsResponse, amendmentsResponse, cosponsors] =
      await Promise.all([
        this.fetchBillDetail(congress, billType, billNumber),
        this.fetchBillActions(congress, billType, billNumber),
        this.fetchBillAmendments(congress, billType, billNumber),
        this.fetchBillCosponsors(congress, billType, billNumber),
      ]);

    let text: HydratedBillData["text"];
    try {
      text = await this.fetchBillText(congress, billType, billNumber);
    } catch (error) {
      scopedLogger.warn?.("Failed to fetch bill text, will retry later", {
        identifier,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const actions = detail.bill.actions?.items?.length
      ? detail.bill.actions.items
      : normalizeItems(actionsResponse.actions);
    const amendments = normalizeItems(amendmentsResponse.amendments);
    const cosponsorList = detail.bill.cosponsors?.items?.length
      ? detail.bill.cosponsors.items
      : cosponsors;

    scopedLogger.info?.("Hydration complete", {
      identifier,
      actions: actions.length,
      amendments: amendments.length,
      cosponsors: cosponsorList.length,
      hasText: Boolean(text?.content),
    });

    return {
      bill: detail.bill,
      text: text ?? undefined,
      actions,
      amendments,
      cosponsors: cosponsorList,
    };
  }
}

/**
 * Standalone bill hydration wrapper delegating to `options.client.hydrateBill`.
 */
export async function hydrateBill(
  options: HydrateBillOptions
): Promise<HydratedBillData> {
  return options.client.hydrateBill(options.bill, options.logger);
}
