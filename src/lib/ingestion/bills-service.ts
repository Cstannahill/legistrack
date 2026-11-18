import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveBillStatusFromText } from "@/lib/ingestion/bill-status";
import { getCongressGovBillUrl } from "@/lib/utils/congress-url";
import {
  CongressClient,
  type BillStatus,
  type Chamber,
  type CongressBillAction,
  type CongressBillDetail,
  type CongressBillListItem,
  type CongressClientLogger,
  type CongressPersonReference,
  type HydratedBillData,
} from "@/lib/ingestion/congress-client";

const MS_PER_DAY = 86_400_000;

export type IngestionLogger = CongressClientLogger;

export interface LookupWindow {
  from: Date;
  to: Date;
}

export interface BillStatusResolution {
  status: BillStatus;
  statusDate: Date;
}

export interface PersistedBillResult {
  action: "created" | "updated" | "skipped" | "failed";
  billId?: string;
  identifier: string;
  message?: string;
}

export interface TextBackfillSummary {
  processed: number;
  updated: number;
  urlOnly: number;
  failed: number;
  updatedIds: string[];
}

export interface PersistBillOptions {
  logger?: IngestionLogger;
}

export interface BackfillBillTextsOptions {
  client?: CongressClient;
  logger?: IngestionLogger;
}

const defaultLogger: IngestionLogger = {
  debug: () => undefined,
  info: (message, metadata) => console.info(message, metadata ?? ""),
  warn: (message, metadata) => console.warn(message, metadata ?? ""),
  error: (message, metadata) => console.error(message, metadata ?? ""),
};

type BillPreservableField =
  | "officialTitle"
  | "shortTitle"
  | "lawNumber"
  | "fullText"
  | "fullTextUrl"
  | "sponsorId"
  | "sourceUrl";

const PRESERVE_WHEN_EMPTY_FIELDS: readonly BillPreservableField[] = [
  "officialTitle",
  "shortTitle",
  "lawNumber",
  "fullText",
  "fullTextUrl",
  "sponsorId",
  "sourceUrl",
];

interface BillBaseData {
  billType: string;
  billNumber: number;
  congress: number;
  title: string;
  officialTitle: string | null;
  shortTitle: string | null;
  introducedDate: Date;
  currentStatus: BillStatus;
  statusDate: Date;
  lawNumber: string | null;
  fullText: string | null;
  fullTextUrl: string | null;
  sponsorId: string | null;
  sourceUrl: string | null;
  lastFetchedAt: Date;
}

type ExistingBillRecord = {
  id: string;
  title: string;
} & Pick<BillBaseData, BillPreservableField>;

function isEmptyValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  );
}

function parseDate(value?: string | null, fallback?: Date): Date | undefined {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function deriveChamber(input?: string | null): Chamber | undefined {
  if (!input) return undefined;
  const normalized = input.trim().toLowerCase();
  if (["house", "h", "house of representatives", "hr"].includes(normalized)) {
    return "HOUSE";
  }
  if (["senate", "s"].includes(normalized)) {
    return "SENATE";
  }
  return undefined;
}

/**
 * Computes and validates the `[from, to]` ingestion lookup window in UTC.
 */
export function determineLookupWindow(
  lookbackDays: number,
  startDate?: string,
  endDate?: string
): LookupWindow {
  const now = new Date();
  const effectiveEnd = endDate ? new Date(endDate) : now;
  const effectiveDays = Math.max(
    1,
    Number.isFinite(lookbackDays) ? Math.floor(lookbackDays) : 1
  );
  const effectiveStart = startDate
    ? new Date(startDate)
    : new Date(effectiveEnd.getTime() - effectiveDays * MS_PER_DAY);

  if (Number.isNaN(effectiveStart.getTime())) {
    throw new Error(`Invalid start date provided: ${startDate}`);
  }

  if (Number.isNaN(effectiveEnd.getTime())) {
    throw new Error(`Invalid end date provided: ${endDate}`);
  }

  if (effectiveStart > effectiveEnd) {
    throw new Error(
      `Start date ${effectiveStart.toISOString()} cannot be after end date ${effectiveEnd.toISOString()}`
    );
  }

  return { from: effectiveStart, to: effectiveEnd };
}

/**
 * Formats a `Date` as an ISO-8601 UTC string without milliseconds for Congress.gov queries.
 */
export function formatForCongressApi(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Formats a canonical bill identifier string (`{congress}-{TYPE}-{number}`).
 */
export function buildBillIdentifier(
  item: CongressBillListItem | CongressBillDetail["bill"]
): string {
  const billType = "billType" in item ? item.billType ?? item.type ?? "" : item.type ?? "";
  const billNumber =
    "billNumber" in item ? item.billNumber ?? item.number ?? "" : item.number ?? "";
  const congress = item.congress ?? "?";
  return `${congress}-${String(billType).trim().toUpperCase()}-${String(billNumber).trim()}`;
}

/**
 * Extracts normalized `firstName`, `lastName`, and `fullName` from a Congress person reference.
 */
export function normalizePersonName(person: CongressPersonReference): {
  firstName: string;
  lastName: string;
  fullName: string;
} {
  const fullNameInput = person.fullName?.trim();
  const firstName =
    person.firstName?.trim() || fullNameInput?.split(/\s+/)[0] || "";
  const lastName =
    person.lastName?.trim() ||
    (fullNameInput && fullNameInput.includes(" ")
      ? fullNameInput.split(/\s+/).slice(-1)[0] ?? ""
      : "");
  const fullName = fullNameInput || `${firstName} ${lastName}`.trim();

  return { firstName, lastName, fullName };
}

/**
 * Resolves a bill's `BillStatus` and `statusDate` from `latestAction` or `actions[0]`.
 */
export function resolveBillStatus(
  bill: CongressBillDetail["bill"],
  actions: CongressBillAction[] = [],
  fallbackDate: Date = new Date()
): BillStatusResolution {
  const latestActionText =
    bill.latestAction?.text?.trim() || actions[0]?.text?.trim() || "";
  const status = resolveBillStatusFromText(latestActionText);

  const statusDateRaw = bill.latestAction?.actionDate ?? actions[0]?.actionDate;
  const statusDate = parseDate(statusDateRaw, fallbackDate) ?? fallbackDate;

  return { status, statusDate };
}

async function ensureMember(
  reference: CongressPersonReference | undefined,
  client: CongressClient,
  logger: IngestionLogger,
  cache: Map<string, string | undefined>
): Promise<string | undefined> {
  const bioguideId = reference?.bioguideId?.trim();
  if (!bioguideId) {
    return undefined;
  }

  if (cache.has(bioguideId)) {
    return cache.get(bioguideId);
  }

  const existing = await db.member.findUnique({
    where: { bioguideId },
    select: { id: true },
  });

  if (existing?.id) {
    cache.set(bioguideId, existing.id);
    return existing.id;
  }

  const detail = await client.fetchMember(bioguideId);
  const member = detail?.member;

  const latestTerm = member?.terms?.length
    ? [...member.terms].sort((a, b) => (b.startYear ?? 0) - (a.startYear ?? 0))[0]
    : undefined;

  const normalizedNames = normalizePersonName({
    firstName: member?.firstName ?? reference?.firstName,
    lastName: member?.lastName ?? reference?.lastName,
    fullName: member?.officialName ?? reference?.fullName,
  });

  const chamber =
    deriveChamber(member?.chamber?.code) ??
    deriveChamber(member?.chamber?.name) ??
    deriveChamber(
      typeof reference?.chamber === "string" ? reference.chamber : undefined
    ) ??
    deriveChamber(latestTerm?.chamber);

  const state = (member?.state ?? latestTerm?.state ?? reference?.state)?.trim();
  if (!chamber || !state) {
    logger.warn?.("Unable to create member due to missing chamber or state", {
      bioguideId,
      chamber,
      state,
    });
    cache.set(bioguideId, undefined);
    return undefined;
  }

  const termStart =
    parseDate(latestTerm?.startDate) ??
    (latestTerm?.startYear
      ? new Date(`${latestTerm.startYear}-01-03T00:00:00Z`)
      : new Date());
  const termEnd =
    parseDate(latestTerm?.endDate) ??
    (latestTerm?.endYear
      ? new Date(`${latestTerm.endYear}-01-03T00:00:00Z`)
      : null);

  const districtRaw =
    member?.district ?? latestTerm?.district ?? reference?.district;
  const parsedDistrict =
    districtRaw !== undefined && districtRaw !== null && districtRaw !== ""
      ? Number.parseInt(String(districtRaw), 10)
      : Number.NaN;
  const district = Number.isNaN(parsedDistrict) ? null : parsedDistrict;

  const memberPayload = {
    firstName: normalizedNames.firstName || "Unknown",
    lastName: normalizedNames.lastName || "Unknown",
    fullName:
      normalizedNames.fullName ||
      `${normalizedNames.firstName} ${normalizedNames.lastName}`.trim() ||
      bioguideId,
    chamber,
    state,
    party:
      (member?.party ?? latestTerm?.party ?? reference?.party)?.trim() ||
      "Unknown",
    district,
    termStart,
    termEnd,
    imageUrl: member?.depiction?.url ?? null,
    websiteUrl: member?.officialWebsiteUrl ?? member?.website ?? null,
  };

  const upserted = await db.member.upsert({
    where: { bioguideId },
    create: {
      bioguideId,
      ...memberPayload,
    },
    update: memberPayload,
    select: { id: true },
  });

  logger.info?.("Upserted member", {
    bioguideId,
    memberId: upserted.id,
  });

  cache.set(bioguideId, upserted.id);
  return upserted.id;
}

function buildBillData(
  data: HydratedBillData,
  congress: number,
  billType: string,
  billNumber: number,
  sponsorId: string | undefined,
  introducedDate: Date,
  status: BillStatus,
  statusDate: Date,
  fetchedAt: Date
): BillBaseData {
  const incomingTitle = data.bill.title?.trim() ? data.bill.title : "";
  const sourceUrl = getCongressGovBillUrl(congress, billType, billNumber);
  const lawNumber =
    data.bill.laws?.[0]?.lawNumber?.trim() ||
    data.bill.laws?.[0]?.number?.trim() ||
    null;

  return {
    billType,
    billNumber,
    congress,
    title: incomingTitle,
    officialTitle: incomingTitle || null,
    shortTitle: data.bill.shortTitle?.trim() ? data.bill.shortTitle : null,
    introducedDate,
    currentStatus: status,
    statusDate,
    lawNumber,
    fullText:
      data.text?.content && data.text.content.trim().length > 0
        ? data.text.content
        : null,
    fullTextUrl: data.text?.url?.trim() ? data.text.url : null,
    sponsorId: sponsorId ?? null,
    sourceUrl: sourceUrl?.trim() ? sourceUrl : null,
    lastFetchedAt: fetchedAt,
  };
}

function mergeBillDataWithExisting(
  baseData: BillBaseData,
  existing?: ExistingBillRecord | null
): BillBaseData {
  if (!existing) {
    return baseData;
  }

  const merged: BillBaseData = {
    ...baseData,
    title: isEmptyValue(baseData.title) ? existing.title : baseData.title,
  };

  for (const field of PRESERVE_WHEN_EMPTY_FIELDS) {
    if (isEmptyValue(merged[field]) && !isEmptyValue(existing[field])) {
      merged[field] = existing[field] as never;
    }
  }

  return merged;
}

function mapActionRecords(
  billId: string,
  actions: HydratedBillData["actions"],
  ingestedAt: Date
): Prisma.ActionCreateManyInput[] {
  const records: Prisma.ActionCreateManyInput[] = [];

  for (const action of actions) {
    const actionDate = parseDate(action.actionDate);
    if (!actionDate) {
      continue;
    }

    const rawSourceCode = action.sourceSystem?.code;
    const actionCode =
      action.actionCode?.trim() ||
      (rawSourceCode === null || rawSourceCode === undefined
        ? null
        : String(rawSourceCode));

    records.push({
      billId,
      actionDate,
      actionType:
        action.sourceSystem?.name?.trim() || action.type?.trim() || "Unknown",
      actionCode,
      text: action.text ?? "",
      createdAt: ingestedAt,
    });
  }

  return records;
}

function mapAmendmentRecords(
  billId: string,
  fallbackCongress: number,
  amendments: HydratedBillData["amendments"],
  sponsorLookup: Map<string, string>,
  ingestedAt: Date
): Prisma.AmendmentCreateManyInput[] {
  const records: Prisma.AmendmentCreateManyInput[] = [];
  const seen = new Set<string>();

  for (const amendment of amendments) {
    const amendmentNumber = amendment.number?.trim();
    const amendmentType = amendment.type?.trim();
    const congress = amendment.congress ?? fallbackCongress;
    if (!amendmentNumber || !amendmentType || !congress) {
      continue;
    }

    const dedupeKey = `${congress}:${amendmentType}:${amendmentNumber}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const parsedStatusDate = parseDate(amendment.statusDate);
    const proposedDate = parsedStatusDate ?? ingestedAt;
    const sponsorBioguide = amendment.sponsor?.bioguideId?.trim();
    const sponsorId = sponsorBioguide
      ? sponsorLookup.get(sponsorBioguide) ?? null
      : null;

    records.push({
      billId,
      amendmentNumber,
      amendmentType,
      congress,
      purpose: amendment.purpose ?? null,
      description: amendment.description ?? null,
      status: amendment.status?.trim() || "Unknown",
      statusDate: parsedStatusDate ?? proposedDate,
      sponsorId,
      proposedDate,
      sourceUrl: null,
      createdAt: ingestedAt,
      updatedAt: ingestedAt,
    });
  }

  return records;
}

/**
 * Persists a hydrated Congress.gov bill, sponsor/cosponsors, actions, and amendments
 * via Prisma while preserving existing non-empty fields on update.
 */
export async function persistHydratedBillPrisma(
  data: HydratedBillData,
  client: CongressClient,
  options: PersistBillOptions = {}
): Promise<PersistedBillResult> {
  const logger = options.logger ?? defaultLogger;
  const identifier = buildBillIdentifier(data.bill);

  try {
    const billTypeRaw = data.bill.billType ?? data.bill.type ?? "";
    const billType = billTypeRaw.trim().toLowerCase();
    const billNumber = Number.parseInt(
      String(data.bill.billNumber ?? data.bill.number ?? "0"),
      10
    );
    const congress = data.bill.congress;

    if (
      !billType ||
      !Number.isFinite(billNumber) ||
      billNumber <= 0 ||
      !congress ||
      !Number.isFinite(congress)
    ) {
      logger.warn?.("Skipping bill due to incomplete identifier", {
        identifier,
        billType,
        billNumber,
        congress,
      });
      return {
        action: "skipped",
        identifier,
        message: "Missing bill type, number, or congress",
      };
    }

    const introducedDate =
      parseDate(data.bill.introducedDate) ??
      parseDate(data.bill.latestAction?.actionDate) ??
      parseDate(data.actions[0]?.actionDate) ??
      new Date();

    const { status, statusDate } = resolveBillStatus(
      data.bill,
      data.actions,
      introducedDate
    );

    const memberCache = new Map<string, string | undefined>();
    const sponsorLookup = new Map<string, string>();

    const sponsorReference = data.bill.sponsor ?? data.bill.sponsors?.[0];
    const sponsorId = await ensureMember(
      sponsorReference,
      client,
      logger,
      memberCache
    );
    if (sponsorReference?.bioguideId?.trim() && sponsorId) {
      sponsorLookup.set(sponsorReference.bioguideId.trim(), sponsorId);
    }

    const cosponsorIdSet = new Set<string>();
    for (const cosponsor of data.cosponsors) {
      const id = await ensureMember(cosponsor, client, logger, memberCache);
      if (id) {
        cosponsorIdSet.add(id);
        const bioguideId = cosponsor.bioguideId?.trim();
        if (bioguideId) {
          sponsorLookup.set(bioguideId, id);
        }
      }
    }
    const cosponsorIds = Array.from(cosponsorIdSet);

    const fetchedAt = new Date();
    const baseData = buildBillData(
      data,
      congress,
      billType,
      billNumber,
      sponsorId,
      introducedDate,
      status,
      statusDate,
      fetchedAt
    );

    const { billId, action, actionsCount, amendmentsCount } =
      await db.$transaction(async (tx: Prisma.TransactionClient) => {
        const existing = await tx.bill.findUnique({
          where: {
            congress_billType_billNumber: {
              congress,
              billType,
              billNumber,
            },
          },
          select: {
            id: true,
            title: true,
            officialTitle: true,
            shortTitle: true,
            lawNumber: true,
            fullText: true,
            fullTextUrl: true,
            sponsorId: true,
            sourceUrl: true,
          },
        });

        let persistedBillId: string;
        let persistedAction: "created" | "updated";

        if (existing?.id) {
          const mergedData = mergeBillDataWithExisting(baseData, existing);
          const updated = await tx.bill.update({
            where: { id: existing.id },
            data: {
              ...mergedData,
              cosponsors: {
                set: cosponsorIds.map((id) => ({ id })),
              },
            },
            select: { id: true },
          });
          persistedBillId = updated.id;
          persistedAction = "updated";
        } else {
          const created = await tx.bill.create({
            data: {
              ...baseData,
              ...(cosponsorIds.length > 0
                ? { cosponsors: { connect: cosponsorIds.map((id) => ({ id })) } }
                : {}),
            },
            select: { id: true },
          });
          persistedBillId = created.id;
          persistedAction = "created";
        }

        const actionRecords = mapActionRecords(
          persistedBillId,
          data.actions,
          fetchedAt
        );
        await tx.action.deleteMany({ where: { billId: persistedBillId } });
        if (actionRecords.length > 0) {
          await tx.action.createMany({ data: actionRecords });
        }

        const amendmentRecords = mapAmendmentRecords(
          persistedBillId,
          congress,
          data.amendments,
          sponsorLookup,
          fetchedAt
        );
        await tx.amendment.deleteMany({ where: { billId: persistedBillId } });
        if (amendmentRecords.length > 0) {
          await tx.amendment.createMany({
            data: amendmentRecords,
            skipDuplicates: true,
          });
        }

        return {
          billId: persistedBillId,
          action: persistedAction,
          actionsCount: actionRecords.length,
          amendmentsCount: amendmentRecords.length,
        };
      });

    logger.info?.("Persisted bill", {
      identifier,
      billId,
      action,
      actions: actionsCount,
      amendments: amendmentsCount,
      cosponsors: cosponsorIds.length,
    });

    return { action, billId, identifier };
  } catch (error) {
    logger.error?.("Failed to persist bill", {
      identifier,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      action: "failed",
      identifier,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Queries bills missing `fullText` and fetches/updates `fullText` and `fullTextUrl` from Congress.gov.
 */
export async function backfillMissingBillTexts(
  limit: number,
  options: BackfillBillTextsOptions = {}
): Promise<TextBackfillSummary> {
  const logger = options.logger ?? defaultLogger;

  if (!Number.isFinite(limit) || limit <= 0) {
    return {
      processed: 0,
      updated: 0,
      urlOnly: 0,
      failed: 0,
      updatedIds: [],
    };
  }

  const bills = await db.bill.findMany({
    where: { fullText: null },
    orderBy: { introducedDate: "desc" },
    take: Math.floor(limit),
    select: {
      id: true,
      billType: true,
      billNumber: true,
      congress: true,
      title: true,
      fullTextUrl: true,
    },
  });

  if (bills.length === 0) {
    logger.info?.("All bills already have full text");
    return {
      processed: 0,
      updated: 0,
      urlOnly: 0,
      failed: 0,
      updatedIds: [],
    };
  }

  const client = options.client ?? new CongressClient({ logger });
  let updated = 0;
  let urlOnly = 0;
  let failed = 0;
  const updatedIds: string[] = [];

  for (const bill of bills) {
    try {
      const textData = await client.fetchBillText(
        bill.congress,
        bill.billType,
        bill.billNumber
      );

      if (textData?.content && textData.content.trim().length > 0) {
        await db.bill.update({
          where: { id: bill.id },
          data: {
            fullText: textData.content,
            ...(textData.url?.trim() ? { fullTextUrl: textData.url } : {}),
          },
        });
        updated += 1;
        updatedIds.push(bill.id);
      } else if (textData?.url?.trim()) {
        await db.bill.update({
          where: { id: bill.id },
          data: {
            fullTextUrl: textData.url,
          },
        });
        urlOnly += 1;
      } else {
        failed += 1;
        logger.warn?.("No bill text available yet", {
          billId: bill.id,
          congress: bill.congress,
          billType: bill.billType,
          billNumber: bill.billNumber,
        });
      }
    } catch (error) {
      failed += 1;
      logger.warn?.("Failed to backfill bill text", {
        billId: bill.id,
        congress: bill.congress,
        billType: bill.billType,
        billNumber: bill.billNumber,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    processed: bills.length,
    updated,
    urlOnly,
    failed,
    updatedIds,
  };
}
