import type { ScheduleMetadata } from "@vercel/schedules";
import { start } from "workflow/api";

export interface ScheduledWorkflowInput {
  executionId?: string;
}

export type ScheduledWorkflowFn<TResult = unknown> = (
  input?: ScheduledWorkflowInput
) => Promise<TResult>;

/**
 * Starts a workflow run for a verified Vercel Schedule invocation, passing
 * `metadata.executionId` and emitting structured start/failure diagnostics
 * while returning `void` to match `@vercel/schedules` `ScheduleHandler`.
 */
export async function triggerScheduledWorkflow<TResult>(
  workflow: ScheduledWorkflowFn<TResult>,
  metadata: ScheduleMetadata
): Promise<void> {
  const scheduledAt =
    metadata.scheduledAt instanceof Date
      ? metadata.scheduledAt.toISOString()
      : String(metadata.scheduledAt);

  try {
    const run = await start(workflow, [
      { executionId: metadata.executionId },
    ]);
    console.info("[schedules] Started workflow", {
      scheduleName: metadata.name,
      scheduleId: metadata.scheduleId,
      executionId: metadata.executionId,
      runId: run?.runId,
      scheduledAt,
    });
  } catch (error) {
    console.error("[schedules] Failed to start workflow", {
      scheduleName: metadata.name,
      scheduleId: metadata.scheduleId,
      executionId: metadata.executionId,
      scheduledAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
