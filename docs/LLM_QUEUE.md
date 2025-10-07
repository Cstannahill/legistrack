# LLM queue worker

This project uses a Redis-backed queue to safely enforce OpenRouter per-key usage caps and to avoid wasted LLM calls.

Files

- `src/lib/llmRedis.ts` — Redis helpers: reservation Lua script, refund, and queue helpers.
- `src/lib/llm.ts` — LLM helper that attempts to reserve a slot before calling OpenRouter and enqueues when capacity is exhausted.
- `scripts/llm-queue-worker.ts` — Worker that drains the Redis queue and processes items when capacity becomes available.

Environment variables

- `REDIS_URL` — Redis connection string (e.g. redis://127.0.0.1:6379). If using Vercel KV, set `VERCEL_REDIS_URL` instead.
- `OPENROUTER_KEYS` — Comma-separated OpenRouter API keys used for rotation.
- `LLM_PER_MINUTE` — Per-key per-minute limit (default: 20).
- `LLM_PER_DAY` — Per-key per-day limit (default: 50).
- `LLM_MAX_ATTEMPTS` — Number of times a queued item will be retried before being written to the durable DeadLetter table (default: 5).

Dead-letter queue (DLQ)

- When an item has exceeded `LLM_MAX_ATTEMPTS` without successful processing it will be inserted into the database `DeadLetter` table for manual inspection and reprocessing.

Admin tooling

- A small admin helper is provided at `scripts/llm-dlq-admin.ts` with these commands:
  - `--list` — show the first 50 unprocessed DLQ rows
  - `--requeue <id>` — requeue the DLQ item back to Redis and delete the row
  - `--delete <id>` — delete the DLQ row without requeuing

Example:

```bash
# list
node scripts/llm-dlq-admin.ts --list

# requeue
node scripts/llm-dlq-admin.ts --requeue abc123

# delete
node scripts/llm-dlq-admin.ts --delete abc123
```

Run the worker locally

Make sure you've installed dependencies locally (ioredis etc.). Then run:

```bash
# from the repository root
node --loader ts-node/esm scripts/llm-queue-worker.ts
```

Or using `tsx` (recommended if present):

```bash
tsx scripts/llm-queue-worker.ts
```

Notes

- The worker attempts to process one queued item at a time. If capacity is still exhausted it re-enqueues the item and backs off briefly.
- Monitor the Redis key `llm:queue:v1` to see queued items and `llm:key:<idx>:min:<bucket>` / `llm:key:<idx>:day:<date>` for counters.
