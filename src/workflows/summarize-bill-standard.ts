import { db } from "@/lib/db";
import { fetchBillDetails, fetchBillText } from "@/lib/api/congress";
import { BillStatus } from "@prisma/client";
import { generateSummary, type SummaryType } from "@/lib/ai/summarizer";
import { generateSummaryOpenAI } from "@/lib/ai/summarizer-openai";
import {
  generateSummaryOpenRouter,
  getAvailableModels,
  isValidModel,
  type OpenRouterModel,
} from "@/lib/ai/summarizer-openrouter";

export type SummaryProvider = "openai" | "anthropic" | "openrouter";

type LoggerFn = (message: string) => void;

type SummaryReturn = Awaited<ReturnType<typeof generateSummary>>;

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
  if (!latestActionText) return "INTRODUCED";

  const actionLower = latestActionText.toLowerCase();

  if (
    actionLower.includes("became public law") ||
    actionLower.includes("signed by president")
  ) {
    return "BECAME_LAW";
  }

  if (
    actionLower.includes("vetoed") ||
    actionLower.includes("returned unsigned")
  ) {
    return "VETOED";
  }

  if (
    actionLower.includes("presented to president") ||
    actionLower.includes("sent to president")
  ) {
    return "PRESENTED_TO_PRESIDENT";
  }

  if (
    actionLower.includes("conference") ||
    actionLower.includes("resolving differences")
  ) {
    return "RESOLVING_DIFFERENCES";
  }

  if (
    actionLower.includes("passed senate") ||
    actionLower.includes("agreed to in senate")
  ) {
    return "PASSED_SENATE";
  }

  if (
    actionLower.includes("passed house") ||
    actionLower.includes("agreed to in house")
  ) {
    return "PASSED_HOUSE";
  }

  if (
    actionLower.includes("reported by committee") ||
    actionLower.includes("committee discharged")
  ) {
    return "REPORTED_BY_COMMITTEE";
  }

  if (
    actionLower.includes("referred to") ||
    actionLower.includes("committee")
  ) {
    return "REFERRED_TO_COMMITTEE";
  }

  if (
    actionLower.includes("failed") ||
    actionLower.includes("rejected") ||
    actionLower.includes("not agreed to")
  ) {
    return "FAILED";
  }

  return "INTRODUCED";
}

function resolveProvider(rawModel?: string | null): SummaryProvider {
  if (!rawModel) return "openai";
  const normalized = rawModel.toLowerCase() as SummaryProvider;
  return SUPPORTED_MODELS.includes(normalized) ? normalized : "openai";
}

function resolveOpenRouterModel(
  preferredModel?: string | null
): OpenRouterModel {
  const defaultModel: OpenRouterModel = "deepseek";
  if (!preferredModel) {
    return defaultModel;
  }

  const normalized = preferredModel.toLowerCase();
  if (isValidModel(normalized)) {
    return normalized as OpenRouterModel;
  }

  return defaultModel;
}

export async function summarizeBillStandard(
  options: SummarizeBillStandardOptions
): Promise<SummarizeBillStandardResult> {
  const {
    billId,
    aiModel,
    openRouterModel,
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
    const openRouterChoice = resolveOpenRouterModel(
      openRouterModel ?? process.env.OPENROUTER_MODEL
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
      summaryResult = (await generateSummaryOpenAI({
        ...summaryInput,
      })) as SummaryReturn;
      modelName = summaryResult.model;
    } else if (provider === "anthropic") {
      summaryResult = await generateSummary({
        ...summaryInput,
      });
      modelName = summaryResult.model;
    } else {
      const resolvedModel = getAvailableModels().find(
        (model) => model.key === openRouterChoice
      );
      log(
        `   🌐 Using OpenRouter model ${
          resolvedModel?.name || openRouterChoice
        } (${openRouterChoice})`
      );
      summaryResult = (await generateSummaryOpenRouter({
        ...summaryInput,
        model: openRouterChoice,
      })) as SummaryReturn;
      modelName = summaryResult.model;
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
