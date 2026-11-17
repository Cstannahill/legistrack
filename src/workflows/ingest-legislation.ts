import { start } from "workflow/api";
import {
  fetchBillListStep,
  ingestBillChunkStep,
  type IngestItemError,
} from "@/workflows/steps/ingest-legislation";
import {
  completeJobRunStep,
  createJobRunStep,
  failJobRunStep,
  revalidateLegislationPathsStep,
} from "@/workflows/steps/job-runs";
import { summarizeLegislationWorkflow } from "@/workflows/summarize-legislation";

const BILL_INGEST_CHUNK_SIZE = 10;
const MAX_SUMMARY_ERRORS = 50;

export interface IngestLegislationWorkflowInput {
  executionId?: string;
  lookbackDays?: number;
  congress?: number;
  billTypes?: string[];
  startDate?: string;
  endDate?: string;
}

export interface IngestLegislationWorkflowSummary {
  jobRunId: string;
  executionId?: string;
  congress: number;
  windowStart: string;
  windowEnd: string;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  needsSummarizationCount: number;
  revalidated: boolean;
  triggeredSummarization: boolean;
  summarizationRunId?: string;
  errors: IngestItemError[];
}

/**
 * Durable workflow orchestrator that fetches updated Congress.gov bill
 * identifiers, hydrates and persists them in chunks of 10, revalidates
 * public routes on change, and triggers `summarizeLegislationWorkflow` when
 * changed bills have `fullText` awaiting summarization or categorization.
 */
export async function ingestLegislationWorkflow(
  input: IngestLegislationWorkflowInput = {}
): Promise<IngestLegislationWorkflowSummary> {
  "use workflow";

  const initialMetadata: Record<string, unknown> = {};
  if (input.executionId !== undefined) {
    initialMetadata.executionId = input.executionId;
  }
  if (input.lookbackDays !== undefined) {
    initialMetadata.lookbackDays = input.lookbackDays;
  }
  if (input.congress !== undefined) {
    initialMetadata.congress = input.congress;
  }
  if (input.billTypes !== undefined) {
    initialMetadata.billTypes = input.billTypes;
  }

  const jobRunId = await createJobRunStep(
    "ingest-legislation",
    Object.keys(initialMetadata).length > 0 ? initialMetadata : undefined
  );

  try {
    const list = await fetchBillListStep({
      lookbackDays: input.lookbackDays,
      congress: input.congress,
      billTypes: input.billTypes,
      startDate: input.startDate,
      endDate: input.endDate,
    });

    let processed = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    let needsSummarizationCount = 0;
    const errors: IngestItemError[] = [];

    for (let i = 0; i < list.items.length; i += BILL_INGEST_CHUNK_SIZE) {
      const chunk = list.items.slice(i, i + BILL_INGEST_CHUNK_SIZE);
      const outcome = await ingestBillChunkStep(chunk);

      processed += outcome.processed;
      created += outcome.created;
      updated += outcome.updated;
      skipped += outcome.skipped;
      failed += outcome.failed;
      needsSummarizationCount += outcome.needsSummarizationCount;

      for (const entry of outcome.errors) {
        if (errors.length < MAX_SUMMARY_ERRORS) {
          errors.push(entry);
        }
      }
    }

    let revalidated = false;
    if (created + updated > 0) {
      await revalidateLegislationPathsStep();
      revalidated = true;
    }

    let triggeredSummarization = false;
    let summarizationRunId: string | undefined;
    let summarizationTriggerError: string | undefined;

    if (needsSummarizationCount > 0) {
      try {
        const childInput =
          input.executionId !== undefined
            ? { executionId: input.executionId }
            : {};
        const childRun = await start(summarizeLegislationWorkflow, [
          childInput,
        ]);
        triggeredSummarization = true;
        summarizationRunId = childRun?.runId;
      } catch (triggerErr) {
        summarizationTriggerError =
          triggerErr instanceof Error ? triggerErr.message : String(triggerErr);
        console.warn(
          "[ingest-legislation] Failed to start summarizeLegislationWorkflow:",
          summarizationTriggerError
        );
      }
    }

    await completeJobRunStep(jobRunId, {
      itemsProcessed: created + updated,
      itemsFailed: failed,
      metadata: {
        ...initialMetadata,
        congress: list.congress,
        windowStart: list.windowStart,
        windowEnd: list.windowEnd,
        processed,
        created,
        updated,
        skipped,
        failed,
        needsSummarizationCount,
        revalidated,
        triggeredSummarization,
        ...(summarizationRunId !== undefined ? { summarizationRunId } : {}),
        ...(summarizationTriggerError !== undefined
          ? { summarizationTriggerError }
          : {}),
      },
    });

    return {
      jobRunId,
      ...(input.executionId !== undefined
        ? { executionId: input.executionId }
        : {}),
      congress: list.congress,
      windowStart: list.windowStart,
      windowEnd: list.windowEnd,
      processed,
      created,
      updated,
      skipped,
      failed,
      needsSummarizationCount,
      revalidated,
      triggeredSummarization,
      ...(summarizationRunId !== undefined ? { summarizationRunId } : {}),
      errors,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    try {
      await failJobRunStep(jobRunId, errorMessage);
    } catch {
      // Preserve the original workflow error if JobRun failure update fails
    }
    throw err;
  }
}
