import {
  acquireSingletonJobRunStep,
  completeJobRunStep,
  failJobRunStep,
  revalidateLegislationPathsStep,
} from "@/workflows/steps/job-runs";
import {
  processSummaryBatchStep,
  selectWorkBatchStep,
  type SummarizeItemError,
} from "@/workflows/steps/summarize";

export interface SummarizeLegislationWorkflowInput {
  executionId?: string;
  billBatchSize?: number;
  eoBatchSize?: number;
}

export interface SummarizeWorkflowSummary {
  jobRunId: string;
  executionId?: string;
  skipped?: boolean;
  skippedReason?: string;
  activeJobRunId?: string;
  selectedBills: number;
  selectedExecutiveOrders: number;
  attempted: number;
  persisted: number;
  summarized: number;
  categorized: number;
  failed: number;
  deadLettered: number;
  revalidated: boolean;
  errors: SummarizeItemError[];
}

/**
 * Durable workflow orchestrator that acquires a singleton active-run lease,
 * selects unsummarized or uncategorized bills and executive orders, runs
 * combined or category-only LLM processing, revalidates public pages when
 * changes persist, and tracks `JobRun` status.
 */
export async function summarizeLegislationWorkflow(
  input: SummarizeLegislationWorkflowInput = {}
): Promise<SummarizeWorkflowSummary> {
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

  const lease = await acquireSingletonJobRunStep(
    "summarize-legislation",
    Object.keys(initialMetadata).length > 0 ? initialMetadata : undefined
  );

  if (!lease.acquired) {
    return {
      jobRunId: lease.activeJobRunId ?? lease.jobRunId,
      ...(input.executionId !== undefined
        ? { executionId: input.executionId }
        : {}),
      skipped: true,
      skippedReason: "active-run-in-progress",
      ...(lease.activeJobRunId !== undefined
        ? { activeJobRunId: lease.activeJobRunId }
        : {}),
      selectedBills: 0,
      selectedExecutiveOrders: 0,
      attempted: 0,
      persisted: 0,
      summarized: 0,
      categorized: 0,
      failed: 0,
      deadLettered: 0,
      revalidated: false,
      errors: [],
    };
  }

  const jobRunId = lease.jobRunId;

  try {
    const batch = await selectWorkBatchStep({
      billBatchSize: input.billBatchSize,
      eoBatchSize: input.eoBatchSize,
    });

    if (batch.items.length === 0) {
      await completeJobRunStep(jobRunId, {
        itemsProcessed: 0,
        itemsFailed: 0,
        metadata: {
          ...initialMetadata,
          selectedBills: 0,
          selectedExecutiveOrders: 0,
          attempted: 0,
          persisted: 0,
          summarized: 0,
          categorized: 0,
          deadLettered: 0,
          revalidated: false,
        },
      });

      return {
        jobRunId,
        ...(input.executionId !== undefined
          ? { executionId: input.executionId }
          : {}),
        selectedBills: 0,
        selectedExecutiveOrders: 0,
        attempted: 0,
        persisted: 0,
        summarized: 0,
        categorized: 0,
        failed: 0,
        deadLettered: 0,
        revalidated: false,
        errors: [],
      };
    }

    const outcome = await processSummaryBatchStep(batch);

    let revalidated = false;
    if (outcome.persisted > 0) {
      await revalidateLegislationPathsStep();
      revalidated = true;
    }

    await completeJobRunStep(jobRunId, {
      itemsProcessed: outcome.persisted,
      itemsFailed: outcome.failed,
      metadata: {
        ...initialMetadata,
        selectedBills: batch.billCount,
        selectedExecutiveOrders: batch.executiveOrderCount,
        attempted: outcome.attempted,
        persisted: outcome.persisted,
        summarized: outcome.summarized,
        categorized: outcome.categorized,
        deadLettered: outcome.deadLettered,
        revalidated,
      },
    });

    return {
      jobRunId,
      ...(input.executionId !== undefined
        ? { executionId: input.executionId }
        : {}),
      selectedBills: batch.billCount,
      selectedExecutiveOrders: batch.executiveOrderCount,
      attempted: outcome.attempted,
      persisted: outcome.persisted,
      summarized: outcome.summarized,
      categorized: outcome.categorized,
      failed: outcome.failed,
      deadLettered: outcome.deadLettered,
      revalidated,
      errors: outcome.errors,
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
