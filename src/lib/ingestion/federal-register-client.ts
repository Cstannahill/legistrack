import { FEDERAL_REGISTER_API_BASE } from "@/lib/constants";

const DEFAULT_PER_PAGE = 100;
const DEFAULT_REQUEST_INTERVAL_MS = 1000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRY_BACKOFF_MS = 30_000;

export type ExecutiveOrderType =
  | "EXECUTIVE_ORDER"
  | "PRESIDENTIAL_MEMORANDUM"
  | "PROCLAMATION"
  | "DETERMINATION";

export interface FetchExecutiveOrdersParams {
  page?: number;
  perPage?: number;
  conditions?: {
    publicationDate?: {
      gte?: string;
      lte?: string;
    };
    signingDate?: {
      gte?: string;
      lte?: string;
    };
    presidentialDocumentType?: string[];
    type?: string[];
  };
}

export interface FederalRegisterPresident {
  name?: string;
}

export interface FederalRegisterDocument {
  document_number: string;
  type: string;
  presidential_document_type?: string;
  subtype?: string;
  title: string;
  signing_date?: string;
  publication_date?: string;
  executive_order_number?: number | string | null;
  presidential_document_number?: string | null;
  proclamation_number?: number | string | null;
  president?: FederalRegisterPresident;
  html_url?: string;
  pdf_url?: string;
  body_html_url?: string;
  full_text_xml_url?: string;
  raw_text_url?: string;
  abstract?: string;
}

export interface FederalRegisterListResponse {
  count: number;
  page: number;
  total_pages: number;
  total_entries: number;
  results: FederalRegisterDocument[];
}

export interface ExecutiveOrderTextResult {
  content: string | null;
  url: string | null;
}

export interface HydratedExecutiveOrder {
  documentNumber: string;
  orderNumber: number;
  executiveOrderType: ExecutiveOrderType;
  title: string;
  signingDate: Date;
  publicationDate?: Date;
  federalRegisterUrl?: string;
  sourceUrl?: string;
  presidentName: string;
  summary?: string | null;
  fullText?: string | null;
  fullTextUrl?: string | null;
}

export interface FederalRegisterLogger {
  debug?: (message: string, metadata?: Record<string, unknown>) => void;
  info?: (message: string, metadata?: Record<string, unknown>) => void;
  warn?: (message: string, metadata?: Record<string, unknown>) => void;
  error?: (message: string, metadata?: Record<string, unknown>) => void;
}

export interface FederalRegisterClientOptions {
  requestIntervalMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  logger?: FederalRegisterLogger;
}

export interface HydrateExecutiveOrderOptions extends FederalRegisterClientOptions {
  document: FederalRegisterDocument;
  fetchFullText?: boolean;
}

class FederalRegisterApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FederalRegisterApiError";
    this.status = status;
  }
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultLogger: FederalRegisterLogger = {
  debug: () => undefined,
  info: (message, metadata) => console.info(message, metadata ?? ""),
  warn: (message, metadata) => console.warn(message, metadata ?? ""),
  error: (message, metadata) => console.error(message, metadata ?? ""),
};

let requestChain: Promise<void> = Promise.resolve();
let lastRequestTime: number | null = null;

/**
 * Resets module-level Federal Register throttle state (for unit tests).
 */
export function resetFederalRegisterThrottleForTests(): void {
  requestChain = Promise.resolve();
  lastRequestTime = null;
}

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

function withThrottle<T>(
  operation: () => Promise<T>,
  requestIntervalMs: number
): Promise<T> {
  const execute = async (): Promise<T> => {
    if (requestIntervalMs > 0) {
      const now = Date.now();
      const wait =
        lastRequestTime === null
          ? 0
          : Math.max(0, lastRequestTime + requestIntervalMs - now);
      if (wait > 0) {
        await delay(wait);
      }
      lastRequestTime = Date.now();
    }
    return operation();
  };

  const result = requestChain.then(execute, execute);
  requestChain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      new Error(`Federal Register request timed out after ${timeoutMs}ms`)
    );
  }, timeoutMs);

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

async function fetchWithThrottleAndRetry(
  url: string,
  init: RequestInit,
  opts: FederalRegisterClientOptions = {}
): Promise<Response> {
  const requestIntervalMs = normalizeNonNegativeInt(
    opts.requestIntervalMs,
    DEFAULT_REQUEST_INTERVAL_MS
  );
  const maxRetries = normalizeNonNegativeInt(
    opts.maxRetries,
    DEFAULT_MAX_RETRIES
  );
  const retryDelayMs = normalizeNonNegativeInt(
    opts.retryDelayMs,
    DEFAULT_RETRY_DELAY_MS
  );
  const timeoutMs = normalizePositiveInt(opts.timeoutMs, DEFAULT_TIMEOUT_MS);
  const logger = opts.logger ?? defaultLogger;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await withThrottle(
        () => fetchWithTimeout(url, init, timeoutMs),
        requestIntervalMs
      );

      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        const waitMs = computeRetryDelayMs(attempt, retryDelayMs, response);
        logger.warn?.("Retrying transient Federal Register HTTP error", {
          status: response.status,
          attempt: attempt + 1,
          maxRetries,
          url,
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
      if (attempt >= maxRetries) {
        throw error;
      }
      const waitMs = computeRetryDelayMs(attempt, retryDelayMs);
      logger.warn?.("Retrying Federal Register request after network error", {
        attempt: attempt + 1,
        maxRetries,
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      if (waitMs > 0) {
        await delay(waitMs);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Federal Register request failed after retries");
}

/**
 * Safely parses a date string, returning `undefined` when absent or invalid.
 */
export function safeParseDate(input?: string | null): Date | undefined {
  if (!input) return undefined;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Maps Federal Register `subtype` or `presidential_document_type` strings to Prisma's `ExecutiveOrderType`.
 */
export function mapSubtypeToExecutiveOrderType(
  subtype?: string | null
): ExecutiveOrderType {
  const normalized = (subtype ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  switch (normalized) {
    case "presidential_memorandum":
    case "memorandum":
      return "PRESIDENTIAL_MEMORANDUM";
    case "proclamation":
      return "PROCLAMATION";
    case "determination":
    case "presidential_determination":
      return "DETERMINATION";
    case "executive_order":
    default:
      return "EXECUTIVE_ORDER";
  }
}

function extractFromTitle(title?: string): number | null {
  if (!title) return null;
  const match = title.match(/(?:Executive Order|EO)\s+(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

/**
 * Extracts a numeric order/proclamation number from Federal Register document metadata.
 */
export function extractOrderNumber(
  doc: FederalRegisterDocument
): number | null {
  const tryNumber = (value?: string | number | null): number | null => {
    if (value === undefined || value === null) return null;
    const parsed =
      typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  };

  return (
    tryNumber(doc.executive_order_number) ??
    tryNumber(doc.presidential_document_number) ??
    tryNumber(doc.proclamation_number) ??
    extractFromTitle(doc.title) ??
    null
  );
}

/**
 * Resolves an order number or computes a deterministic fallback integer from `document_number`.
 */
export function ensureOrderNumber(
  doc: FederalRegisterDocument,
  fallbackSeed?: string
): number {
  const existing = extractOrderNumber(doc);
  if (existing) {
    return existing;
  }
  const seed = fallbackSeed ?? doc.document_number;
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return 100_000 + (hash % 900_000);
}

/**
 * Infers the signing president from document metadata or signing/publication date.
 */
export function inferPresidentName(
  doc: FederalRegisterDocument,
  signingDate?: Date
): string {
  if (doc.president?.name) {
    return doc.president.name;
  }

  const dateRef =
    signingDate ??
    safeParseDate(doc.signing_date) ??
    safeParseDate(doc.publication_date) ??
    new Date();
  const timestamp = dateRef.getTime();

  if (timestamp >= Date.UTC(2025, 0, 20)) return "Donald J. Trump";
  if (timestamp >= Date.UTC(2021, 0, 20)) return "Joseph R. Biden";
  if (timestamp >= Date.UTC(2017, 0, 20)) return "Donald J. Trump";
  if (timestamp >= Date.UTC(2009, 0, 20)) return "Barack Obama";
  if (timestamp >= Date.UTC(2001, 0, 20)) return "George W. Bush";
  if (timestamp >= Date.UTC(1993, 0, 20)) return "William J. Clinton";
  return "Unknown";
}

function collectCandidateTextUrls(
  ...docs: Array<FederalRegisterDocument | undefined>
): string[] {
  const pickFirst = (
    getter: (doc: FederalRegisterDocument) => string | undefined
  ): string | undefined => {
    for (const doc of docs) {
      const value = doc ? getter(doc)?.trim() : undefined;
      if (value) return value;
    }
    return undefined;
  };

  return [
    pickFirst((d) => d.body_html_url),
    pickFirst((d) => d.raw_text_url),
    pickFirst((d) => d.full_text_xml_url),
  ].filter((url): url is string => Boolean(url));
}

async function fetchTextFromCandidates(
  candidateUrls: string[],
  opts: FederalRegisterClientOptions = {}
): Promise<ExecutiveOrderTextResult> {
  for (const candidate of candidateUrls) {
    try {
      const textResponse = await fetchWithThrottleAndRetry(
        candidate,
        {
          headers: {
            Accept: "text/html, text/plain, application/xml;q=0.9, */*;q=0.1",
          },
        },
        opts
      );

      if (textResponse.ok) {
        const text = await textResponse.text();
        if (text.trim().length > 0) {
          return { content: text, url: candidate };
        }
      } else {
        await discardResponseBody(textResponse);
      }
    } catch {
      // Try next text candidate URL
    }
  }

  return {
    content: null,
    url: candidateUrls[0] ?? null,
  };
}

/**
 * Fetches one page of Presidential Documents from the Federal Register API.
 */
export async function fetchExecutiveOrdersPage(
  params: FetchExecutiveOrdersParams = {},
  opts: FederalRegisterClientOptions = {}
): Promise<FederalRegisterListResponse> {
  const { page = 1, perPage = DEFAULT_PER_PAGE, conditions = {} } = params;

  const url = new URL(`${FEDERAL_REGISTER_API_BASE}/documents.json`);
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

  const response = await fetchWithThrottleAndRetry(
    url.toString(),
    { headers: { Accept: "application/json" } },
    opts
  );

  if (!response.ok) {
    const text = await readSafeErrorText(response);
    throw new FederalRegisterApiError(
      `Federal Register API error: ${response.status} ${response.statusText ?? ""} - ${text}`,
      response.status
    );
  }

  const data = (await response.json()) as FederalRegisterListResponse;
  data.results = data.results ?? [];
  return data;
}

/**
 * Fetches full document metadata for a Federal Register `document_number`.
 */
export async function fetchExecutiveOrderDetails(
  documentNumber: string,
  opts: FederalRegisterClientOptions = {}
): Promise<FederalRegisterDocument> {
  const url = `${FEDERAL_REGISTER_API_BASE}/documents/${encodeURIComponent(documentNumber)}.json`;
  const response = await fetchWithThrottleAndRetry(
    url,
    { headers: { Accept: "application/json" } },
    opts
  );

  if (!response.ok) {
    const text = await readSafeErrorText(response);
    throw new FederalRegisterApiError(
      `Failed to fetch executive order detail ${documentNumber}: ${response.status} ${text}`,
      response.status
    );
  }

  return (await response.json()) as FederalRegisterDocument;
}

/**
 * Fetches full text for a Federal Register document by `documentNumber`, trying
 * `body_html_url` → `raw_text_url` → `full_text_xml_url` in priority order.
 */
export async function fetchExecutiveOrderFullText(
  documentNumber: string,
  opts: FederalRegisterClientOptions = {}
): Promise<ExecutiveOrderTextResult> {
  const url = `${FEDERAL_REGISTER_API_BASE}/documents/${encodeURIComponent(documentNumber)}.json?fields[]=full_text_xml_url&fields[]=body_html_url&fields[]=raw_text_url`;
  const response = await fetchWithThrottleAndRetry(
    url,
    { headers: { Accept: "application/json" } },
    opts
  );

  if (response.status === 404) {
    await discardResponseBody(response);
    return { content: null, url: null };
  }

  if (!response.ok) {
    const text = await readSafeErrorText(response);
    throw new FederalRegisterApiError(
      `Failed to fetch executive order text metadata ${documentNumber}: ${response.status} ${text}`,
      response.status
    );
  }

  const data = (await response.json()) as FederalRegisterDocument;
  const candidateUrls = collectCandidateTextUrls(data);

  return fetchTextFromCandidates(candidateUrls, opts);
}

/**
 * Hydrates a Federal Register Presidential Document with detail metadata and optional full text.
 */
export async function hydrateExecutiveOrder(
  options: HydrateExecutiveOrderOptions,
  extraOpts?: FederalRegisterClientOptions
): Promise<HydratedExecutiveOrder> {
  const requestOpts: FederalRegisterClientOptions = {
    requestIntervalMs: extraOpts?.requestIntervalMs ?? options.requestIntervalMs,
    maxRetries: extraOpts?.maxRetries ?? options.maxRetries,
    retryDelayMs: extraOpts?.retryDelayMs ?? options.retryDelayMs,
    timeoutMs: extraOpts?.timeoutMs ?? options.timeoutMs,
    logger: extraOpts?.logger ?? options.logger,
  };
  const logger = requestOpts.logger ?? defaultLogger;
  const baseDoc = options.document;
  const fetchFullText = options.fetchFullText ?? true;

  const detail = await fetchExecutiveOrderDetails(
    baseDoc.document_number,
    requestOpts
  );

  const signingDate =
    safeParseDate(detail.signing_date) ??
    safeParseDate(baseDoc.signing_date) ??
    safeParseDate(detail.publication_date) ??
    safeParseDate(baseDoc.publication_date);

  if (!signingDate) {
    throw new Error(
      `Missing signing date for document ${baseDoc.document_number}`
    );
  }

  const publicationDate =
    safeParseDate(detail.publication_date) ??
    safeParseDate(baseDoc.publication_date);

  const mergedForMetadata: FederalRegisterDocument = {
    ...baseDoc,
    ...detail,
    executive_order_number:
      detail.executive_order_number ?? baseDoc.executive_order_number,
    presidential_document_number:
      detail.presidential_document_number ??
      baseDoc.presidential_document_number,
    proclamation_number:
      detail.proclamation_number ?? baseDoc.proclamation_number,
  };

  const orderNumber = ensureOrderNumber(
    mergedForMetadata,
    baseDoc.document_number
  );
  const executiveOrderType = mapSubtypeToExecutiveOrderType(
    detail.subtype ??
      detail.presidential_document_type ??
      baseDoc.subtype ??
      baseDoc.presidential_document_type
  );
  const presidentName = inferPresidentName(detail, signingDate);

  const candidateUrls = collectCandidateTextUrls(detail, baseDoc);
  let fullTextContent: string | null = null;
  let fullTextUrl: string | null = candidateUrls[0] ?? null;

  if (fetchFullText && candidateUrls.length > 0) {
    try {
      const { content, url } = await fetchTextFromCandidates(
        candidateUrls,
        requestOpts
      );
      if (content) {
        fullTextContent = content;
      }
      if (url) {
        fullTextUrl = url;
      }
    } catch (error) {
      logger.warn?.("Failed to download executive order full text", {
        documentNumber: detail.document_number,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    documentNumber: detail.document_number,
    orderNumber,
    executiveOrderType,
    title: detail.title ?? baseDoc.title ?? "Untitled Executive Order",
    signingDate,
    publicationDate,
    federalRegisterUrl: detail.html_url ?? baseDoc.html_url,
    sourceUrl: detail.html_url ?? baseDoc.html_url,
    presidentName,
    summary: detail.abstract ?? baseDoc.abstract,
    fullText: fullTextContent,
    fullTextUrl,
  };
}
