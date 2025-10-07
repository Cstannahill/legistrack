#!/usr/bin/env node
/**
 * LLM Queue Worker
 *
 * Dequeues payloads from Redis (llm:queue:v1) and attempts to process them.
 * If capacity is exhausted the LLM helper will throw an Error with code 'ENQUEUED'
 * — in that case the item is requeued and the worker backs off briefly.
 */

import llmRedis from "@/lib/llmRedis";
import llm from "@/lib/llm";
import { db } from "@/lib/db";
import { setTimeout as wait } from "timers/promises";

async function processOne() {
  const item = await llmRedis.dequeueOne();
  if (!item) return false;

  type Category = { slug: string; name: string; description?: string };
  type QueuedPayload = {
    title: string;
    text?: string | null;
    categories: Category[];
    billId?: string | null;
    executiveOrderId?: string | null;
    allowResummarize?: boolean;
    attempts?: number;
  };
  type QueuedItem = { payload: QueuedPayload; createdAt: number };
  const { payload: rawPayload, createdAt } = item as QueuedItem;
  const payload: QueuedPayload = {
    ...rawPayload,
    attempts: rawPayload.attempts || 0,
  };
  try {
    console.log(
      `Processing queued item createdAt=${new Date(createdAt).toISOString()}`
    );
    // If the item references a bill or executive order that already has a summary,
    // skip calling the LLM unless allowResummarize is true.
    if (payload.billId && !payload.allowResummarize) {
      const existing = await db.summary.findFirst({
        where: { billId: payload.billId },
      });
      if (existing) {
        console.log(
          `Skipped queued item: bill ${payload.billId} already summarized`
        );
        return true;
      }
    }

    if (payload.executiveOrderId && !payload.allowResummarize) {
      const existing = await db.summary.findFirst({
        where: { executiveOrderId: payload.executiveOrderId },
      });
      if (existing) {
        console.log(
          `Skipped queued item: executive order ${payload.executiveOrderId} already summarized`
        );
        return true;
      }
    }

    // payload should match { title, text, categories, billId?, executiveOrderId? }
    await llm.summarizeAndCategorize(payload);
    console.log("Processed queued item successfully");
    return true;
  } catch (err) {
    const e = err as Error & { code?: string };
    const maxAttempts = +(process.env.LLM_MAX_ATTEMPTS || "5");

    // Helper to push back to queue with incremented attempts
    async function requeueWithIncrement(attempts: number) {
      try {
        await llmRedis.enqueuePayload({
          title: payload.title,
          text: payload.text,
          categories: payload.categories,
          billId: payload.billId,
          executiveOrderId: payload.executiveOrderId,
          allowResummarize: payload.allowResummarize,
          attempts,
        });
      } catch (err) {
        console.error("Failed to re-enqueue item after error", err);
      }
    }

    // If capacity was still exhausted, increment attempts and re-enqueue or DLQ
    if (e && e.code === "ENQUEUED") {
      payload.attempts = (payload.attempts || 0) + 1;
      console.log(
        `Capacity exhausted while processing queued item; attempts=${payload.attempts}`
      );
      if (payload.attempts >= maxAttempts) {
        console.log("Max attempts reached — inserting into DeadLetter");
        try {
          await db.deadLetter.create({
            data: {
              payload: { ...payload, createdAt },
              errorMessage: e.message,
              attempts: payload.attempts,
              billId: payload.billId ?? undefined,
              executiveOrderId: payload.executiveOrderId ?? undefined,
              lastAttemptAt: new Date(),
            },
          });
        } catch (dbErr) {
          console.error("Failed to write DeadLetter row", dbErr);
          // If DB write fails, fall back to requeueing once
          await requeueWithIncrement(payload.attempts);
        }
        // short sleep before continuing
        await wait(2000);
        return false;
      }

      // otherwise requeue with incremented attempts and short backoff
      await requeueWithIncrement(payload.attempts);
      await wait(5000);
      return false;
    }

    // For other transient errors, increment attempts and either requeue or DLQ
    console.error("Error processing queued item; handling attempts", e);
    payload.attempts = (payload.attempts || 0) + 1;
    if (payload.attempts >= maxAttempts) {
      console.log(
        "Max attempts reached for transient error — inserting into DeadLetter"
      );
      try {
        await db.deadLetter.create({
          data: {
            payload: { ...payload, createdAt },
            errorMessage: e?.message ?? String(e),
            attempts: payload.attempts,
            billId: payload.billId ?? undefined,
            executiveOrderId: payload.executiveOrderId ?? undefined,
            lastAttemptAt: new Date(),
          },
        });
      } catch (dbErr) {
        console.error("Failed to write DeadLetter row after error", dbErr);
        await requeueWithIncrement(payload.attempts);
      }
      await wait(2000);
      return false;
    }

    // requeue and backoff longer
    await requeueWithIncrement(payload.attempts);
    await wait(30000);
    return false;
  }
}

let running = true;
process.on("SIGINT", () => {
  console.log("Received SIGINT — shutting down after current item");
  running = false;
});
process.on("SIGTERM", () => {
  console.log("Received SIGTERM — shutting down after current item");
  running = false;
});

async function main() {
  console.log("LLM queue worker starting");
  while (running) {
    try {
      const ok = await processOne();
      if (!ok) {
        // If nothing processed, sleep a bit
        await wait(2000);
      }
    } catch (err) {
      console.error("Worker loop error", err);
      await wait(5000);
    }
  }

  console.log("LLM queue worker shutting down");
  // give redis time to close
  try {
    await llmRedis.redis.quit();
  } catch {
    // ignore
  }
}

main().catch((e) => {
  console.error("Fatal error in llm-queue-worker", e);
  process.exit(1);
});
