import { RetryableError } from "workflow";
import type {
  IngestionLogger,
  TextBackfillSummary,
} from "@/lib/ingestion/bills-service";

const TRANSIENT_HTTP_STATUSES = new Set([408, 429]);
const PERMANENT_HTTP_STATUSES = new Set([400, 401, 403, 404, 422]);

const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "P1000",
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2024",
  "P2034",
]);

const PERMANENT_ERROR_CODES = new Set([
  "P2000",
  "P2001",
  "P2002",
  "P2003",
  "P2004",
  "P2005",
  "P2006",
  "P2007",
  "P2011",
  "P2012",
  "P2014",
  "P2015",
  "P2025",
]);

const TRANSIENT_ERROR_NAMES = new Set([
  "AbortError",
  "TimeoutError",
  "PrismaClientInitializationError",
  "PrismaClientRustPanicError",
]);

const TRANSIENT_MESSAGE_PATTERNS: readonly RegExp[] = [
  /(?:\(\s*|\b(?:http|api|status)\s*[:\s]\s*)(?:408|429|5\d{2})\b/i,
  /\b(?:408\s+request\s+timeout|429\s+too\s+many\s+requests|500\s+internal\s+server\s+error|502\s+bad\s+gateway|503\s+service\s+unavailable|504\s+gateway\s+timeout)\b/i,
  /\b(?:rate\s*limit(?:ed)?|too\s+many\s+requests)\b/i,
  /\b(?:timed?\s*out|request\s+timeout|fetch\s+failed|network(?:\s+error|\s+failure)?|socket\s+hang\s+up|econnreset|etimedout|econnrefused|enotfound|eai_again|epipe)\b/i,
  /\b(?:can't\s+reach\s+database\s+server|connection\s+(?:terminated|refused|reset|closed|lost|pool|timed?\s*out)|database\s+(?:unavailable|connection|timeout|error)|prisma\s+(?:query|client|connection)?\s*(?:timeout|error|pool)|pool\s+timeout|deadlock|too\s+many\s+connections|pgbouncer|server\s+closed\s+the\s+connection)\b/i,
  /\bP(?:1000|1001|1002|1008|1017|2024|2034)\b/,
];

const PERMANENT_MESSAGE_PATTERNS: readonly RegExp[] = [
  /(?:\(\s*|\b(?:http|api|status)\s*[:\s]\s*)(?:400|401|403|404|422)\b/i,
  /\b(?:400\s+bad\s+request|401\s+unauthorized|403\s+forbidden|404\s+not\s+found|422\s+unprocessable)\b/i,
  /\b(?:missing\s+signing\s+date|unique\s+constraint|foreign\s+key\s+constraint|constraint\s+(?:violation|failure|error)|null\s+constraint|invalid\s+(?:input|argument|identifier|date|start\s+date|end\s+date)|no\s+(?:bill\s+)?text\s+available\s+yet|no\s+full\s+text\s+or\s+url\s+available|could\s+not\s+extract\s+federal\s+register\s+document\s+number)\b/i,
  /\bP20(?:0[0-7]|1[1245]|25)\b/,
];

export interface ItemFailureRecord {
  identifier: string;
  message: string;
  permanent: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRetryableStatusCode(status: number): boolean {
  return (
    TRANSIENT_HTTP_STATUSES.has(status) || (status >= 500 && status < 600)
  );
}

/**
 * Checks whether an error message reflects a transient upstream HTTP, network,
 * timeout, or database/connection-pool outage.
 */
export function isTransientOrSystemicMessage(message: string): boolean {
  return TRANSIENT_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Checks whether an error message reflects an explicit permanent failure that
 * should not trigger `RetryableError` retries.
 */
export function isExplicitPermanentMessage(message: string): boolean {
  return PERMANENT_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Inspects an error (walking `.cause` safely) to determine whether it represents
 * a transient upstream `408`/`429`/`5xx`, network/timeout, or DB outage.
 */
export function isTransientOrSystemicError(error: unknown): boolean {
  const visited = new Set<object>();
  let current: unknown = error;

  for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth++) {
    if (typeof current === "string") {
      return isTransientOrSystemicMessage(current);
    }

    if (typeof current !== "object") {
      return false;
    }

    if (visited.has(current)) {
      return false;
    }
    visited.add(current);

    if (current instanceof RetryableError) {
      return true;
    }

    const record = current as Record<string, unknown>;
    if (record.name === "RetryableError") {
      return true;
    }

    if (typeof record.status === "number") {
      if (isRetryableStatusCode(record.status)) {
        return true;
      }
      if (PERMANENT_HTTP_STATUSES.has(record.status)) {
        return false;
      }
    }

    if (typeof record.code === "string") {
      const code = record.code.trim().toUpperCase();
      if (TRANSIENT_ERROR_CODES.has(code)) {
        return true;
      }
      if (PERMANENT_ERROR_CODES.has(code)) {
        return false;
      }
    }

    if (
      typeof record.name === "string" &&
      TRANSIENT_ERROR_NAMES.has(record.name)
    ) {
      return true;
    }

    if (
      typeof record.message === "string" &&
      isTransientOrSystemicMessage(record.message)
    ) {
      return true;
    }

    current = record.cause;
  }

  return false;
}

/**
 * Inspects an error (walking `.cause` safely) to determine whether it is an
 * explicit permanent failure (e.g. `404`/`400`, invalid input, constraint error).
 */
export function isExplicitPermanentError(error: unknown): boolean {
  if (isTransientOrSystemicError(error)) {
    return false;
  }

  const visited = new Set<object>();
  let current: unknown = error;

  for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth++) {
    if (typeof current === "string") {
      return isExplicitPermanentMessage(current);
    }

    if (!isRecord(current) || visited.has(current)) {
      return false;
    }
    visited.add(current);

    if (
      typeof current.status === "number" &&
      PERMANENT_HTTP_STATUSES.has(current.status)
    ) {
      return true;
    }

    if (typeof current.code === "string") {
      const code = current.code.trim().toUpperCase();
      if (PERMANENT_ERROR_CODES.has(code)) {
        return true;
      }
    }

    if (
      typeof current.message === "string" &&
      isExplicitPermanentMessage(current.message)
    ) {
      return true;
    }

    current = current.cause;
  }

  return false;
}

/**
 * Wraps a transient or systemic failure message in `RetryableError` for Workflow
 * SDK step suspension and retry.
 */
export function toRetryableStepError(
  errorOrMessage: unknown,
  contextPrefix?: string
): RetryableError {
  if (errorOrMessage instanceof RetryableError) {
    return errorOrMessage;
  }
  if (isRecord(errorOrMessage) && errorOrMessage.name === "RetryableError") {
    return errorOrMessage as unknown as RetryableError;
  }

  const rawMessage =
    errorOrMessage instanceof Error
      ? errorOrMessage.message
      : String(errorOrMessage);
  const message =
    contextPrefix && !rawMessage.startsWith(contextPrefix)
      ? `${contextPrefix}: ${rawMessage}`
      : rawMessage;
  const isRateLimit = /\b(?:429|rate\s*limit|too\s+many\s+requests)\b/i.test(
    rawMessage
  );

  return new RetryableError(message, {
    retryAfter: isRateLimit ? "2m" : "1m",
  });
}

/**
 * Evaluates a finished chunk where all items failed: throws `RetryableError`
 * if at least one failure was non-permanent (unclassified/systemic).
 */
export function throwIfTotalNonPermanentChunkFailure(
  totalItems: number,
  succeededOrSkipped: number,
  failures: ItemFailureRecord[],
  contextPrefix: string
): void {
  if (
    totalItems > 0 &&
    succeededOrSkipped === 0 &&
    failures.length === totalItems &&
    failures.some((failure) => !failure.permanent)
  ) {
    const firstNonPermanent =
      failures.find((failure) => !failure.permanent) ?? failures[0];
    throw toRetryableStepError(
      `${firstNonPermanent.identifier}: ${firstNonPermanent.message}`,
      contextPrefix
    );
  }
}

interface CapturingBackfillLoggerState {
  logger: IngestionLogger;
  transientErrors: string[];
  nonPermanentErrors: string[];
  permanentFailureCount: () => number;
}

function createCapturingBackfillLogger(): CapturingBackfillLoggerState {
  const transientErrors: string[] = [];
  const nonPermanentErrors: string[] = [];
  let permanentFailures = 0;

  const inspectWarning = (
    message: string,
    metadata?: Record<string, unknown>
  ): void => {
    const status =
      typeof metadata?.status === "number" ? metadata.status : undefined;
    const errorDetail =
      typeof metadata?.error === "string" ? metadata.error : undefined;

    if (
      message === "No bill text available yet" ||
      message === "No full text or URL available for executive order" ||
      message === "Could not extract Federal Register document number"
    ) {
      permanentFailures += 1;
      return;
    }

    if (
      message === "Failed to backfill bill text" ||
      message === "Failed to backfill executive order text"
    ) {
      const detail = errorDetail ?? message;
      if (isTransientOrSystemicMessage(detail)) {
        transientErrors.push(detail);
      } else if (isExplicitPermanentMessage(detail)) {
        permanentFailures += 1;
      } else {
        nonPermanentErrors.push(detail);
      }
      return;
    }

    if (
      message === "Bill text download returned non-200" ||
      message === "Executive order text candidate returned non-200"
    ) {
      if (status !== undefined && isRetryableStatusCode(status)) {
        transientErrors.push(`${message} (status ${status})`);
      }
      return;
    }

    if (
      (message === "Failed to download bill text" ||
        message === "Failed to download executive order text candidate") &&
      errorDetail &&
      isTransientOrSystemicMessage(errorDetail)
    ) {
      transientErrors.push(errorDetail);
    }
  };

  const logger: IngestionLogger = {
    debug: () => undefined,
    info: (message, metadata) => console.info(message, metadata ?? ""),
    warn: (message, metadata) => {
      inspectWarning(message, metadata);
      console.warn(message, metadata ?? "");
    },
    error: (message, metadata) => {
      inspectWarning(message, metadata);
      console.error(message, metadata ?? "");
    },
  };

  return {
    logger,
    transientErrors,
    nonPermanentErrors,
    permanentFailureCount: () => permanentFailures,
  };
}

/**
 * Executes a text-backfill service with transient/systemic failure detection,
 * throwing `RetryableError` on upstream/DB outages or 100%-non-permanent batch
 * failures while preserving isolated permanent "text not yet available" items.
 */
export async function runTextBackfillStep(
  limit: number,
  contextPrefix: string,
  executor: (
    limit: number,
    logger: IngestionLogger
  ) => Promise<TextBackfillSummary>
): Promise<TextBackfillSummary> {
  const capture = createCapturingBackfillLogger();

  let summary: TextBackfillSummary;
  try {
    summary = await executor(limit, capture.logger);
  } catch (error) {
    if (isTransientOrSystemicError(error)) {
      throw toRetryableStepError(error);
    }
    throw error;
  }

  if (capture.transientErrors.length > 0) {
    throw toRetryableStepError(capture.transientErrors[0], contextPrefix);
  }

  if (
    summary.processed > 0 &&
    summary.updated === 0 &&
    summary.urlOnly === 0 &&
    summary.failed === summary.processed &&
    capture.nonPermanentErrors.length > 0 &&
    capture.permanentFailureCount() === 0
  ) {
    throw toRetryableStepError(capture.nonPermanentErrors[0], contextPrefix);
  }

  return summary;
}
