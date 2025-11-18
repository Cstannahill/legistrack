import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCongressGovBillUrl } from "./congressUrl.js";
import type { CongressClient } from "./congressClient.js";
import { createLogger, Logger } from "./logger.js";
import type {
  BillStatus,
  CongressPersonReference,
  HydratedBillData,
  PersistedBillResult,
} from "./types.js";
import {
  buildBillIdentifier,
  normalizePersonName,
  resolveStatus,
} from "./utils.js";

type Supabase = SupabaseClient<any, "public", any>;

const BILL_COSPONSOR_TABLE = "_Cosponsored";
const BILL_COLUMN = "A";
const MEMBER_COLUMN = "B";

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
  supabase: Supabase,
  reference: CongressPersonReference | undefined,
  client: CongressClient,
  logger: Logger
): Promise<string | undefined> {
  if (!reference?.bioguideId) {
    return undefined;
  }

  const { data: existing, error: lookupError } = await supabase
    .from("Member")
    .select("id")
    .eq("bioguideId", reference.bioguideId)
    .maybeSingle();

  if (lookupError) {
    throw new Error(
      `Failed to lookup member ${reference.bioguideId}: ${lookupError.message}`
    );
  }

  if (existing?.id) {
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
    (term?.startYear
      ? new Date(`${term.startYear}-01-03T00:00:00Z`)
      : new Date());
  const termEnd =
    parseDate(term?.endDate) ??
    (term?.endYear ? new Date(`${term.endYear}-01-03T00:00:00Z`) : undefined);

  const state = member?.state ?? term?.state ?? reference.state;
  const party = member?.party ?? term?.party ?? reference.party ?? "Unknown";
  const districtRaw = member?.district ?? term?.district ?? reference.district;
  const district = districtRaw
    ? Number.parseInt(String(districtRaw), 10)
    : null;

  if (!chamber || !state) {
    logger.warn("Unable to create member due to missing chamber or state", {
      bioguideId: reference.bioguideId,
      chamber,
      state,
    });
    return undefined;
  }

  const now = new Date().toISOString();
  const insertPayload = {
    id: randomUUID(),
    bioguideId: reference.bioguideId,
    firstName: normalizedNames.firstName || "Unknown",
    lastName: normalizedNames.lastName || "Unknown",
    fullName:
      normalizedNames.fullName ||
      `${normalizedNames.firstName} ${normalizedNames.lastName}`.trim(),
    chamber,
    state,
    party,
    district,
    termStart: termStart?.toISOString() ?? now,
    termEnd: termEnd ? termEnd.toISOString() : null,
    imageUrl: member?.depiction?.url ?? null,
    websiteUrl: member?.website ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const { data: created, error: insertError } = await supabase
    .from("Member")
    .insert(insertPayload)
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: raced } = await supabase
        .from("Member")
        .select("id")
        .eq("bioguideId", reference.bioguideId)
        .maybeSingle();
      if (raced?.id) {
        logger.warn("Member already existed after race", {
          bioguideId: reference.bioguideId,
        });
        return raced.id;
      }
    }
    throw new Error(
      `Failed to create member ${reference.bioguideId}: ${insertError.message}`
    );
  }

  logger.info("Created member", {
    bioguideId: reference.bioguideId,
    memberId: created.id,
  });
  return created.id;
}

function buildBillData(
  data: HydratedBillData,
  billType: string,
  billNumber: number,
  sponsorId: string | undefined,
  fallbackIntroducedDate: Date,
  status: BillStatus,
  statusDate: Date,
  fetchedAt: string
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
    introducedDate: fallbackIntroducedDate.toISOString(),
    currentStatus: status,
    statusDate: statusDate.toISOString(),
    lawNumber: data.bill.laws?.[0]?.lawNumber ?? null,
    fullText: data.text?.content ?? null,
    fullTextUrl: data.text?.url ?? null,
    sponsorId: sponsorId ?? null,
    sourceUrl,
    lastFetchedAt: fetchedAt,
    updatedAt: fetchedAt,
  };
}

type BillBaseData = ReturnType<typeof buildBillData>;
type BillOptionalField =
  | "officialTitle"
  | "shortTitle"
  | "lawNumber"
  | "fullText"
  | "fullTextUrl"
  | "sponsorId"
  | "sourceUrl";

type ExistingBillRecord = {
  id: string;
} & Pick<BillBaseData, BillOptionalField>;

const PRESERVE_WHEN_EMPTY_FIELDS: BillOptionalField[] = [
  "officialTitle",
  "shortTitle",
  "lawNumber",
  "fullText",
  "fullTextUrl",
  "sponsorId",
  "sourceUrl",
];

function mergeBillDataWithExisting(
  baseData: BillBaseData,
  existing?: ExistingBillRecord | null
): BillBaseData {
  if (!existing) {
    return baseData;
  }

  const merged: BillBaseData = { ...baseData };
  for (const field of PRESERVE_WHEN_EMPTY_FIELDS) {
    const nextValue = merged[field];
    if (
      (nextValue === null ||
        nextValue === undefined ||
        (typeof nextValue === "string" && nextValue.trim() === "")) &&
      existing[field] !== undefined &&
      existing[field] !== null
    ) {
      merged[field] = existing[field];
    }
  }
  return merged;
}

interface ActionRecord {
  id: string;
  billId: string;
  actionDate: string;
  actionType: string;
  actionCode: string | null;
  text: string;
  createdAt: string;
}

function mapActionRecords(
  billId: string,
  actions: HydratedBillData["actions"],
  ingestedAt: string
): ActionRecord[] {
  const records: ActionRecord[] = [];
  for (const action of actions) {
    const actionDate = parseDate(action.actionDate);
    if (!actionDate) {
      continue;
    }
    const rawActionCode = action.sourceSystem?.code;
    const actionCode =
      rawActionCode === null || rawActionCode === undefined
        ? null
        : String(rawActionCode);
    records.push({
      id: randomUUID(),
      billId,
      actionDate: actionDate.toISOString(),
      actionType: action.sourceSystem?.name ?? "Unknown",
      actionCode,
      text: action.text ?? "",
      createdAt: ingestedAt,
    });
  }
  return records;
}

interface AmendmentRecord {
  id: string;
  billId: string;
  amendmentNumber: string;
  amendmentType: string;
  congress: number;
  purpose: string | null;
  description: string | null;
  status: string;
  statusDate: string;
  sponsorId?: string | null;
  proposedDate: string;
  sourceUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapAmendmentRecords(
  billId: string,
  amendments: HydratedBillData["amendments"],
  sponsorLookup: Map<string, string>,
  ingestedAt: string
): AmendmentRecord[] {
  return amendments.flatMap((amendment) => {
    const number = amendment.number;
    const type = amendment.type;
    const congress = amendment.congress;
    if (!number || !type || !congress) {
      return [];
    }

    const statusDate =
      parseDate(amendment.statusDate) ?? /* fall back to now */ new Date();
    const sponsorBioguide = amendment.sponsor?.bioguideId;
    const sponsorId = sponsorBioguide
      ? sponsorLookup.get(sponsorBioguide)
      : undefined;

    const isoStatusDate = statusDate.toISOString();
    const record: AmendmentRecord = {
      id: randomUUID(),
      billId,
      amendmentNumber: number,
      amendmentType: type,
      congress,
      purpose: amendment.purpose ?? null,
      description: amendment.description ?? null,
      status: amendment.status ?? "Unknown",
      statusDate: isoStatusDate,
      sponsorId: sponsorId ?? null,
      proposedDate: isoStatusDate,
      sourceUrl: null,
      createdAt: ingestedAt,
      updatedAt: ingestedAt,
    };

    return [record];
  });
}

async function replaceBillCosponsors(
  supabase: Supabase,
  billId: string,
  cosponsorIds: string[]
) {
  const { error: deleteError } = await supabase
    .from(BILL_COSPONSOR_TABLE)
    .delete()
    .eq(BILL_COLUMN, billId);
  if (deleteError) {
    throw new Error(
      `Failed to reset cosponsors for bill ${billId}: ${deleteError.message}`
    );
  }

  if (cosponsorIds.length === 0) {
    return;
  }

  const rows = cosponsorIds.map((memberId) => ({
    [BILL_COLUMN]: billId,
    [MEMBER_COLUMN]: memberId,
  }));

  const { error: insertError } = await supabase
    .from(BILL_COSPONSOR_TABLE)
    .insert(rows);
  if (insertError) {
    throw new Error(
      `Failed to insert cosponsors for bill ${billId}: ${insertError.message}`
    );
  }
}

export interface PersistOptions {
  data: HydratedBillData;
  client: CongressClient;
  supabase: Supabase;
  logger?: Logger;
}

export async function persistHydratedBill(
  options: PersistOptions
): Promise<PersistedBillResult> {
  const { data, client, supabase } = options;
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
    const sponsorId = await ensureMember(
      supabase,
      sponsorReference,
      client,
      logger.child("member")
    );

    const billTypeRaw = data.bill.billType ?? data.bill.type ?? "";
    const billType = billTypeRaw.toLowerCase();
    const billNumber = Number.parseInt(
      data.bill.billNumber ?? data.bill.number ?? "0",
      10
    );
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

    const { data: existingData, error: existingError } = await supabase
      .from("Bill")
      .select(
        [
          "id",
          "officialTitle",
          "shortTitle",
          "lawNumber",
          "fullText",
          "fullTextUrl",
          "sponsorId",
          "sourceUrl",
        ].join(",")
      )
      .eq("congress", data.bill.congress ?? 0)
      .eq("billType", billType)
      .eq("billNumber", billNumber)
      .maybeSingle();
    const existing = existingData as ExistingBillRecord | null;

    if (existingError) {
      throw new Error(
        `Failed to lookup bill ${identifier}: ${existingError.message}`
      );
    }

    const fetchedAt = new Date().toISOString();
    const baseData = buildBillData(
      data,
      billType,
      billNumber,
      sponsorId,
      fallbackIntroducedDate,
      status,
      statusDate,
      fetchedAt
    );

    let billId: string;
    let action: PersistedBillResult["action"] = "updated";

    if (existing?.id) {
      const mergedData = mergeBillDataWithExisting(baseData, existing);
      const { data: updated, error: updateError } = await supabase
        .from("Bill")
        .update(mergedData)
        .eq("id", existing.id)
        .select("id")
        .single();
      if (updateError) {
        throw new Error(
          `Failed to update bill ${identifier}: ${updateError.message}`
        );
      }
      billId = updated.id;
    } else {
      const newBillId = randomUUID();
      const { data: created, error: insertError } = await supabase
        .from("Bill")
        .insert({ id: newBillId, ...baseData, createdAt: fetchedAt })
        .select("id")
        .single();
      if (insertError) {
        throw new Error(
          `Failed to create bill ${identifier}: ${insertError.message}`
        );
      }
      billId = created.id ?? newBillId;
      action = "created";
    }

    const cosponsorIds: string[] = [];
    const sponsorLookup = new Map<string, string>();
    if (sponsorReference?.bioguideId && sponsorId) {
      sponsorLookup.set(sponsorReference.bioguideId, sponsorId);
    }

    for (const cosponsor of data.cosponsors) {
      const id = await ensureMember(
        supabase,
        cosponsor,
        client,
        logger.child("cosponsor")
      );
      if (id) {
        cosponsorIds.push(id);
        if (cosponsor.bioguideId) {
          sponsorLookup.set(cosponsor.bioguideId, id);
        }
      }
    }

    await replaceBillCosponsors(supabase, billId, cosponsorIds);

    const actionRecords = mapActionRecords(billId, data.actions, fetchedAt);
    const { error: deleteActionsError } = await supabase
      .from("Action")
      .delete()
      .eq("billId", billId);
    if (deleteActionsError) {
      throw new Error(
        `Failed to delete prior actions for ${identifier}: ${deleteActionsError.message}`
      );
    }
    if (actionRecords.length > 0) {
      const { error: insertActionsError } = await supabase
        .from("Action")
        .insert(actionRecords);
      if (insertActionsError) {
        throw new Error(
          `Failed to insert actions for ${identifier}: ${insertActionsError.message}`
        );
      }
    }

    const amendmentRecords = mapAmendmentRecords(
      billId,
      data.amendments,
      sponsorLookup,
      fetchedAt
    );
    const { error: deleteAmendmentsError } = await supabase
      .from("Amendment")
      .delete()
      .eq("billId", billId);
    if (deleteAmendmentsError) {
      throw new Error(
        `Failed to delete prior amendments for ${identifier}: ${deleteAmendmentsError.message}`
      );
    }
    if (amendmentRecords.length > 0) {
      const { error: insertAmendmentsError } = await supabase
        .from("Amendment")
        .insert(amendmentRecords);
      if (insertAmendmentsError) {
        throw new Error(
          `Failed to insert amendments for ${identifier}: ${insertAmendmentsError.message}`
        );
      }
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
