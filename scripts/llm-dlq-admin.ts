#!/usr/bin/env node
/**
 * LLM DLQ admin
 *
 * Usage:
 *  node llm-dlq-admin.ts --list
 *  node llm-dlq-admin.ts --requeue <id>
 *  node llm-dlq-admin.ts --delete <id>
 */

import llmRedis from "@/lib/llmRedis";
import { db } from "@/lib/db";

async function listDLQ(limit = 50) {
  const rows = await db.deadLetter.findMany({
    where: { processed: false },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  for (const r of rows) {
    console.log(
      `${r.id} attempts=${
        r.attempts
      } createdAt=${r.createdAt.toISOString()} processed=${r.processed}`
    );
  }
}

async function requeue(id: string) {
  const row = await db.deadLetter.findUnique({ where: { id } });
  if (!row) {
    console.error("Not found", id);
    process.exit(2);
  }

  // push the original payload back to the Redis queue and then delete the row
  try {
    const payload = row.payload;
    if (!payload || typeof payload !== "object") {
      console.error(
        "DLQ row payload is empty or not an object; cannot requeue",
        id
      );
      process.exit(3);
    }
    await llmRedis.enqueuePayload(payload as object);
    await db.deadLetter.delete({ where: { id } });
    console.log("Requeued and deleted DLQ row", id);
  } catch (e) {
    console.error("Failed to requeue", e);
    process.exit(3);
  }
}

async function del(id: string) {
  try {
    await db.deadLetter.delete({ where: { id } });
    console.log("Deleted DLQ row", id);
  } catch (e) {
    console.error("Failed to delete DLQ row", e);
    process.exit(3);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--list") {
    await listDLQ();
    return;
  }
  if (args[0] === "--requeue" && args[1]) {
    await requeue(args[1]);
    return;
  }
  if (args[0] === "--delete" && args[1]) {
    await del(args[1]);
    return;
  }

  console.log("Usage: --list | --requeue <id> | --delete <id>");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
