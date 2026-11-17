import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  FallbackCapReachedError,
  GEMINI_FALLBACK_JOB_NAME,
  GEMINI_FALLBACK_MODEL,
} from "@/lib/llm/types";

const DEFAULT_GEMINI_FALLBACK_DAILY_LIMIT = 20;

export interface CallGeminiStructuredOptions<T> {
  systemInstruction: string;
  prompt: string;
  schema: z.ZodType<T>;
  jsonSchema: Record<string, unknown>;
  itemIds: string[];
}

export interface GeminiStructuredResult<T> {
  data: T;
  model: typeof GEMINI_FALLBACK_MODEL;
}

export interface GeminiFallbackQuota {
  used: number;
  limit: number;
  remaining: number;
}

/**
 * Returns the UTC midnight timestamp (`00:00:00.000Z`) for the provided date.
 */
export function getUtcDayStart(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  );
}

/**
 * Parses `GEMINI_FALLBACK_DAILY_LIMIT`, preserving `0` when explicitly set.
 */
export function getGeminiFallbackDailyLimit(
  envObj: Partial<NodeJS.ProcessEnv> = process.env
): number {
  const raw = envObj.GEMINI_FALLBACK_DAILY_LIMIT?.trim();
  if (!raw) return DEFAULT_GEMINI_FALLBACK_DAILY_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_GEMINI_FALLBACK_DAILY_LIMIT;
  }
  return parsed;
}

function isGeminiFallbackEnabled(
  envObj: Partial<NodeJS.ProcessEnv> = process.env
): boolean {
  const raw = envObj.GEMINI_FALLBACK_ENABLED?.trim().toLowerCase();
  return raw !== "false" && raw !== "0";
}

function extractJsonPayload(rawText: string): string {
  const trimmed = rawText.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }
  return trimmed;
}

/**
 * Queries today's UTC `JobRun` records for `llm-fallback:gemini-3.8-flash`
 * and returns daily usage, configured cap, and remaining calls.
 */
export async function getRemainingGeminiFallbackQuota(): Promise<GeminiFallbackQuota> {
  const limit = getGeminiFallbackDailyLimit();
  const utcDayStart = getUtcDayStart();
  const used = await db.jobRun.count({
    where: {
      jobName: GEMINI_FALLBACK_JOB_NAME,
      startedAt: { gte: utcDayStart },
    },
  });

  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

/**
 * Invokes Gemini 3.8 Flash directly via `@google/genai` `interactions.create`
 * (`store: false`, structured JSON output) only when enabled, configured with
 * `GEMINI_API_KEY`, and strictly under the daily `JobRun` quota cap.
 */
export async function callGeminiStructured<T>(
  opts: CallGeminiStructuredOptions<T>
): Promise<GeminiStructuredResult<T>> {
  if (!isGeminiFallbackEnabled()) {
    throw new FallbackCapReachedError(
      "Gemini fallback is disabled via GEMINI_FALLBACK_ENABLED",
      { reason: "disabled" }
    );
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new FallbackCapReachedError("GEMINI_API_KEY is not configured", {
      reason: "missing-api-key",
    });
  }

  const limit = getGeminiFallbackDailyLimit();
  const jobRun = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(948271)`;

    const utcDayStart = getUtcDayStart();
    const used = await tx.jobRun.count({
      where: {
        jobName: GEMINI_FALLBACK_JOB_NAME,
        startedAt: { gte: utcDayStart },
      },
    });

    if (used >= limit) {
      throw new FallbackCapReachedError(
        `Gemini daily fallback cap reached (${used}/${limit})`,
        {
          reason: "daily-cap-reached",
          used,
          limit,
        }
      );
    }

    return tx.jobRun.create({
      data: {
        jobName: GEMINI_FALLBACK_JOB_NAME,
        status: "RUNNING",
        metadata: {
          model: GEMINI_FALLBACK_MODEL,
          itemIds: opts.itemIds,
        },
      },
    });
  });

  try {
    const client = new GoogleGenAI({ apiKey });
    const interaction = await client.interactions.create({
      model: GEMINI_FALLBACK_MODEL,
      store: false,
      system_instruction: opts.systemInstruction,
      input: opts.prompt,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: opts.jsonSchema,
      },
    });

    if (interaction.status !== "completed") {
      throw new Error(
        `Gemini interaction ended with status "${String(interaction.status)}"`
      );
    }

    const rawText = interaction.output_text?.trim();
    if (!rawText) {
      throw new Error("Gemini interaction returned empty output_text");
    }

    const parsedJson: unknown = JSON.parse(extractJsonPayload(rawText));
    const data = opts.schema.parse(parsedJson);

    await db.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        itemsProcessed: opts.itemIds.length,
      },
    });

    return {
      data,
      model: GEMINI_FALLBACK_MODEL,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    try {
      await db.jobRun.update({
        where: { id: jobRun.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          itemsFailed: opts.itemIds.length,
          error: errorMessage,
        },
      });
    } catch (updateErr) {
      console.error(
        "[GEMINI_FALLBACK] Failed to update JobRun failure status:",
        updateErr
      );
    }
    throw err;
  }
}
