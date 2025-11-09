import type { BillStatus } from "@prisma/client";
import { db } from "../../src/lib/db";
import { getCongressGovBillUrl } from "../../src/lib/utils/congress-url";
import type { CongressClient } from "./congressClient";
import { createLogger, Logger } from "../logger";
import type {
  CongressPersonReference,
  HydratedBillData,
  PersistedBillResult,
} from "./types";
import {
  buildBillIdentifier,
  normalizePersonName,
  resolveStatus,
} from "./utils";

function parseDate(value?: string | null, fallback?: Date): Date | undefined {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return date;
}

function deriveChamber(input?: string | null): "HOUSE" | "SENATE" | undefined {
  if (!input) return undefined;
  const normalized = input.toLowerCase();
  if (["house", "h", "house of representatives"].includes(normalized)) {
    return "HOUSE";
  }
  if (["senate", "s"].includes(normalized)) {
    return "SENATE";
  }
  return undefined;
}

async function ensureMember(
  reference: CongressPersonReference | undefined,
  client: CongressClient,
  logger: Logger
): Promise<string | undefined> {
  if (!reference?.bioguideId) {
    return undefined;
  }

  const existing = await db.member.findUnique({
    where: { bioguideId: reference.bioguideId },
  });

  if (existing) {
    return existing.id;
  }

  const detail = await client.fetchMember(reference.bioguideId);
  const member = detail?.member;

  const normalizedNames = normalizePersonName({
    firstName: member?.firstName ?? reference.firstName,
    lastName: member?.lastName ?? reference.lastName,
    fullName: member?.officialName ?? reference.fullName,
  });

  const chamber =
    deriveChamber(member?.chamber?.code) ??
    deriveChamber(member?.chamber?.name) ??
    deriveChamber(reference.chamber ?? undefined) ??
    deriveChamber(member?.terms?.[0]?.chamber);

  const term = member?.terms?.[0];
  const termStart =
    parseDate(term?.startDate) ??
    (term?.startYear ? new Date(`${term.startYear}-01-03T00:00:00Z`) : new Date());
  const termEnd = parseDate(term?.endDate) ??
    (term?.endYear ? new Date(`${term.endYear}-01-03T00:00:00Z`) : undefined);

  const state = member?.state ?? term?.state ?? reference.state;
  const party = member?.party ?? term?.party ?? reference.party ?? "Unknown";
  const districtRaw = member?.district ?? term?.district ?? reference.district;
  const district = districtRaw ? Number.parseInt(String(districtRaw), 10) : null;

  if (!chamber || !state) {
    logger.warn("Unable to create member due to missing chamber or state", {
      bioguideId: reference.bioguideId,
      chamber,
      state,
    });
    return undefined;
  }

  const created = await db.member.create({
    data: {
      bioguideId: reference.bioguideId,
      firstName: normalizedNames.firstName || "Unknown",
      lastName: normalizedNames.lastName || "Unknown",
      fullName: normalizedNames.fullName || `${normalizedNames.firstName} ${normalizedNames.lastName}`.trim(),
      chamber,
      state,
      party,
      district: district ?? undefined,
      termStart,
      termEnd: termEnd ?? undefined,
      imageUrl: member?.depiction?.url ?? undefined,
      websiteUrl: member?.website ?? undefined,
    },
  });

  logger.info("Created member", { bioguideId: reference.bioguideId, memberId: created.id });
  return created.id;
}

function buildBillData(
  data: HydratedBillData,
  billType: string,
  billNumber: number,
  sponsorId: string | undefined,
  fallbackIntroducedDate: Date,
  status: BillStatus,
  statusDate: Date
) {
  const sourceUrl = getCongressGovBillUrl(
    data.bill.congress ?? 0,
    billType,
    billNumber
  );

  return {
    billType,
    billNumber,
    congress: data.bill.congress ?? 0,
    title: data.bill.title ?? "",
    officialTitle: data.bill.title ?? null,
    shortTitle: data.bill.shortTitle ?? null,
    introducedDate: fallbackIntroducedDate,
    currentStatus: status,
    statusDate,
    lawNumber: data.bill.laws?.[0]?.lawNumber ?? null,
    fullText: data.text?.content ?? null,
    fullTextUrl: data.text?.url ?? null,
    sponsorId,
    sourceUrl,
    lastFetchedAt: new Date(),
  };
}

function mapActionRecords(billId: string, actions: HydratedBillData["actions"]) {
  return actions
    .map((action) => {
      const actionDate = parseDate(action.actionDate);
      if (!actionDate) return undefined;
      return {
        billId,
        actionDate,
        actionType: action.sourceSystem?.name ?? "Unknown",
        actionCode: action.sourceSystem?.code ?? null,
        text: action.text ?? "",
      };
    })
    .filter((record): record is {
      billId: string;
      actionDate: Date;
      actionType: string;
      actionCode: string | null;
      text: string;
    } => Boolean(record));
}

function mapAmendmentRecords(
  billId: string,
  amendments: HydratedBillData["amendments"],
  sponsorLookup: Map<string, string>
) {
  return amendments
    .map((amendment) => {
      const number = amendment.number;
      const type = amendment.type;
      const congress = amendment.congress;
      if (!number || !type || !congress) {
        return undefined;
      }

      const statusDate = parseDate(amendment.statusDate) ?? new Date();
      const sponsorBioguide = amendment.sponsor?.bioguideId;
      const sponsorId = sponsorBioguide ? sponsorLookup.get(sponsorBioguide) : undefined;

      return {
        billId,
        amendmentNumber: number,
        amendmentType: type,
        congress,
        purpose: amendment.purpose ?? null,
        description: amendment.description ?? null,
        status: amendment.status ?? "Unknown",
        statusDate,
        sponsorId,
        proposedDate: statusDate,
        sourceUrl: undefined,
      };
    })
    .filter((record): record is {
      billId: string;
      amendmentNumber: string;
      amendmentType: string;
      congress: number;
      purpose: string | null;
      description: string | null;
      status: string;
      statusDate: Date;
      sponsorId: string | undefined;
      proposedDate: Date;
      sourceUrl: string | undefined;
    } => Boolean(record));
}

export interface PersistOptions {
  data: HydratedBillData;
  client: CongressClient;
  logger?: Logger;
}

export async function persistHydratedBill(options: PersistOptions): Promise<PersistedBillResult> {
  const { data, client } = options;
  const logger = options.logger ?? createLogger({ context: "persist" });
  const identifier = buildBillIdentifier(data.bill);

  try {
    const introducedDate =
      parseDate(data.bill.introducedDate) ??
      new Date(data.bill.latestAction?.actionDate ?? Date.now());

    const fallbackIntroducedDate = introducedDate ?? new Date();
    const { status, statusDate } = resolveStatus(
      data.bill,
      data.actions,
      fallbackIntroducedDate
    );

    const sponsorReference = data.bill.sponsor ?? data.bill.sponsors?.[0];
    const sponsorId = await ensureMember(sponsorReference, client, logger.child("member"));

    const billTypeRaw = data.bill.billType ?? data.bill.type ?? "";
    const billType = billTypeRaw.toLowerCase();
    const billNumber = Number.parseInt(data.bill.billNumber ?? data.bill.number ?? "0", 10);
    if (!billType || Number.isNaN(billNumber) || !data.bill.congress) {
      logger.warn("Skipping bill due to incomplete identifier", {
        identifier,
        billType,
        billNumber,
        congress: data.bill.congress,
      });
      return {
        action: "skipped",
        identifier,
        message: "Missing bill type, number, or congress",
      };
    }

    const existing = await db.bill.findFirst({
      where: {
        congress: data.bill.congress ?? 0,
        billType,
        billNumber,
      },
    });

    const baseData = buildBillData(
      data,
      billType,
      billNumber,
      sponsorId,
      fallbackIntroducedDate,
      status,
      statusDate
    );

    let billId: string;
    let action: PersistedBillResult["action"] = "updated";

    if (existing) {
      const updated = await db.bill.update({
        where: { id: existing.id },
        data: baseData,
      });
      billId = updated.id;
    } else {
      const created = await db.bill.create({
        data: baseData,
      });
      billId = created.id;
      action = "created";
    }

    const cosponsorIds: string[] = [];
    const sponsorLookup = new Map<string, string>();
    if (sponsorReference?.bioguideId && sponsorId) {
      sponsorLookup.set(sponsorReference.bioguideId, sponsorId);
    }

    for (const cosponsor of data.cosponsors) {
      const id = await ensureMember(cosponsor, client, logger.child("cosponsor"));
      if (id) {
        cosponsorIds.push(id);
        if (cosponsor.bioguideId) {
          sponsorLookup.set(cosponsor.bioguideId, id);
        }
      }
    }

    await db.bill.update({
      where: { id: billId },
      data: {
        cosponsors: {
          set: [],
          ...(cosponsorIds.length
            ? { connect: cosponsorIds.map((id) => ({ id })) }
            : {}),
        },
      },
    });

    const actionRecords = mapActionRecords(billId, data.actions);
    await db.action.deleteMany({ where: { billId } });
    if (actionRecords.length > 0) {
      await db.action.createMany({ data: actionRecords });
    }

    const amendmentRecords = mapAmendmentRecords(billId, data.amendments, sponsorLookup);
    await db.amendment.deleteMany({ where: { billId } });
    if (amendmentRecords.length > 0) {
      await db.amendment.createMany({ data: amendmentRecords });
    }

    logger.info("Persisted bill", {
      identifier,
      billId,
      action,
      actions: actionRecords.length,
      amendments: amendmentRecords.length,
      cosponsors: cosponsorIds.length,
    });

    return { action, billId, identifier };
  } catch (error) {
    logger.error("Failed to persist bill", {
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
