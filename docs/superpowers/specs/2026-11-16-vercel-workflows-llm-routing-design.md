# Design Spec: Vercel Workflows & Multi-Provider LLM Pipeline (Replacing AWS Lambdas & Inngest)

**Date:** 2026-11-16  
**Status:** Ready for user approval (builder-reviewed)

---

## 1. Intent & Why

Background ingestion, full-text hydration, AI summarization, and categorization originally ran via Inngest on Vercel serverless functions (`src/app/api/inngest`, `src/inngest`, `src/jobs`). Those hit 2025 Vercel execution limits and OpenRouter free-tier rate limits (`429`s), which led to building four standalone AWS Lambda functions (`lambda/*`) talking directly to Supabase via `@supabase/supabase-js`.

AWS is no longer an option. Meanwhile, the project runs on **Vercel Pro**, where Fluid Compute now gives Vercel Functions and Workflow steps **300s default / 800s GA / 1800s beta** timeouts with Active CPU billing, alongside native **Vercel Schedules** (replaces legacy Cron Jobs) and **Vercel Workflows** (`workflow` SDK). We can eliminate both AWS and Inngest, consolidate back onto a single Next.js + Prisma codebase, restore category tagging and `JobRun` observability that the Lambda migration dropped, and modernize LLM routing to use paid low-cost OpenRouter Flash models as primary with a strictly guarded direct Gemini 3.8 Flash fallback.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **Eliminate AWS & Inngest dependencies** using native Vercel Schedules (`@vercel/schedules`) and Vercel Workflows (`workflow` SDK).
- **Achieve full data parity with all 4 AWS Lambdas** inside the Next.js codebase using Prisma (`src/lib/db.ts`), including:
  - Congress.gov bill ingestion with full hydration (`Bill`, `Member` sponsors/cosponsors, `_Cosponsored`, `Action`, `Amendment`, `fullText`) and non-empty field preservation.
  - Federal Register Presidential Document ingestion (`ExecutiveOrder`: executive orders, presidential memoranda, proclamations, determinations + full text).
  - Backfilling missing `fullText` / `fullTextUrl` for bills and executive orders.
  - Summarization (`Summary` with `summaryType: "STANDARD"`).
- **Restore lost Inngest capabilities:**
  - Assign up to 3 `Category` tags on both `Bill` and `ExecutiveOrder` (matching `src/lib/stats.ts` completeness rules).
  - Log `JobRun` records for ingestion, text updates, and summarization.
  - Use `DeadLetter` so repeatedly failing items do not stall the summarization backlog forever.
- **Unify LLM routing with OpenRouter primary + direct Gemini 3.8 Flash fallback:**
  - Default provider everywhere becomes `openrouter` (replacing `"openai"` and `"anthropic"` defaults; keep OpenAI/Anthropic as explicit opt-in overrides).
  - Try OpenRouter models in order:
    1. `deepseek/deepseek-v4.1-flash-1017`
    2. `xiaomi/mimo-v2.6-flash`
    3. `z-ai/glm-5.3-flash`
  - Fall back to `gemini-3.8-flash` **directly through the Gemini API (`@google/genai` + `GEMINI_API_KEY`)** — **never** through OpenRouter or Vercel AI Gateway — and guard it with a daily cap so daily Gemini credits are not consumed needlessly.

### Non-Goals
- Rewriting frontend pages, search, or user auth flows.
- Changing the PostgreSQL/Supabase database schema via destructive migrations (existing models `Bill`, `ExecutiveOrder`, `Summary`, `Category`, `Member`, `Action`, `Amendment`, `JobRun`, `DeadLetter` already support everything needed).
- Building an end-user notification/email digest dispatcher in this pass (can be layered onto workflow completion later).

### Anti-Goals
- **Never** route `gemini-3.8-flash` fallback calls through OpenRouter (`google/gemini-*`) or Vercel AI Gateway; fallback must use the official `@google/genai` SDK directly with `GEMINI_API_KEY`.
- **Never** use `sleep`/`setTimeout` inside a live HTTP function to wait out rate-limit cooldowns when `RetryableError` in a Workflow step can suspend at zero compute cost.
- **Never** import or execute Prisma (`db`) or Node.js-only modules inside `"use workflow"` sandbox scope (must live inside `"use step"` functions).
- **Never** hardcode `Category` CUIDs (unlike the old `CATEGORY_MAP` in `src/jobs/process/single-bill-processor-jobs.ts`); load categories dynamically from `db.category.findMany()`.
- **Never** use legacy `@vercel/kv`, `runtime = "edge"`, or legacy `crons` in `vercel.json`.

---

## 3. Constraints

- **Platform:** Vercel Pro (Fluid Compute enabled; 300s default / 800s GA / 1800s beta step duration; 1-minute minimum Vercel Schedule cadence; 1–15 min jitter).
- **Framework:** Next.js `15.5.4` (`src/` layout, TypeScript, Turbopack dev/build). `withWorkflow` from `workflow/next` wraps `next.config.ts`.
- **Database:** PostgreSQL on Supabase via Prisma (`src/lib/db.ts`, which patches `pgbouncer=true&connection_limit=1` onto pooler URLs). No new database migration is required.
- **Congress.gov API:** 5,000 requests/hour cap; Lambda client throttles to 1 request/second and makes ~6+ API calls per bill (detail, actions, amendments, cosponsors, text metadata + text download, member lookup). Ingestion must chunk work across workflow steps so a large Congress update window never hits a single-step timeout.
- **OpenRouter Primary Keys:** Paid low-cost Flash endpoints (`deepseek/deepseek-v4.1-flash-1017`, `xiaomi/mimo-v2.6-flash`, `z-ai/glm-5.3-flash` — no `:free` suffix) rotated across configured OpenRouter keys (`OPENROUTER_API_KEYS`, `OPENROUTER_API_KEY_1..10`, `OPENROUTER_KEY_1..10`), handling `402` (out of credits) / `401` (invalid key) / `429` (rate limit) / `5xx` cleanly.
- **Gemini Daily Credits:** `gemini-3.8-flash` via `@google/genai` must only be used after OpenRouter key+model rotation fails, bounded by a configurable daily fallback cap (`GEMINI_FALLBACK_DAILY_LIMIT`).

---

## 4. Approaches Considered

| Approach | How it works | Trade-offs | Verdict |
|---|---|---|---|
| **1. Native Vercel: Vercel Schedules + Vercel Workflows (`workflow` SDK)** *(Selected)* | Static `schedules` in `vercel.json` hit private `handleSchedule` functions (`schedule/v1beta`), which call `start(workflowFn)` and return. Workflows orchestrate chunked `"use step"` functions for ingestion, text backfill, and OpenRouter→Gemini summarization/categorization with `RetryableError` backoff. | Requires `withWorkflow` in `next.config.ts` and strict `"use workflow"` vs `"use step"` separation; `@vercel/schedules` is public beta. Eliminates AWS & Inngest, survives crashes/timeouts, scales to huge Congress batches, and suspends during `429` backoffs at zero Active CPU cost. | **Picked** |
| **2. Direct Fluid Compute Functions + Vercel Schedules/Queues** | Port the 4 Lambdas 1:1 into `handleSchedule` / `@vercel/queue` `handleCallback` route handlers with `maxDuration = 800`. | Simpler mental model (no workflow compiler), but static `function` schedules have no automatic retries, and large Congress deltas (`50+` bills at 1 req/s × ~6 calls) risk hitting even 800s without manual queue chaining. | Rejected |
| **3. Keep Inngest + Updated Vercel Fluid Compute** | Fix `maxDuration` on `/api/inngest`, port Lambda hydration into `src/jobs/*`, and fix missing `executive-order/summarize`. | Minimal rewrite if committed to Inngest, but retains third-party Inngest account, key sync, and step quotas that Vercel Workflows now handle natively. | Rejected |

---

## 5. System Architecture & Data Flow

```
Vercel Schedules (vercel.json -> schedule/v1beta private functions)
  ├── /api/schedules/ingest-legislation  ──start()──▶ ingestLegislationWorkflow
  ├── /api/schedules/ingest-eo           ──start()──▶ ingestExecutiveOrdersWorkflow
  ├── /api/schedules/update-texts        ──start()──▶ updateTextsWorkflow
  └── /api/schedules/summarize           ──start()──▶ summarizeLegislationWorkflow
                                                          ▲
       (Ingestion & text-update workflows also call start()│when items with fullText need processing)

summarizeLegislationWorkflow ("use workflow")
  └─▶ Step: fetch unsummarized / uncategorized items (excluding DeadLetter)
  └─▶ Step: summarizeAndCategorizeBatch / Item
        ├── 1. OpenRouter (rotate keys × [deepseek-v4.1-flash-1017, mimo-v2.6-flash, glm-5.3-flash])
        ├── 2. If all OpenRouter attempts fail & daily Gemini budget remaining:
        │      Direct Gemini API (@google/genai, model: "gemini-3.8-flash", store: false)
        └── 3. If OpenRouter exhausted & Gemini budget exhausted (or transient fail):
               throw RetryableError(..., { retryAfter }) -> Workflow suspends cleanly
```

### 5.1 Schedule Triggers (`vercel.json` + `src/app/api/schedules/*/route.ts`)
- **Private function targets:** Each route handler exports `POST = handleSchedule(async (metadata) => { ... })` from `@vercel/schedules` and declares `"experimentalTriggers": [{ "type": "schedule/v1beta" }]` in `vercel.json`. No public route or `CRON_SECRET` is exposed.
- **Note on `vercel.json` keys:** For Next.js `src/` apps, `functions` keys use `src/app/api/schedules/<name>/route.ts`, while `schedules.<name>.function` uses the `.vercel/output/functions` relative path without `.func` (verified via `vercel build` before deployment).
- **Default Cadences** *(builder may tune via config if desired)*:
  - `ingest-legislation`: `0 */6 * * *` (every 6 hours)
  - `ingest-eo`: `0 */12 * * *` (every 12 hours)
  - `update-texts`: `0 */4 * * *` (every 4 hours)
  - `summarize-legislation`: `*/20 * * * *` (every 20 minutes)
- Each schedule handler starts its corresponding workflow via `start(...)` from `workflow/api` (passing `{ executionId: metadata.executionId }` for idempotency/tracing) and returns immediately.

### 5.2 Workflow Modules (`src/workflows/*`)
All `"use workflow"` entrypoints only coordinate control flow, chunking, `sleep()`, child `start()` calls, and error handling. All Prisma queries, `fetch(..., { cache: "no-store" })` external API calls, and LLM calls live inside `"use step"` functions.

*(Builder note: keep `determineBillStatus` exported from `src/workflows/summarize-bill-standard.ts` or re-export it so `scripts/fetch-bill-actions.ts` does not break, and make sure `src/workflows/summarize-bill-standard.ts` contains no `"use workflow"` directive unless refactored to comply with sandbox rules.)*

1. **`ingestLegislationWorkflow`** (replaces `lambda/ingest-legislation`):
   - Step `createJobRun("ingest-legislation")`.
   - Step `fetchBillListPagesStep`: pages Congress.gov `/bill/{congress}` (`CURRENT_CONGRESS` / `TARGET_CONGRESS`, `INGEST_LOOKBACK_DAYS` default `1`) using a ported `CongressClient` (`cache: "no-store"`, 1s throttle, retry on `429`/`5xx`). Returns lightweight bill identifiers.
   - Loop in chunks (e.g., `10` bills per `"use step"` `ingestBillChunkStep`): for each bill, hydrates detail, actions, amendments, cosponsors, `Member` upserts, and `fullText`; upserts `Bill` preserving existing non-empty fields (`officialTitle`, `shortTitle`, `lawNumber`, `fullText`, `fullTextUrl`, `sponsorId`, `sourceUrl`); replaces `Action`, `Amendment`, and `_Cosponsored` relations transactionally or cleanly per bill.
   - Step `completeJobRun(...)` recording `itemsProcessed`, `itemsFailed`, and `metadata` (`created`, `updated`, `skipped`, `failed`).
   - If any created/updated bills have `fullText` and lack a `STANDARD` summary or categories, calls `start(summarizeLegislationWorkflow, ...)` as a non-blocking child workflow.

2. **`ingestExecutiveOrdersWorkflow`** (replaces `lambda/ingest-eo`):
   - Step `createJobRun("ingest-eo")`.
   - Step `fetchFederalRegisterPagesStep`: fetches presidential documents (`executive_order`, `presidential_memorandum`, `proclamation`, `determination`) over `EO_LOOKBACK_DAYS` (default `14`) with `cache: "no-store"`.
   - Chunked steps `ingestEoChunkStep`: fetches document detail + full text (`body_html_url` → `raw_text_url` → `full_text_xml_url`), derives `orderNumber`, `executiveOrderType`, `presidentName`, and upserts `ExecutiveOrder` via Prisma preserving non-empty fields.
   - Logs `JobRun` completion and calls `start(summarizeLegislationWorkflow, ...)` if new/updated EOs with `fullText` need summaries/categories.

3. **`updateTextsWorkflow`** (replaces `lambda/update-legislation-eo-texts`):
   - Step `createJobRun("update-texts")`.
   - Step `backfillBillTextsStep`: queries `Bill` where `fullText IS NULL` (batch `BILL_TEXT_BATCH_SIZE` default `10`, ordered by `introducedDate DESC`), fetches text from Congress.gov, updates `fullText` / `fullTextUrl`.
   - Step `backfillEoTextsStep`: queries `ExecutiveOrder` where `fullText IS NULL` (batch `EO_TEXT_BATCH_SIZE` default `10`, ordered by `signingDate DESC`), fetches text from Federal Register, updates `fullText` / `fullTextUrl`.
   - Logs `JobRun` completion and calls `start(summarizeLegislationWorkflow, ...)` if any records gained `fullText`.

4. **`summarizeLegislationWorkflow`** (replaces `lambda/summarize` + `single-bill-processor-jobs.ts`):
   - Step `createJobRun("summarize-legislation")`.
   - Step `selectWorkBatchStep`:
     - Loads active categories once from `db.category.findMany()`.
     - Queries items needing either a `STANDARD` `Summary` **or** having 0 connected `Category` rows (excluding items already marked `processed: false` in `DeadLetter` with `attempts >= LLM_MAX_ATTEMPTS`, default `3`–`5`), prioritizing recent items with `fullText` across both `Bill` (batch default `5`) and `ExecutiveOrder` (batch default `5`, topping off bills if fewer EOs, matching `lambda/summarize` behavior).
   - Processes items via **single-call combined summarize + categorize** (defaulting to small batches of up to `SUMMARIZE_BATCH_SIZE` items—e.g. `3` for OpenRouter efficiency—with automatic single-item fallback if a batch response fails Zod JSON validation):
     - If an item already has a `STANDARD` summary and only lacks categories, only updates categories (or runs categorization prompt).
     - Validates `summary` (non-empty, >= 20 words), `keyPoints`, `impactAreas`, `confidence` (`0..1`), and `categories` (1–3 valid slugs matching `db.category` rows).
     - Persists `Summary` (`summaryType: "STANDARD"`, `aiModel` recording the exact winning model/provider) and connects up to 3 `Category` rows via Prisma.
     - On repeated permanent failure (`FatalError` or parse failures exceeding threshold), writes/updates `DeadLetter` so the item doesn't poison future batches.
   - Step `completeJobRun(...)`.

### 5.3 Unified LLM Router (`src/lib/llm/`)
Replace the split defaults across `src/workflows/summarize-bill-standard.ts`, `src/lib/ai/categorizer.ts`, `src/lib/ai/summarizer-openrouter.ts`, and `src/lib/llm.ts` with a shared router module used by both the Workflows and existing CLI/shared helpers:

1. **Default Provider Resolution:**
   - `resolveProvider()` defaults to `"openrouter"` (instead of `"openai"`).
   - `"openai"` and `"anthropic"` remain available only when explicitly requested (`AI_MODEL=openai` / `AI_MODEL=anthropic`).
   - Fix the `src/lib/llm.ts` model-lookup bug where setting `AI_MODEL=openrouter` resulted in an `undefined` model config.

2. **OpenRouter Primary Cascade (Paid Low-Cost Flash Models):**
   - Default ordered model cascade (exact slugs, overridable via env `OPENROUTER_MODELS` CSV):
     1. `deepseek/deepseek-v4.1-flash-1017`
     2. `xiaomi/mimo-v2.6-flash`
     3. `z-ai/glm-5.3-flash`
   - Key discovery (`getOpenRouterKeys()`): merges and deduplicates `OPENROUTER_API_KEYS` (CSV), `OPENROUTER_API_KEY_1..10`, and `OPENROUTER_KEY_1..10`.
   - Attempt & error classification strategy per request:
     - Iterate models in priority order; for each model, rotate through available keys.
     - **`401` / `402` (invalid key or depleted OpenRouter credit balance):** mark that specific key unavailable for the remainder of the run / longer cooldown so remaining OpenRouter keys are tried immediately without wasting requests on the depleted key; if *all* OpenRouter keys fail with `401`/`402`, short-circuit straight to the guarded `gemini-3.8-flash` fallback.
     - **`429` / `5xx` / timeout / invalid JSON:** mark that `(key, model)` pair on short cooldown and advance to the next key or next model in the cascade (`deepseek` → `mimo` → `glm`).
     - **`400` / `404` (bad model slug or malformed prompt/context overflow):** advance to the next model in the cascade (do not skip valid keys on account-independent model errors).
     - Request strict JSON output and validate with Zod before accepting.

3. **Guarded Direct Gemini 3.8 Flash Fallback:**
   - Package: `@google/genai` (`>= 2.29.1`), instantiated with `new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })`.
   - Uses `client.interactions.create({ model: "gemini-3.8-flash", store: false, system_instruction, input, response_format })` (direct Gemini API, **never** OpenRouter or Vercel AI Gateway).
   - **Credit-protection rules:**
     - Triggered **only** if `GEMINI_API_KEY` is configured, `GEMINI_FALLBACK_ENABLED !== "false"`, and **all** OpenRouter `(model, key)` combinations in the cascade failed for the current call.
     - **Daily cap (`GEMINI_FALLBACK_DAILY_LIMIT`, default `20` calls per UTC day):** Before invoking Gemini, query Prisma `db.jobRun.count({ where: { jobName: "llm-fallback:gemini-3.8-flash", startedAt: { gte: utcDayStart } } })`.
     - If under the cap, create the `llm-fallback:gemini-3.8-flash` `JobRun` log entry (recording model, target item IDs, and outcome) and execute the `gemini-3.8-flash` call.
     - If `GEMINI_FALLBACK_DAILY_LIMIT` is reached (or `GEMINI_API_KEY` is unset), skip Gemini and throw `RetryableError("OpenRouter exhausted and Gemini daily fallback cap reached", { retryAfter: "30m" })` inside the Workflow step so the workflow suspends without spending Gemini credits or Active CPU.

### 5.4 Cache Invalidation & Existing Callers
- Update `src/app/bills/page.tsx` / `src/lib/countCache.ts` behavior note: since `getLegislationCompletenessCounts` / `get_count_complete_legislation` depend on `fullText`, `STANDARD` summary, and `categories`, restoring category assignment inside `summarizeLegislationWorkflow` ensures newly summarized items immediately increment the app's "complete legislation" metrics (and `revalidatePath("/")` / `revalidatePath("/bills")` can be called on completion when items are persisted).
- Preserve compatibility for `scripts/*` (`determineBillStatus`, `generateSummaryOpenRouter`, `categorizeBill`) by keeping exported wrapper functions pointing at the unified router.

### 5.5 Decommissioning Legacy Inngest, Redis Queue, and AWS Lambdas
- Remove `src/app/api/inngest/`, `src/inngest/`, `src/jobs/`, and `inngest` + `@vercel/kv` from `package.json` once the new Workflows + Schedules are verified.
- Retire `src/lib/llmRedis.ts`, `scripts/llm-queue-worker.ts`, and `scripts/llm-dlq-admin.ts` Redis dependencies (or update `llm-dlq-admin.ts` to inspect `DeadLetter` in Prisma only, dropping `ioredis` if unused elsewhere).
- Remove or archive `lambda/` once Vercel production schedules are verified running.

---

## 6. Calls Made During Design (for Review)

- **No schema migration for Gemini quota tracking:** Daily `gemini-3.8-flash` fallback usage is tracked in the existing `JobRun` table (`jobName: "llm-fallback:gemini-3.8-flash"`) rather than adding a new Prisma model or requiring Redis.
- **Dynamic category loading:** Categories are queried from `db.category.findMany()` at step start instead of using hardcoded CUIDs.
- **Combined summarize + categorize call:** Summarization and category slug selection run in a single LLM call (configurable batch size with automatic single-item fallback on JSON/Zod failure) rather than separate summarization and categorization requests.
- **Default schedule cadences:** `ingest-legislation` (`0 */6 * * *`), `ingest-eo` (`0 */12 * * *`), `update-texts` (`0 */4 * * *`), and `summarize-legislation` (`*/20 * * * *`), plus event-like `start(summarizeLegislationWorkflow)` triggers right after ingestion/text backfill.
- **Direct OpenAI/Anthropic kept opt-in:** Existing OpenAI/Anthropic summarizers remain callable via explicit `AI_MODEL=openai` or `AI_MODEL=anthropic`, while `openrouter` becomes the universal default.
- **User notifications deferred:** In-app/email user digest notifications are left out of this migration scope and can hook onto workflow completion later.

---

## 7. What Is Left to the Builder

- Verify `@google/genai` TypeScript types for `interactions.create` (`response_format` structured JSON schema) from the installed package / official Gemini docs before implementing the Gemini adapter.
- Verify `workflow` (`workflow/next` `withWorkflow`) and `@vercel/schedules` package installation and `vercel build` output paths (`api/schedules/...`) against Next.js `15.5.4` + Turbopack.
- Choose exact text truncation / context-window chunking thresholds for very large bills before sending to OpenRouter vs Gemini 3.8 Flash (1M token window), and exact `summarizeLegislationWorkflow` batch size (`1` vs `3`–`5`) based on OpenRouter prompt reliability.
- Ensure `.env.example` documents `GEMINI_API_KEY`, `GEMINI_FALLBACK_DAILY_LIMIT`, `OPENROUTER_MODELS`, and updated OpenRouter key vars without breaking existing CLI scripts.
