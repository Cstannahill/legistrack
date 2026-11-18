import type { ScheduleMetadata } from "@vercel/schedules";
import { start } from "workflow/api";
import { HookConflictError } from "workflow/errors";

const SCHEDULE_DEDUP_RETENTION = "7d" as const;

export interface ScheduledWorkflowInput {
  executionId?: string;
}

export type ScheduledWorkflowFn<TResult = unknown> = (
  input?: ScheduledWorkflowInput
) => Promise<TResult>;

export interface TriggerScheduledWorkflowOptions {
  /**
   * Maximum allowed age (in ms) between `metadata.scheduledAt` and now.
   * Deliveries older than `maxAgeMs` are skipped cleanly with HTTP 200 to
   * prevent post-outage burst replays from piling up.
   */
  maxAgeMs?: number;
}

/**
 * Starts a workflow run for a verified Vercel Schedule invocation, guarding
 * duplicate CloudEvent deliveries with an atomic start-hook token and
 * optionally skipping stale outage replays while preserving `Promise<void>`
 * return semantics for `handleSchedule`.
 */
export async function triggerScheduledWorkflow<TResult>(
  workflow: ScheduledWorkflowFn<TResult>,
  metadata: ScheduleMetadata,
  options?: TriggerScheduledWorkflowOptions
): Promise<void> {
  const scheduledAtDate =
    metadata.scheduledAt instanceof Date &&
    !Number.isNaN(metadata.scheduledAt.getTime())
      ? metadata.scheduledAt
      : null;
  const scheduledAt = scheduledAtDate
    ? scheduledAtDate.toISOString()
    : String(metadata.scheduledAt);

  if (options?.maxAgeMs !== undefined && scheduledAtDate !== null) {
    const ageMs = Date.now() - scheduledAtDate.getTime();
    if (ageMs > options.maxAgeMs) {
      console.info("[schedules] Skipped stale schedule replay", {
        scheduleName: metadata.name,
        scheduleId: metadata.scheduleId,
        executionId: metadata.executionId,
        scheduledAt,
        ageMs,
        maxAgeMs: options.maxAgeMs,
      });
      return;
    }
  }

  const hookOptions =
    metadata.name && metadata.executionId
      ? {
          experimental_hook: {
            token: `schedule:${metadata.name}:${metadata.executionId}`,
            experimental_minRetention: SCHEDULE_DEDUP_RETENTION,
          },
        }
      : undefined;

  try {
    const run = hookOptions
      ? await start(
          workflow,
          [{ executionId: metadata.executionId }],
          hookOptions
        )
      : await start(workflow, [{ executionId: metadata.executionId }]);

    console.info("[schedules] Started workflow", {
      scheduleName: metadata.name,
      scheduleId: metadata.scheduleId,
      executionId: metadata.executionId,
      runId: run?.runId,
      scheduledAt,
    });
  } catch (error) {
    if (HookConflictError.is(error)) {
      console.info("[schedules] Duplicate schedule delivery skipped", {
        scheduleName: metadata.name,
        scheduleId: metadata.scheduleId,
        executionId: metadata.executionId,
        conflictingRunId: error.conflictingRunId,
        scheduledAt,
      });
      return;
    }

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
