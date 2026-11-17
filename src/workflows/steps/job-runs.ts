import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";

export interface JobRunCompletionStats {
  itemsProcessed: number;
  itemsFailed: number;
  metadata?: Record<string, unknown>;
}

/**
 * Creates a `JobRun` row in `RUNNING` state and returns its ID.
 */
export async function createJobRunStep(
  jobName: string,
  metadata?: Record<string, unknown>
): Promise<string> {
  "use step";

  const jobRun = await db.jobRun.create({
    data: {
      jobName,
      status: "RUNNING",
      ...(metadata !== undefined
        ? { metadata: metadata as Prisma.InputJsonValue }
        : {}),
    },
    select: { id: true },
  });

  return jobRun.id;
}

/**
 * Marks a `JobRun` row as `COMPLETED` with final item counts and optional metadata.
 */
export async function completeJobRunStep(
  jobRunId: string,
  stats: JobRunCompletionStats
): Promise<void> {
  "use step";

  await db.jobRun.update({
    where: { id: jobRunId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      itemsProcessed: stats.itemsProcessed,
      itemsFailed: stats.itemsFailed,
      ...(stats.metadata !== undefined
        ? { metadata: stats.metadata as Prisma.InputJsonValue }
        : {}),
    },
  });
}

/**
 * Marks a `JobRun` row as `FAILED` with the serialized error string.
 */
export async function failJobRunStep(
  jobRunId: string,
  error: string
): Promise<void> {
  "use step";

  if (!jobRunId) {
    return;
  }

  await db.jobRun.update({
    where: { id: jobRunId },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      error,
    },
  });
}

/**
 * Revalidates public Next.js routes that surface legislation counts and listings.
 */
export async function revalidateLegislationPathsStep(): Promise<void> {
  "use step";

  revalidatePath("/");
  revalidatePath("/bills");
}
