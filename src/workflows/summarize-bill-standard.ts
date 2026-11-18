import { db } from "@/lib/db";
import { fetchBillDetails, fetchBillText } from "@/lib/api/congress";
import { resolveBillStatusFromText } from "@/lib/ingestion/bill-status";
import { BillStatus } from "@prisma/client";
import type { SummaryType } from "@/lib/ai/summarizer";
import type { OpenRouterModel } from "@/lib/ai/summarizer-openrouter";
import { summarizeAndCategorizeItems } from "@/lib/llm/router";
import type { SummaryProvider } from "@/lib/llm/types";

export type { SummaryProvider };

type LoggerFn = (message: string) => void;

type SummaryReturn = {
  content: string;
  keyPoints: string[];
  impactAreas: string[];
  model: string;
  confidence: number;
};

export interface SummarizeBillStandardOptions {
  billId: string;
  aiModel?: SummaryProvider;
  openRouterModel?: OpenRouterModel;
  skipIfExists?: boolean;
  requireFullText?: boolean;
  logger?: LoggerFn;
}

export interface SummarizeBillStandardResult {
  status: "success" | "skipped" | "error";
  summaryId?: string;
  summaryType?: SummaryType;
  model?: string;
  durationMs?: number;
  reason?: string;
}

const SUPPORTED_MODELS: SummaryProvider[] = [
  "openai",
  "anthropic",
  "openrouter",
];

const defaultLogger: LoggerFn = (message) => console.log(message);

export function determineBillStatus(latestActionText?: string): BillStatus {
  return resolveBillStatusFromText(latestActionText);
}

/**
 * Resolves the active summarization provider, defaulting to `"openrouter"`.
 */
export function resolveProvider(rawModel?: string | null): SummaryProvider {
  if (!rawModel) return "openrouter";
  const normalized = rawModel.trim().toLowerCase() as SummaryProvider;
  return SUPPORTED_MODELS.includes(normalized) ? normalized : "openrouter";
}

export async function summarizeBillStandard(
  options: SummarizeBillStandardOptions
): Promise<SummarizeBillStandardResult> {
  const {
    billId,
    aiModel,
    skipIfExists = true,
    requireFullText = true,
    logger = defaultLogger,
  } = options;

  const log = logger;
  const start = Date.now();

  try {
    const bill = await db.bill.findUnique({
      where: { id: billId },
      include: {
        summaries: skipIfExists
          ? {
              where: { summaryType: "STANDARD" },
              take: 1,
            }
          : false,
      },
    });

    if (!bill) {
      log(`   ❌ Bill not found in database`);
      return { status: "error", reason: "bill-not-found" };
    }

    if (skipIfExists && bill.summaries && bill.summaries.length > 0) {
      log(`   ⏭️  Skipping - STANDARD summary already exists`);
      return { status: "skipped", reason: "summary-exists" };
    }

    const normalizedBillType = bill.billType.toLowerCase();
    const provider = resolveProvider(
      aiModel ?? process.env.AI_MODEL ?? process.env.INGEST_AI_MODEL
    );

    log(`   → Fetching bill details from Congress.gov...`);
    const billDetails = await fetchBillDetails(
      bill.congress,
      normalizedBillType,
      bill.billNumber
    );

    if (!billDetails) {
      log(`   ❌ Bill details missing from Congress.gov`);
      return { status: "error", reason: "bill-details-missing" };
    }

    const currentStatus = determineBillStatus(billDetails.latestAction?.text);

    log(`   → Fetching bill text from Congress.gov...`);
    const textData = await fetchBillText(
      bill.congress,
      normalizedBillType,
      bill.billNumber
    );

    const sourceText = textData?.text ?? null;

    if (!sourceText || sourceText.length < 100) {
      if (requireFullText) {
        log(`   ⚠️  Skipping - full text not available or too short`);
        return { status: "skipped", reason: "missing-text" };
      }
    }

    if (textData?.text || textData?.url) {
      await db.bill.update({
        where: { id: bill.id },
        data: {
          title: billDetails.title || bill.title,
          officialTitle: billDetails.title ?? bill.officialTitle,
          introducedDate: billDetails.introducedDate
            ? new Date(billDetails.introducedDate)
            : bill.introducedDate,
          currentStatus,
          statusDate: billDetails.latestAction?.actionDate
            ? new Date(billDetails.latestAction.actionDate)
            : bill.statusDate,
          sourceUrl: billDetails.url ?? bill.sourceUrl,
          fullText: sourceText ?? bill.fullText,
          fullTextUrl: textData?.url ?? bill.fullTextUrl,
          lastFetchedAt: new Date(),
        },
      });
    }

    const summaryInput = {
      title: bill.title || `${bill.billType.toUpperCase()} ${bill.billNumber}`,
      fullText: sourceText ?? bill.fullText ?? bill.title,
      summaryType: "STANDARD" as SummaryType,
    };

    let modelName = "";
    let summaryResult: SummaryReturn;

    if (provider === "openai") {
      const { generateSummaryOpenAI } = await import(
        "@/lib/ai/summarizer-openai"
      );
      summaryResult = await generateSummaryOpenAI({
        ...summaryInput,
      });
      modelName = summaryResult.model;
    } else if (provider === "anthropic") {
      const { generateSummary } = await import("@/lib/ai/summarizer");
      summaryResult = await generateSummary({
        ...summaryInput,
      });
      modelName = summaryResult.model;
    } else {
      const categories = await db.category.findMany({
        select: { id: true, slug: true, name: true, description: true },
      });
      const [outcome] = await summarizeAndCategorizeItems(
        [
          {
            id: bill.id,
            title: summaryInput.title,
            text: summaryInput.fullText,
            kind: "bill",
          },
        ],
        categories
      );

      if (!outcome || !outcome.ok) {
        throw new Error(
          outcome?.error ?? "OpenRouter/Gemini summarization failed"
        );
      }

      summaryResult = {
        content: outcome.summary,
        keyPoints: outcome.keyPoints,
        impactAreas: outcome.impactAreas,
        model: outcome.aiModel,
        confidence: outcome.confidence ?? 0.8,
      };
      modelName = outcome.aiModel;
    }

    const createdSummary = await db.summary.create({
      data: {
        billId: bill.id,
        summaryType: "STANDARD",
        content: summaryResult.content,
        keyPoints: summaryResult.keyPoints,
        impactAreas: summaryResult.impactAreas,
        aiModel: modelName,
        confidence: summaryResult.confidence,
      },
    });

    const duration = Date.now() - start;
    log(
      `   ✓ Summary saved (${summaryResult.content.length} chars, ${duration}ms)`
    );

    return {
      status: "success",
      summaryId: createdSummary.id,
      summaryType: "STANDARD",
      model: modelName,
      durationMs: duration,
    };
  } catch (error) {
    log(`   ❌ Error generating summary: ${String(error)}`);
    return { status: "error", reason: "exception" };
  }
}
