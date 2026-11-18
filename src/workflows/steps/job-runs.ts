import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";

const DEFAULT_SINGLETON_LEASE_MS = 45 * 60 * 1000;

export interface JobRunCompletionStats {
  itemsProcessed: number;
  itemsFailed: number;
  metadata?: Record<string, unknown>;
}

export interface SingletonJobRunLeaseResult {
  acquired: boolean;
  jobRunId: string;
  activeJobRunId?: string;
}

/**
 * Acquires a singleton `RUNNING` `JobRun` lease for `jobName` inside an
 * advisory-locked transaction, marking stale crashed runs older than `leaseMs`
 * as `FAILED` and returning `acquired: false` if an active run is still alive.
 */
export async function acquireSingletonJobRunStep(
  jobName: string,
  metadata?: Record<string, unknown>,
  leaseMs: number = DEFAULT_SINGLETON_LEASE_MS
): Promise<SingletonJobRunLeaseResult> {
  "use step";

  const runInTx = async <T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> => {
    if (typeof db.$transaction === "function") {
      return db.$transaction(callback);
    }
    return callback(db as unknown as Prisma.TransactionClient);
  };

  return runInTx(async (tx) => {
    if (typeof tx.$executeRaw === "function") {
      if (jobName === "summarize-legislation") {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(948272)`;
      } else {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${jobName})::bigint)`;
      }
    }

    const now = new Date();
    const effectiveLeaseMs =
      Number.isFinite(leaseMs) && leaseMs > 0
        ? leaseMs
        : DEFAULT_SINGLETON_LEASE_MS;
    const cutoff = new Date(now.getTime() - effectiveLeaseMs);

    if (typeof tx.jobRun?.updateMany === "function") {
      await tx.jobRun.updateMany({
        where: {
          jobName,
          status: "RUNNING",
          startedAt: { lte: cutoff },
        },
        data: {
          status: "FAILED",
          completedAt: now,
          error: `Marked failed after exceeding ${Math.round(effectiveLeaseMs / 60_000)}m singleton lease`,
        },
      });
    }

    if (typeof tx.jobRun?.findFirst === "function") {
      const activeRun = await tx.jobRun.findFirst({
        where: {
          jobName,
          status: "RUNNING",
          startedAt: { gt: cutoff },
        },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      });

      if (activeRun) {
        return {
          acquired: false,
          jobRunId: activeRun.id,
          activeJobRunId: activeRun.id,
        };
      }
    }

    const jobRun = await tx.jobRun.create({
      data: {
        jobName,
        status: "RUNNING",
        ...(metadata !== undefined
          ? { metadata: metadata as Prisma.InputJsonValue }
          : {}),
      },
      select: { id: true },
    });

    return {
      acquired: true,
      jobRunId: jobRun.id,
    };
  });
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
