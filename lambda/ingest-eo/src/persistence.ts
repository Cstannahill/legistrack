import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger, Logger } from "./logger.js";
import type {
  HydratedExecutiveOrder,
  PersistedExecutiveOrderResult,
} from "./types.js";

type Supabase = SupabaseClient<any, "public", any>;

type PreservableField =
  | "fullText"
  | "fullTextUrl"
  | "presidentName"
  | "sourceUrl"
  | "federalRegisterUrl";

interface ExecutiveOrderRecord
  extends Record<PreservableField, string | null> {
  id: string;
}

interface BaseExecutiveOrderData {
  orderNumber: number;
  executiveOrderType: string;
  title: string;
  signingDate: string;
  publicationDate: string | null;
  fullText: string | null;
  fullTextUrl: string | null;
  federalRegisterUrl: string | null;
  presidentName: string;
  sourceUrl: string | null;
  lastFetchedAt: string;
  updatedAt: string;
}

const PRESERVE_FIELDS: PreservableField[] = [
  "fullText",
  "fullTextUrl",
  "presidentName",
  "sourceUrl",
  "federalRegisterUrl",
];

function buildBaseData(
  data: HydratedExecutiveOrder,
  fetchedAt: string
): BaseExecutiveOrderData {
  return {
    orderNumber: data.orderNumber,
    executiveOrderType: data.executiveOrderType,
    title: data.title,
    signingDate: data.signingDate.toISOString(),
    publicationDate: data.publicationDate
      ? data.publicationDate.toISOString()
      : null,
    fullText: data.fullText ?? null,
    fullTextUrl: data.fullTextUrl ?? null,
    federalRegisterUrl: data.federalRegisterUrl ?? null,
    presidentName: data.presidentName ?? "Unknown",
    sourceUrl: data.sourceUrl ?? null,
    lastFetchedAt: fetchedAt,
    updatedAt: fetchedAt,
  };
}

function mergeWithExisting(
  baseData: BaseExecutiveOrderData,
  existing?: ExecutiveOrderRecord | null
): BaseExecutiveOrderData {
  if (!existing) {
    return baseData;
  }

  const merged: BaseExecutiveOrderData = { ...baseData };
  for (const field of PRESERVE_FIELDS) {
    const incoming = merged[field];
    if (
      (incoming === null ||
        incoming === undefined ||
        (typeof incoming === "string" && incoming.trim() === "")) &&
      existing[field] !== undefined &&
      existing[field] !== null
    ) {
      merged[field] = existing[field];
    }
  }
  return merged;
}

export interface PersistExecutiveOrderOptions {
  supabase: Supabase;
  data: HydratedExecutiveOrder;
  logger?: Logger;
}

export async function persistExecutiveOrder(
  options: PersistExecutiveOrderOptions
): Promise<PersistedExecutiveOrderResult> {
  const { supabase, data } = options;
  const logger = options.logger ?? createLogger({ context: "eo-persist" });
  const identifier = `${data.orderNumber}-${data.title}`;

  try {
    const { data: existingData, error: existingError } = await supabase
      .from("ExecutiveOrder")
      .select(
        ["id", "fullText", "fullTextUrl", "presidentName", "sourceUrl", "federalRegisterUrl"].join(
          ","
        )
      )
      .eq("orderNumber", data.orderNumber)
      .maybeSingle();

    if (existingError) {
      throw new Error(
        `Failed to lookup executive order ${identifier}: ${existingError.message}`
      );
    }

    const existing = existingData as ExecutiveOrderRecord | null;
    const fetchedAt = new Date().toISOString();
    const baseData = buildBaseData(data, fetchedAt);

    if (existing?.id) {
      const mergedData = mergeWithExisting(baseData, existing);
      const { data: updated, error: updateError } = await supabase
        .from("ExecutiveOrder")
        .update(mergedData)
        .eq("id", existing.id)
        .select("id")
        .single();

      if (updateError) {
        throw new Error(
          `Failed to update executive order ${identifier}: ${updateError.message}`
        );
      }

      logger.info("Updated executive order", {
        identifier,
        executiveOrderId: updated.id,
      });
      return { action: "updated", identifier, executiveOrderId: updated.id };
    }

    const newId = randomUUID();
    const { data: created, error: insertError } = await supabase
      .from("ExecutiveOrder")
      .insert([{ id: newId, ...baseData, createdAt: fetchedAt }])
      .select("id")
      .single();

    if (insertError) {
      throw new Error(
        `Failed to create executive order ${identifier}: ${insertError.message}`
      );
    }

    logger.info("Created executive order", {
      identifier,
      executiveOrderId: created.id ?? newId,
    });
    return {
      action: "created",
      identifier,
      executiveOrderId: created.id ?? newId,
    };
  } catch (error) {
    logger.error("Failed to persist executive order", {
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
