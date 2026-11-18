# Vercel Workflows & Multi-Provider LLM Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four AWS Lambda functions and legacy Inngest jobs with native Vercel Schedules, Vercel Workflows (`workflow` SDK), Prisma persistence, restored dynamic category tagging + `JobRun` tracking, and a unified OpenRouter-first / guarded direct Gemini 3.8 Flash LLM router.

**Architecture:** Private `@vercel/schedules` route handlers trigger four `"use workflow"` orchestrators (`ingestLegislationWorkflow`, `ingestExecutiveOrdersWorkflow`, `updateTextsWorkflow`, `summarizeLegislationWorkflow`) built with `"use step"` Node.js/Prisma modules so long API throttles and `429` backoffs suspend safely without burning compute. A shared LLM router (`src/lib/llm/router.ts`) tries paid OpenRouter Flash models (`deepseek/deepseek-v4.1-flash-1017` → `xiaomi/mimo-v2.6-flash` → `z-ai/glm-5.3-flash`) across rotated keys first, falling back to direct `@google/genai` (`gemini-3.8-flash`) only when OpenRouter is exhausted and within a `JobRun`-tracked daily credit budget.

**Tech Stack:** Next.js 15.5.4 (App Router, Turbopack), TypeScript, Prisma (`@prisma/client` on Supabase PgBouncer), `workflow` (5.x), `@vercel/schedules`, `@google/genai` (`>= 2.29.1`), OpenAI SDK (for OpenRouter endpoint), Zod v4, Jest (`ts-jest`).

**Spec:** [docs/superpowers/specs/2026-11-16-vercel-workflows-llm-routing-design.md](file:///s:/Code/Node/nextjs/legislation-tracker/docs/superpowers/specs/2026-11-16-vercel-workflows-llm-routing-design.md)

## Global Constraints

- **Platform & Runtime:** Vercel Pro with Fluid Compute; Node.js default runtime (no `runtime = "edge"`, no `@vercel/kv`, no legacy `crons` in `vercel.json`).
- **Workflow Sandbox Isolation:** Functions containing `"use workflow"` must NOT import Prisma (`@/lib/db`), Node built-ins (`fs`, `crypto`, etc.), `setTimeout`/`setInterval`, or native `fetch()`; all I/O, DB, and network calls must reside strictly inside `"use step"` functions.
- **OpenRouter Paid Primary Models (exact slugs, priority order):**
  1. `deepseek/deepseek-v4.1-flash-1017`
  2. `xiaomi/mimo-v2.6-flash`
  3. `z-ai/glm-5.3-flash`
- **Direct Gemini Fallback Only:** Fallback model `gemini-3.8-flash` must call the Google Gemini API directly via `@google/genai` (`interactions.create`, `store: false`, `GEMINI_API_KEY`) — never via OpenRouter or Vercel AI Gateway — and only after all OpenRouter `(model, key)` pairs fail, capped by `GEMINI_FALLBACK_DAILY_LIMIT` (default `20`/UTC day) tracked in `JobRun` (`jobName: "llm-fallback:gemini-3.8-flash"`).
- **Default Provider:** `"openrouter"` replaces `"openai"` and `"anthropic"` defaults across workflows and categorizers (`openai`/`anthropic` remain explicit `AI_MODEL` overrides).
- **No Schema Migration:** Reuse existing Prisma models (`Bill`, `ExecutiveOrder`, `Summary`, `Category`, `Member`, `Action`, `Amendment`, `JobRun`, `DeadLetter`); load `Category` rows dynamically via `db.category.findMany()` (never hardcode CUIDs).
- **Preserve Existing Script Contracts:** Keep `determineBillStatus` exported from `src/workflows/summarize-bill-standard.ts`, keep `scripts/fetch-bill-actions.ts` working, and keep existing `summarizer-openai`/`summarizer-openrouter`/`categorizer` entrypoints intact.

## Review Focus

- **All OpenRouter keys `402`/`401` + Gemini daily cap reached (`>= GEMINI_FALLBACK_DAILY_LIMIT`):** Router must skip `@google/genai` completely (spending 0 Gemini credits) and throw `FallbackCapReachedError` so the workflow step raises `RetryableError(..., { retryAfter: "30m" })` without writing `DeadLetter`. (Pinned to Tasks 2, 3, 6.)
- **Oversized legislative `fullText` or corrupt/partial JSON array from batch summarization:** Input text must be bounded safely before prompt construction, and if a batch JSON response drops an item or fails Zod validation, the step must recover via single-item fallback without failing sibling items in the batch. (Pinned to Tasks 3, 6.)
- **Re-ingesting an existing `Bill` or `ExecutiveOrder` when upstream returns empty `fullText`, `sponsor`, or `federalRegisterUrl`:** Persistence must preserve existing non-empty columns (`officialTitle`, `shortTitle`, `lawNumber`, `fullText`, `fullTextUrl`, `sponsorId`, `sourceUrl`, `presidentName`, `federalRegisterUrl`). (Pinned to Task 5.)
- **Partially complete items & poisoned `DeadLetter` records:** An item that already has a `STANDARD` summary but 0 `Category` rows must get categorized without duplicating `Summary`, and `DeadLetter` records at/above `LLM_MAX_ATTEMPTS` must be excluded from selection. (Pinned to Task 6.)
- **Workflow compilation & `vercel.json` schedule path validity:** `withWorkflow(nextConfig)` must compile with Next.js `15.5.4` without pulling Prisma into workflow bundles, and `schedules.<name>.function` paths must match `.vercel/output/functions` without `.func`. (Pinned to Tasks 1, 6, 7, 8.)

---

## File Structure

- `package.json`, `next.config.ts`, `jest.config.cjs`, `.env.example` — SDK installs (`workflow`, `@vercel/schedules`, `@google/genai`), `withWorkflow`, Jest `@/` alias mapping, env docs.
- `src/lib/openrouter-keys.ts` — Multi-format key loader (`OPENROUTER_API_KEYS`, `OPENROUTER_API_KEY_1..10`, `OPENROUTER_KEY_1..10`) that returns `[]` safely at module load instead of throwing at import time.
- `src/lib/llm/types.ts` — Zod schemas (`SummaryAndCategoryResultSchema`, `BatchSummaryItemSchema`), provider types, and typed errors (`FallbackCapReachedError`, `AllOpenRouterKeysExhaustedError`).
- `src/lib/llm/gemini.ts` — Direct `@google/genai` client (`gemini-3.8-flash`, `interactions.create`, `store: false`, `response_format`) + `JobRun`-backed daily quota guard (`checkAndConsumeGeminiFallbackQuota`).
- `src/lib/llm/router.ts` — Unified LLM router (`summarizeAndCategorizeBatch`, `summarizeAndCategorizeSingle`, `categorizeItemOnly`) implementing OpenRouter key/model rotation, `401`/`402` vs `429`/`5xx` vs `400`/`404` classification, prompt bounding, and guarded Gemini fallback.
- `src/lib/llm.ts`, `src/lib/ai/summarizer-openrouter.ts`, `src/lib/ai/categorizer.ts`, `src/workflows/summarize-bill-standard.ts` — Update defaults to `"openrouter"`, fix `AI_MODEL=openrouter` model lookup bug, route through `src/lib/llm/router.ts`, keep `determineBillStatus` and opt-in `openai`/`anthropic` working.
- `src/lib/ingestion/congress-client.ts` — Ported throttled (1s) Congress.gov client using `cache: "no-store"` and transient retries.
- `src/lib/ingestion/federal-register-client.ts` — Ported throttled (1s) Federal Register client using `cache: "no-store"`.
- `src/lib/ingestion/bills-service.ts` — Prisma bill hydration persistence (`persistHydratedBillPrisma`, `resolveStatus`, `determineLookupWindow`, `backfillMissingBillTexts`).
- `src/lib/ingestion/executive-orders-service.ts` — Prisma EO persistence (`persistExecutiveOrderPrisma`, `ensureOrderNumber`, `inferPresidentName`, `backfillMissingEoTexts`).
- `src/workflows/steps/job-runs.ts`, `src/workflows/steps/summarize.ts`, `src/workflows/steps/ingest-legislation.ts`, `src/workflows/steps/ingest-eo.ts` — `"use step"` functions isolating all DB/network/LLM/`next/cache` I/O.
- `src/workflows/summarize-legislation.ts`, `src/workflows/ingest-legislation.ts`, `src/workflows/ingest-eo.ts`, `src/workflows/update-texts.ts` — `"use workflow"` orchestrators with chunking, child `start()` chaining, and `RetryableError` backoff.
- `src/app/api/schedules/*/route.ts`, `vercel.json` — Private `handleSchedule` handlers (`schedule/v1beta`) and cron definitions.
- Cleanup: remove `src/app/api/inngest/`, `src/inngest/`, `src/jobs/`, `lambda/`, `zip.js`, `inngest`, and `@vercel/kv`.

---

### Task 1: Project Dependencies, Next.js Workflow Config, Jest `@/` Alias & Env Docs

**Files:**
- Modify: `package.json`
- Modify: `next.config.ts:1-7`
- Modify: `jest.config.cjs:1-11`
- Modify: `.env.example:1-35`
- Test: `tests/unit/setup-smoke.test.ts`

**Interfaces:**
- Produces: `next.config.ts` exporting `withWorkflow(nextConfig)`; Jest resolving `@/*` imports to `src/*`.

- [ ] **Step 1: Write the failing Jest alias smoke test**

Create `tests/unit/setup-smoke.test.ts` importing `@/lib/constants` (`CURRENT_CONGRESS`) and asserting `expect(CURRENT_CONGRESS).toBeGreaterThanOrEqual(119)`.

- [ ] **Step 2: Run test to verify `@/` resolution fails before Jest config update**

Run: `npx jest tests/unit/setup-smoke.test.ts`
Expected: FAIL (`Cannot find module '@/lib/constants'`).

- [ ] **Step 3: Install `workflow`, `@vercel/schedules`, `@google/genai` and configure `next.config.ts`, `jest.config.cjs`, `.env.example`**

1. Run `npm install workflow @vercel/schedules @google/genai`.
2. Wrap `nextConfig` in `next.config.ts` with `withWorkflow` from `"workflow/next"`.
3. Update `jest.config.cjs` to add `moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" }` and `testPathIgnorePatterns: ["/node_modules/", "/.next/", "/lambda/"]`.
4. Update `.env.example` to document `OPENROUTER_API_KEYS`, `OPENROUTER_API_KEY_1`, `OPENROUTER_MODELS`, `GEMINI_API_KEY`, `GEMINI_FALLBACK_ENABLED`, `GEMINI_FALLBACK_DAILY_LIMIT`, `SUMMARIZE_BATCH_SIZE`, `LLM_MAX_ATTEMPTS`, `INGEST_LOOKBACK_DAYS`, `EO_LOOKBACK_DAYS`, `BILL_TEXT_BATCH_SIZE`, `EO_TEXT_BATCH_SIZE` (removing `INNGEST_*` and `KV_*` example entries).

- [ ] **Step 4: Run Jest smoke test and Next.js typecheck to verify setup**

Run: `npx jest tests/unit/setup-smoke.test.ts && npx tsc --noEmit`
Expected: PASS (`setup-smoke.test.ts` passes and `tsc` exits 0).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json next.config.ts jest.config.cjs .env.example tests/unit/setup-smoke.test.ts
git commit -m "chore: install workflow, schedules, and genai SDKs with Jest alias"
```

---

### Task 2: OpenRouter Key Loader & Guarded Direct Gemini 3.8 Flash Adapter

**Files:**
- Modify: `src/lib/openrouter-keys.ts:1-48`
- Create: `src/lib/llm/types.ts`
- Create: `src/lib/llm/gemini.ts`
- Test: `tests/unit/llm-gemini.test.ts`

**Interfaces:**
- Consumes: `db` (`@/lib/db`), `@google/genai` (`GoogleGenAI`), `zod`.
- Produces:
  - `getOpenRouterKeys(envObj?: NodeJS.ProcessEnv): string[]` in `src/lib/openrouter-keys.ts` (never throws at import time).
  - `LlmCategoryInput`, `SummaryAndCategoryPayload`, `BatchSummaryOutputItem`, `SummaryProvider`, `FallbackCapReachedError`, `AllOpenRouterKeysExhaustedError`, Zod schemas + JSON Schema helper in `src/lib/llm/types.ts`.
  - `callGeminiStructured<T>(opts: { systemInstruction: string; prompt: string; schema: z.ZodType<T>; jsonSchema: Record<string, unknown>; itemIds: string[] }): Promise<{ data: T; model: "gemini-3.8-flash" }>` and `getRemainingGeminiFallbackQuota(): Promise<{ used: number; limit: number; remaining: number }>` in `src/lib/llm/gemini.ts`.

- [ ] **Step 1: Write failing unit tests for key discovery, Gemini quota guard, and direct `interactions.create` call**

Create `tests/unit/llm-gemini.test.ts` (mocking `@/lib/db` and `@google/genai`):
1. `getOpenRouterKeys` merges and deduplicates `OPENROUTER_API_KEYS`, `OPENROUTER_API_KEY_1..10`, and `OPENROUTER_KEY_1..10`, and returns `[]` without throwing when none are set.
2. `callGeminiStructured` counts `db.jobRun.count` for `jobName: "llm-fallback:gemini-3.8-flash"` since `00:00:00Z` today; when `count >= GEMINI_FALLBACK_DAILY_LIMIT` (e.g., `20`), it throws `FallbackCapReachedError` **without** constructing or calling `GoogleGenAI.interactions.create`.
3. When under cap, `callGeminiStructured` creates a `JobRun` row (`jobName: "llm-fallback:gemini-3.8-flash"`, `status: "RUNNING"`), invokes `interactions.create({ model: "gemini-3.8-flash", store: false, system_instruction, input, response_format: { type: "text", mime_type: "application/json", schema } })`, validates `interaction.output_text` against the Zod schema, updates `JobRun` to `"COMPLETED"`, and returns `{ data, model: "gemini-3.8-flash" }`.
4. When `GEMINI_FALLBACK_ENABLED="false"` or `GEMINI_API_KEY` is missing, throws `FallbackCapReachedError` without calling Gemini.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/llm-gemini.test.ts`
Expected: FAIL (`Cannot find module '@/lib/llm/gemini'`).

- [ ] **Step 3: Implement `getOpenRouterKeys`, `src/lib/llm/types.ts`, and `src/lib/llm/gemini.ts`**

1. Update `src/lib/openrouter-keys.ts` to merge `OPENROUTER_API_KEYS`, `OPENROUTER_API_KEY_1..10`, and `OPENROUTER_KEY_1..10`, deduplicate preserving order, and return `[]` with `console.warn` instead of throwing when empty.
2. Create `src/lib/llm/types.ts` with Zod schemas (`SummaryAndCategoryItemSchema`: `id`, `summary` >= 20 words or validated string, `keyPoints` string[], `impactAreas` string[], `categories` string[] max 3, `confidence` 0..1; `CategorizeOnlySchema`: `categories` string[] max 3), typed errors (`FallbackCapReachedError`, `AllOpenRouterKeysExhaustedError`), and constants (`DEFAULT_OPENROUTER_MODELS = ["deepseek/deepseek-v4.1-flash-1017", "xiaomi/mimo-v2.6-flash", "z-ai/glm-5.3-flash"] as const`, `GEMINI_FALLBACK_MODEL = "gemini-3.8-flash"`).
3. Verify installed `@google/genai` types in `node_modules/@google/genai` for `interactions.create`, then implement `src/lib/llm/gemini.ts` checking `GEMINI_FALLBACK_ENABLED`, `GEMINI_API_KEY`, UTC-day `db.jobRun.count`, recording the `JobRun` attempt (marking `COMPLETED` or `FAILED` in `finally`/error handling), and parsing/validating `interaction.output_text`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx jest tests/unit/llm-gemini.test.ts`
Expected: PASS (all 4 test suites pass).

- [ ] **Step 5: Commit**

```bash
git add src/lib/openrouter-keys.ts src/lib/llm/types.ts src/lib/llm/gemini.ts tests/unit/llm-gemini.test.ts
git commit -m "feat(llm): add multi-key loader and guarded direct gemini-3.8-flash fallback"
```

---

### Task 3: Unified OpenRouter→Gemini Router & Legacy Provider Default Migration

**Files:**
- Create: `src/lib/llm/router.ts`
- Modify: `src/lib/llm.ts:1-378`
- Modify: `src/lib/ai/summarizer-openrouter.ts:1-304`
- Modify: `src/lib/ai/categorizer.ts:1-60`
- Modify: `src/workflows/summarize-bill-standard.ts:1-299`
- Test: `tests/unit/llm-router.test.ts`

**Interfaces:**
- Consumes: `getOpenRouterKeys` (`@/lib/openrouter-keys`), `callGeminiStructured` (`@/lib/llm/gemini`), types from `@/lib/llm/types`, `OpenAI` (`openai` package pointed at `https://openrouter.ai/api/v1`).
- Produces:
  - `summarizeAndCategorizeItems(items: LlmLegislationInput[], categories: LlmCategoryInput[]): Promise<LlmBatchItemOutcome[]>` in `src/lib/llm/router.ts`
  - `categorizeLegislationItem(input: { title: string; summary: string; categories: LlmCategoryInput[] }): Promise<{ categories: string[]; aiModel: string }>` in `src/lib/llm/router.ts`
  - `resolveProvider(rawModel?: string | null): SummaryProvider` in `src/workflows/summarize-bill-standard.ts` defaulting to `"openrouter"`.

- [ ] **Step 1: Write failing unit tests for OpenRouter rotation, error classification, text bounding, and legacy defaults**

Create `tests/unit/llm-router.test.ts` (mocking `openai` fetch/completions and `callGeminiStructured`):
1. Iterates `deepseek/deepseek-v4.1-flash-1017` → `xiaomi/mimo-v2.6-flash` → `z-ai/glm-5.3-flash` in exact order; if model 1 returns `429` across keys, succeeds on model 2 **without** calling `callGeminiStructured`.
2. On `402` or `401` for key 1, skips key 1 immediately and tries key 2 on the same model; if all keys fail `401`/`402`, short-circuits directly to `callGeminiStructured` (`gemini-3.8-flash`) without hammering remaining models on dead keys.
3. On `400`/`404` for model 1, advances directly to model 2 using valid keys.
4. When a batch call for 3 items returns malformed JSON or omits item #2, falls back per missing/corrupt item (retrying individually before falling back to Gemini) while keeping valid items from the batch.
5. Truncates oversized `text` cleanly (e.g., configurable `OPENROUTER_MAX_INPUT_CHARS`, default `120000`) without throwing.
6. `resolveProvider(undefined)` returns `"openrouter"` (not `"openai"`), `categorizeBill` defaults to `categorizeLegislationItem` (OpenRouter → Gemini), and `src/lib/llm.ts` does not look up `OPENROUTER_MODELS["openrouter"]` as `undefined`.

- [ ] **Step 2: Run test to verify failure**

Run: `npx jest tests/unit/llm-router.test.ts`
Expected: FAIL (`Cannot find module '@/lib/llm/router'`).

- [ ] **Step 3: Implement `src/lib/llm/router.ts` and update `llm.ts`, `summarizer-openrouter.ts`, `categorizer.ts`, `summarize-bill-standard.ts`**

1. Build `src/lib/llm/router.ts`:
   - Uses `DEFAULT_OPENROUTER_MODELS` (or `OPENROUTER_MODELS` env CSV) and `getOpenRouterKeys()`.
   - Tracks in-memory `(key, model)` short cooldowns (`429`/`5xx`) and key-level credit/auth disablement (`401`/`402`).
   - Caps text input cleanly (`truncateForPrompt`), builds combined summarize+categorize prompts using dynamic `categories` slugs, parses & validates JSON with Zod.
   - Falls back to `callGeminiStructured` only after OpenRouter cascade fails; lets `FallbackCapReachedError` propagate so Workflow steps map it to `RetryableError`.
2. Update `src/workflows/summarize-bill-standard.ts`: default `resolveProvider` to `"openrouter"`, route `"openrouter"` through `summarizeAndCategorizeItems`, keep `"openai"` and `"anthropic"` explicit overrides, and keep `determineBillStatus` exported.
3. Update `src/lib/ai/categorizer.ts`: default to `categorizeLegislationItem`, retaining Anthropic only when `AI_MODEL=anthropic`.
4. Update `src/lib/ai/summarizer-openrouter.ts` and `src/lib/llm.ts`: add the 3 paid Flash slugs to `OPENROUTER_MODELS`, fix the `MODEL` resolution bug when `AI_MODEL` is a provider string, and initialize OpenRouter keys lazily inside functions rather than throwing at module import time.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx jest tests/unit/llm-gemini.test.ts tests/unit/llm-router.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/router.ts src/lib/llm.ts src/lib/ai/summarizer-openrouter.ts src/lib/ai/categorizer.ts src/workflows/summarize-bill-standard.ts tests/unit/llm-router.test.ts
git commit -m "feat(llm): implement OpenRouter paid cascade with guarded Gemini fallback and update defaults"
```

---

### Task 4: Congress.gov & Federal Register Ingestion Clients (`no-store`, Throttled, Retried)

**Files:**
- Create: `src/lib/ingestion/congress-client.ts`
- Create: `src/lib/ingestion/federal-register-client.ts`
- Test: `tests/unit/ingestion-clients.test.ts`

**Interfaces:**
- Produces:
  - `CongressClient` in `src/lib/ingestion/congress-client.ts` with `fetchBillPage`, `fetchBillDetail`, `fetchBillActions`, `fetchBillAmendments`, `fetchBillCosponsors`, `fetchBillText`, `fetchMember`, `hydrateBill` (all using `cache: "no-store"`, 1000ms throttle, retry on `429`/`5xx`).
  - `fetchExecutiveOrdersPage`, `fetchExecutiveOrderDetails`, `fetchExecutiveOrderFullText`, `hydrateExecutiveOrder` in `src/lib/ingestion/federal-register-client.ts` (all using `cache: "no-store"`, 1000ms throttle, retry on `429`/`5xx`).

- [ ] **Step 1: Write failing unit tests for Congress & Federal Register clients**

Create `tests/unit/ingestion-clients.test.ts` (mocking `global.fetch` with fake timers or minimal throttle config):
1. `CongressClient.fetchBillPage` calls `fetch` with `cache: "no-store"`, `fromDateTime`, `toDateTime`, and `api_key`, and retries once on HTTP `429`/`503` before succeeding.
2. `CongressClient.fetchBillText` prioritizes `"FORMATTED TEXT"`/`"TEXT"`/`"TXT"` formats and extracts `<pre>...</pre>` inner text when wrapped in HTML.
3. `hydrateExecutiveOrder` fetches detail + text candidates in priority order (`body_html_url` → `raw_text_url` → `full_text_xml_url`), using `cache: "no-store"`, and never aborts the whole EO if text download returns 404 (`fullText: null`).

- [ ] **Step 2: Run test to verify failure**

Run: `npx jest tests/unit/ingestion-clients.test.ts`
Expected: FAIL (`Cannot find module '@/lib/ingestion/congress-client'`).

- [ ] **Step 3: Implement `congress-client.ts` and `federal-register-client.ts`**

Port the tested Lambda clients from `lambda/ingest-legislation/src/{congressClient.ts,hydration.ts,types.ts}` and `lambda/ingest-eo/src/{federalRegisterApi.ts,hydration.ts,types.ts}`, ensuring every `fetch` passes `{ cache: "no-store" }`, preserves `REQUEST_INTERVAL_MS` throttling (configurable for tests via constructor option), and retries transient `429`/`5xx` HTTP errors.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx jest tests/unit/ingestion-clients.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingestion/congress-client.ts src/lib/ingestion/federal-register-client.ts tests/unit/ingestion-clients.test.ts
git commit -m "feat(ingestion): port Congress.gov and Federal Register clients with no-store and retries"
```

---

### Task 5: Prisma Persistence & Missing-Text Backfill Services

**Files:**
- Create: `src/lib/ingestion/bills-service.ts`
- Create: `src/lib/ingestion/executive-orders-service.ts`
- Test: `tests/unit/ingestion-persistence.test.ts`

**Interfaces:**
- Consumes: `db` (`@/lib/db`), `CongressClient`, `hydrateExecutiveOrder` (`@/lib/ingestion/*`).
- Produces:
  - `determineLookupWindow`, `resolveBillStatus`, `persistHydratedBillPrisma(data: HydratedBillData, client: CongressClient): Promise<PersistedBillResult>`, `backfillMissingBillTexts(limit: number): Promise<TextBackfillSummary>` in `src/lib/ingestion/bills-service.ts`.
  - `persistExecutiveOrderPrisma(data: HydratedExecutiveOrder): Promise<PersistedExecutiveOrderResult>`, `backfillMissingEoTexts(limit: number): Promise<TextBackfillSummary>` in `src/lib/ingestion/executive-orders-service.ts`.

- [ ] **Step 1: Write failing unit tests for field preservation, member/cosponsor/action/amendment sync, and text backfill**

Create `tests/unit/ingestion-persistence.test.ts` (mocking `@/lib/db` and ingestion clients):
1. `persistHydratedBillPrisma` on an existing `Bill` preserves existing non-empty `fullText`, `fullTextUrl`, `officialTitle`, `shortTitle`, `lawNumber`, `sponsorId`, and `sourceUrl` when incoming hydrated data has `null`/empty strings.
2. `persistHydratedBillPrisma` upserts sponsor & cosponsors (`Member` by `bioguideId`), connects `cosponsors`, and replaces `Action` and `Amendment` rows cleanly for that `billId`.
3. `persistExecutiveOrderPrisma` preserves non-empty `fullText`, `fullTextUrl`, `presidentName`, `sourceUrl`, and `federalRegisterUrl` on update, and maps subtypes (`executive_order`, `presidential_memorandum`, `proclamation`, `determination`) + synthesizes deterministic fallback `orderNumber` for unnumbered non-EO presidential docs.
4. `backfillMissingBillTexts` / `backfillMissingEoTexts` query `where: { fullText: null }` and update `fullText` / `fullTextUrl`, returning `{ processed, updated, urlOnly, failed, updatedIds }`.

- [ ] **Step 2: Run test to verify failure**

Run: `npx jest tests/unit/ingestion-persistence.test.ts`
Expected: FAIL (`Cannot find module '@/lib/ingestion/bills-service'`).

- [ ] **Step 3: Implement `bills-service.ts` and `executive-orders-service.ts`**

Port `lambda/ingest-legislation/src/{persistence.ts,utils.ts,congressUrl.ts}` and `lambda/ingest-eo/src/{persistence.ts,utils.ts}` plus `lambda/update-legislation-eo-texts/src/workflows.ts` directly onto Prisma (`db.bill`, `db.member`, `db.action`, `db.amendment`, `db.executiveOrder`). Use Prisma relation `cosponsors: { set: cosponsorIds.map((id) => ({ id })) }` inside a transaction or bill update instead of raw `_Cosponsored` SQL.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx jest tests/unit/ingestion-persistence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingestion/bills-service.ts src/lib/ingestion/executive-orders-service.ts tests/unit/ingestion-persistence.test.ts
git commit -m "feat(ingestion): add Prisma persistence and text-backfill services"
```

---

### Task 6: Durable Summarization + Categorization Workflow & Dead-Letter Handling

**Files:**
- Create: `src/workflows/steps/job-runs.ts`
- Create: `src/workflows/steps/summarize.ts`
- Create: `src/workflows/summarize-legislation.ts`
- Test: `tests/unit/workflows-summarize.test.ts`

**Interfaces:**
- Consumes: `db` (`@/lib/db`), `revalidatePath` (`next/cache`), `RetryableError` (`workflow`), `summarizeAndCategorizeItems`, `categorizeLegislationItem` (`@/lib/llm/router`), `FallbackCapReachedError` (`@/lib/llm/types`).
- Produces:
  - `createJobRunStep(jobName: string, metadata?: Record<string, unknown>): Promise<string>` (`jobRunId`), `completeJobRunStep(jobRunId: string, stats: { itemsProcessed: number; itemsFailed: number; metadata?: Record<string, unknown> }): Promise<void>`, `failJobRunStep(jobRunId: string, error: string): Promise<void>`, `revalidateLegislationPathsStep(): Promise<void>` in `src/workflows/steps/job-runs.ts`.
  - `selectWorkBatchStep(opts?: { billBatchSize?: number; eoBatchSize?: number }): Promise<SummarizeWorkBatch>` and `processSummaryBatchStep(batch: SummarizeWorkBatch): Promise<SummarizeBatchOutcome>` in `src/workflows/steps/summarize.ts`.
  - `summarizeLegislationWorkflow(input?: { executionId?: string; billBatchSize?: number; eoBatchSize?: number }): Promise<SummarizeWorkflowSummary>` in `src/workflows/summarize-legislation.ts`.

- [ ] **Step 1: Write failing unit tests for selection, combined/partial persistence, `DeadLetter`, `RetryableError`, and sandbox isolation**

Create `tests/unit/workflows-summarize.test.ts` (mocking `@/lib/db`, `next/cache`, `workflow`, and `@/lib/llm/router`):
1. `selectWorkBatchStep` loads categories via `db.category.findMany()`, selects bills (`billBatchSize` default `5`) and executive orders (`eoBatchSize` default `5`, topping off bills if fewer EOs) that have `fullText` and lack EITHER a `STANDARD` summary OR any category, while excluding items with unprocessed `DeadLetter` rows where `attempts >= LLM_MAX_ATTEMPTS`.
2. For an item lacking both summary and categories, `processSummaryBatchStep` creates one `Summary` (`summaryType: "STANDARD"`, `aiModel` set to winning model) and connects up to 3 dynamic `Category` IDs.
3. For an item that already has a `STANDARD` `Summary` (`hasStandardSummary: true`) and only lacks categories (`hasCategories: false`), `processSummaryBatchStep` calls `categorizeLegislationItem` and connects categories **without** creating a duplicate `Summary` row.
4. When `summarizeAndCategorizeItems` throws `FallbackCapReachedError`, `processSummaryBatchStep` throws `RetryableError` (`retryAfter: "30m"`) and does **not** increment/create `DeadLetter`.
5. When an item fails validation/parsing permanently across attempts, `processSummaryBatchStep` upserts/increments `DeadLetter` (`attempts`, `errorMessage`, `lastAttemptAt`) instead of crashing sibling items.
6. Static check verifies `src/workflows/summarize-legislation.ts` contains `"use workflow"` and does not import `@/lib/db`, `next/cache`, `node:*`, or `setTimeout`, and triggers `revalidateLegislationPathsStep()` when `persisted > 0`.

- [ ] **Step 2: Run test to verify failure**

Run: `npx jest tests/unit/workflows-summarize.test.ts`
Expected: FAIL (`Cannot find module '@/workflows/summarize-legislation'`).

- [ ] **Step 3: Implement `job-runs.ts`, `summarize.ts`, and `summarize-legislation.ts`**

1. Implement `"use step"` helpers in `src/workflows/steps/job-runs.ts` for `JobRun` lifecycle (`createJobRunStep`, `completeJobRunStep`, `failJobRunStep`) and `revalidateLegislationPathsStep()` calling `revalidatePath("/")` and `revalidatePath("/bills")`.
2. Implement `"use step"` functions in `src/workflows/steps/summarize.ts`: `selectWorkBatchStep` (dynamic categories, `Bill` + `ExecutiveOrder` top-off query, `DeadLetter` exclusion) and `processSummaryBatchStep` (splits items needing summary+categories vs categories-only, chunks by `SUMMARIZE_BATCH_SIZE` default `3`, records `Summary` + `Category` connections, updates `DeadLetter` on non-capacity item failures, and converts `FallbackCapReachedError` into `new RetryableError(..., { retryAfter: "30m" })`).
3. Implement `"use workflow"` `summarizeLegislationWorkflow` in `src/workflows/summarize-legislation.ts` calling `createJobRunStep`, `selectWorkBatchStep`, `processSummaryBatchStep`, `revalidateLegislationPathsStep` (when items were persisted), and `completeJobRunStep` / `failJobRunStep`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx jest tests/unit/workflows-summarize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workflows/steps/job-runs.ts src/workflows/steps/summarize.ts src/workflows/summarize-legislation.ts tests/unit/workflows-summarize.test.ts
git commit -m "feat(workflows): add durable summarization and categorization workflow"
```

---

### Task 7: Durable Ingestion & Text-Backfill Workflows + Steps

**Files:**
- Create: `src/workflows/steps/ingest-legislation.ts`
- Create: `src/workflows/steps/ingest-eo.ts`
- Create: `src/workflows/ingest-legislation.ts`
- Create: `src/workflows/ingest-eo.ts`
- Create: `src/workflows/update-texts.ts`
- Test: `tests/unit/workflows-ingestion.test.ts`

**Interfaces:**
- Consumes: `start` (`workflow/api`), Task 4 & Task 5 services, Task 6 exports (`createJobRunStep`, `completeJobRunStep`, `failJobRunStep`, `revalidateLegislationPathsStep`, `summarizeLegislationWorkflow`).
- Produces:
  - `ingestLegislationWorkflow(input?: { executionId?: string; lookbackDays?: number; congress?: number })` in `src/workflows/ingest-legislation.ts`.
  - `ingestExecutiveOrdersWorkflow(input?: { executionId?: string; lookbackDays?: number })` in `src/workflows/ingest-eo.ts`.
  - `updateTextsWorkflow(input?: { executionId?: string; billBatchSize?: number; eoBatchSize?: number })` in `src/workflows/update-texts.ts`.

- [ ] **Step 1: Write failing unit tests for chunked ingestion, `JobRun` lifecycle, and child workflow trigger**

Create `tests/unit/workflows-ingestion.test.ts` (mocking `workflow/api`'s `start`, Prisma `db`, and ingestion services):
1. `ingestLegislationWorkflow` creates a `JobRun` (`"ingest-legislation"`), chunks 25 returned bill identifiers into batches of 10 across `ingestBillChunkStep`, updates `JobRun` to `"COMPLETED"` with `{ created, updated, skipped, failed }`, calls `revalidateLegislationPathsStep()`, and calls `start(summarizeLegislationWorkflow, ...)` when at least one created/updated bill has `fullText` needing summary/categories.
2. When no created/updated bills need summarization/categorization, `ingestLegislationWorkflow` does NOT spawn `summarizeLegislationWorkflow`.
3. `ingestExecutiveOrdersWorkflow` and `updateTextsWorkflow` follow the same `JobRun` lifecycle (`RUNNING` → `COMPLETED`, or `FAILED` on uncaught error) and trigger `start(summarizeLegislationWorkflow)` only when items gained/have `fullText`.
4. Static check verifies `"use workflow"` files (`src/workflows/ingest-legislation.ts`, `src/workflows/ingest-eo.ts`, `src/workflows/update-texts.ts`) do NOT import `@/lib/db`, `next/cache`, `node:*`, or `setTimeout`.

- [ ] **Step 2: Run test to verify failure**

Run: `npx jest tests/unit/workflows-ingestion.test.ts`
Expected: FAIL (`Cannot find module '@/workflows/ingest-legislation'`).

- [ ] **Step 3: Implement step modules (`ingest-legislation.ts`, `ingest-eo.ts`) and `"use workflow"` orchestrators**

1. Implement `"use step"` functions in `src/workflows/steps/ingest-legislation.ts` (`fetchBillListStep`, `ingestBillChunkStep`, `backfillBillTextsStep`) and `src/workflows/steps/ingest-eo.ts` (`fetchExecutiveOrderListStep`, `ingestEoChunkStep`, `backfillEoTextsStep`).
2. Implement `"use workflow"` `ingestLegislationWorkflow`, `ingestExecutiveOrdersWorkflow`, and `updateTextsWorkflow` chunking items into batches of 10 per step, tracking counts into `completeJobRunStep`, revalidating paths when items change, and calling `start(summarizeLegislationWorkflow, [{ executionId }])` when new/updated items have `fullText`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx jest tests/unit/workflows-ingestion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workflows/steps/ingest-legislation.ts src/workflows/steps/ingest-eo.ts src/workflows/ingest-legislation.ts src/workflows/ingest-eo.ts src/workflows/update-texts.ts tests/unit/workflows-ingestion.test.ts
git commit -m "feat(workflows): add chunked ingestion and text-backfill workflows"
```

---

### Task 8: Vercel Schedules Endpoints & `vercel.json` Configuration

**Files:**
- Create: `src/app/api/schedules/ingest-legislation/route.ts`
- Create: `src/app/api/schedules/ingest-eo/route.ts`
- Create: `src/app/api/schedules/update-texts/route.ts`
- Create: `src/app/api/schedules/summarize-legislation/route.ts`
- Create: `vercel.json`
- Test: `tests/unit/schedules-routes.test.ts`

**Interfaces:**
- Consumes: `handleSchedule` (`@vercel/schedules`), `start` (`workflow/api`), workflow functions from `src/workflows/*`.
- Produces: Private `POST` route handlers wrapped in `handleSchedule` and `vercel.json` declaring `functions` (`experimentalTriggers: [{ type: "schedule/v1beta" }]`) and `schedules`.

- [ ] **Step 1: Write failing unit tests for all 4 schedule routes and `vercel.json` schema consistency**

Create `tests/unit/schedules-routes.test.ts` (mocking `@vercel/schedules` and `workflow/api`):
1. Each route exports `POST` (no `GET` export), calls `start(<matchingWorkflow>, [{ executionId: metadata.executionId }])`, and completes cleanly without checking `CRON_SECRET`.
2. Reads `vercel.json` and verifies every `schedules.<name>` entry has:
   - only `schedule` + `function` (no `path` or `topic`),
   - a matching `functions["src/app/api/schedules/<name>/route.ts"].experimentalTriggers` containing only `[{ type: "schedule/v1beta" }]`,
   - valid 5-field cron syntax (`0 */6 * * *`, `0 */12 * * *`, `0 */4 * * *`, `*/20 * * * *`).

- [ ] **Step 2: Run test to verify failure**

Run: `npx jest tests/unit/schedules-routes.test.ts`
Expected: FAIL (`Cannot find module '@/app/api/schedules/ingest-legislation/route'`).

- [ ] **Step 3: Create the 4 route handlers and `vercel.json`, then verify build output paths**

1. Create `src/app/api/schedules/{ingest-legislation,ingest-eo,update-texts,summarize-legislation}/route.ts` wrapping `start(...)` inside `handleSchedule`.
2. Create `vercel.json` with `functions` keyed on `src/app/api/schedules/<name>/route.ts` and `schedules` pointing `function` to `"api/schedules/<name>"` (and verify exact path under `.vercel/output/functions` via `vercel build` if Vercel CLI is linked, or `npm run build`).

- [ ] **Step 4: Run tests and Next.js build**

Run: `npx jest tests/unit/schedules-routes.test.ts && npm run build`
Expected: PASS (tests pass and `next build` compiles all routes and workflows cleanly).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/schedules vercel.json tests/unit/schedules-routes.test.ts
git commit -m "feat(schedules): add private Vercel Schedule handlers and vercel.json config"
```

---

### Task 9: Decommission Legacy Inngest, AWS Lambdas & Unused Dependencies + Full Verification

**Files:**
- Delete: `src/app/api/inngest/route.ts`, `src/inngest/client.ts`, `src/inngest/functions.ts`, `src/jobs/*`, `lambda/*`, `zip.js`
- Modify: `package.json` (remove `inngest`, `@vercel/kv`, and `archiver` if unused outside `zip.js`)
- Modify: `scripts/README.md` (update background job references from Inngest/Lambda to Vercel Workflows & Schedules)

- [ ] **Step 1: Verify nothing remaining in `src/` or `scripts/` imports removed files or `inngest` / `@vercel/kv` / `archiver`**

Run: `rg -n "inngest|@vercel/kv|@/jobs|@/inngest|archiver|zip\.js" src/ scripts/ tests/ package.json`
Expected: Only references inside the files scheduled for deletion (or `scripts/README.md`).

- [ ] **Step 2: Remove legacy Inngest files, `lambda/`, `zip.js`, and uninstall `inngest` + `@vercel/kv`**

1. Delete `src/app/api/inngest/`, `src/inngest/`, `src/jobs/`, `lambda/`, and `zip.js`.
2. Run `npm uninstall inngest @vercel/kv` (plus `archiver` if unused).
3. Update `scripts/README.md` reference lines so docs match the new `src/workflows/*` and `src/app/api/schedules/*` paths.

- [ ] **Step 3: Run full verification suite**

Run:
1. `npx tsc --noEmit`
2. `npm run lint`
3. `npx jest tests/unit`
4. `npm run build`
5. `npx workflow validate` (if provided by `workflow` CLI to confirm `"use workflow"` / `"use step"` serialization and sandbox compliance)

Expected: All commands exit 0 with zero TypeScript, ESLint, workflow validation, build, or unit-test errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove legacy Inngest jobs, AWS Lambdas, and unused dependencies"
```
