import { start } from "workflow/api";
import { backfillEoTextsStep } from "@/workflows/steps/ingest-eo";
import {
  backfillBillTextsStep,
  type WorkflowTextBackfillSummary,
} from "@/workflows/steps/ingest-legislation";
import {
  completeJobRunStep,
  createJobRunStep,
  failJobRunStep,
  revalidateLegislationPathsStep,
} from "@/workflows/steps/job-runs";
import { summarizeLegislationWorkflow } from "@/workflows/summarize-legislation";

export interface UpdateTextsWorkflowInput {
  executionId?: string;
  billBatchSize?: number;
  eoBatchSize?: number;
}

export interface UpdateTextsWorkflowSummary {
  jobRunId: string;
  executionId?: string;
  bills: WorkflowTextBackfillSummary;
  executiveOrders: WorkflowTextBackfillSummary;
  itemsProcessed: number;
  itemsFailed: number;
  expectedUnavailable: number;
  unexpectedFailures: number;
  revalidated: boolean;
  triggeredSummarization: boolean;
  summarizationRunId?: string;
}

/**
 * Durable workflow orchestrator that backfills missing `fullText` and
 * `fullTextUrl` for bills and executive orders, revalidates public routes on
 * updates, and triggers `summarizeLegislationWorkflow` when any item gained
 * `fullText`.
 */
export async function updateTextsWorkflow(
  input: UpdateTextsWorkflowInput = {}
): Promise<UpdateTextsWorkflowSummary> {
  "use workflow";

  const initialMetadata: Record<string, unknown> = {};
  if (input.executionId !== undefined) {
    initialMetadata.executionId = input.executionId;
  }
  if (input.billBatchSize !== undefined) {
    initialMetadata.billBatchSize = input.billBatchSize;
  }
  if (input.eoBatchSize !== undefined) {
    initialMetadata.eoBatchSize = input.eoBatchSize;
  }

  const jobRunId = await createJobRunStep(
    "update-texts",
    Object.keys(initialMetadata).length > 0 ? initialMetadata : undefined
  );

  try {
    const bills = await backfillBillTextsStep(input.billBatchSize);
    const executiveOrders = await backfillEoTextsStep(input.eoBatchSize);

    const totalChecked = bills.processed + executiveOrders.processed;
    const itemsGainedFullText = bills.updated + executiveOrders.updated;
    const itemsProcessed =
      itemsGainedFullText + bills.urlOnly + executiveOrders.urlOnly;
    const itemsFailed = bills.failed + executiveOrders.failed;
    const expectedUnavailable =
      (bills.unavailable ?? 0) + (executiveOrders.unavailable ?? 0);
    const unexpectedFailures = Math.max(0, itemsFailed - expectedUnavailable);

    if (
      totalChecked > 0 &&
      itemsProcessed === 0 &&
      unexpectedFailures > 0 &&
      expectedUnavailable === 0
    ) {
      throw new Error(
        `All ${unexpectedFailures} checked item(s) failed during text backfill (bills failed: ${bills.failed}, executive orders failed: ${executiveOrders.failed})`
      );
    }

    let revalidated = false;
    if (itemsProcessed > 0) {
      await revalidateLegislationPathsStep();
      revalidated = true;
    }

    let triggeredSummarization = false;
    let summarizationRunId: string | undefined;
    let summarizationTriggerError: string | undefined;

    if (itemsGainedFullText > 0) {
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
          "[update-texts] Failed to start summarizeLegislationWorkflow:",
          summarizationTriggerError
        );
      }
    }

    await completeJobRunStep(jobRunId, {
      itemsProcessed,
      itemsFailed,
      metadata: {
        ...initialMetadata,
        bills: {
          processed: bills.processed,
          updated: bills.updated,
          urlOnly: bills.urlOnly,
          failed: bills.failed,
          unavailable: bills.unavailable ?? 0,
        },
        executiveOrders: {
          processed: executiveOrders.processed,
          updated: executiveOrders.updated,
          urlOnly: executiveOrders.urlOnly,
          failed: executiveOrders.failed,
          unavailable: executiveOrders.unavailable ?? 0,
        },
        itemsGainedFullText,
        expectedUnavailable,
        unexpectedFailures,
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
      bills,
      executiveOrders,
      itemsProcessed,
      itemsFailed,
      expectedUnavailable,
      unexpectedFailures,
      revalidated,
      triggeredSummarization,
      ...(summarizationRunId !== undefined ? { summarizationRunId } : {}),
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
