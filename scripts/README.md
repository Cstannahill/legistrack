# Scripts Documentation

Utility scripts for manually managing bill data and AI processing.

## 🎯 Quick Start - Simplified Workflow

### Summarize Bills (STANDARD summaries only)

```bash
# With OpenAI GPT-5-nano (default, recommended for cost)
npm run summarize-bills-openai
BATCH_SIZE=20 npm run summarize-bills-openai

# With Anthropic Claude Sonnet 4.5 (higher quality, higher cost)
npm run summarize-bills-anthropic
BATCH_SIZE=10 npm run summarize-bills-anthropic

# With OpenRouter Models (FREE!)
npm run gen-sum-or deepseek HR 4398   # DeepSeek V3.1 (best quality)
npm run gen-sum-or qwen S 2309        # Qwen3 235B (great alternative)
npm run gen-sum-or gemini HRES 723    # Gemini 2.0 Flash (1M context)
npm run gen-sum-or mistral HR 5371    # Mistral Small 3.2 (fastest)

# Executive Orders with OpenRouter (FREE!)
npm run gen-sum-or-eo deepseek 14067  # DeepSeek V3.1 (best quality)
npm run gen-sum-or-eo qwen 14111      # Qwen3 235B (great alternative)
npm run gen-sum-or-eo gemini 14175    # Gemini 2.0 Flash (1M context)
npm run gen-sum-or-eo mistral 14177   # Mistral Small 3.2 (fastest)

# With explicit environment variables
AI_MODEL=openai BATCH_SIZE=15 npm run summarize-bills
AI_MODEL=anthropic BATCH_SIZE=5 npm run summarize-bills
```

### Summarize Executive Orders (STANDARD summaries only)

```bash
# With OpenAI GPT-5-nano (default, recommended for cost)
npm run summarize-eos-openai
BATCH_SIZE=20 npm run summarize-eos-openai

# With Anthropic Claude Sonnet 4.5 (higher quality, higher cost)
npm run summarize-eos-anthropic
BATCH_SIZE=10 npm run summarize-eos-anthropic

# With explicit environment variables
AI_MODEL=openai BATCH_SIZE=15 npm run summarize-executive-orders
AI_MODEL=anthropic BATCH_SIZE=5 npm run summarize-executive-orders
```

**Key Features:**

- ✅ **Only generates STANDARD summaries** (saves 2/3 of API costs)
- ✅ **Skips already-summarized items** (no wasted API calls)
- ✅ **Full model control** (choose OpenAI, Anthropic, or OpenRouter)
- ✅ **Batch size control** (manage costs precisely)
- ✅ **FREE OpenRouter models** (DeepSeek, Qwen, Gemini, Mistral)

**Cost Comparison (per item):**

- OpenRouter (DeepSeek, Qwen, etc.): **FREE** 🎉
- GPT-5-nano: ~$0.0003-0.001 per summary
- Claude Sonnet 4.5: ~$0.008-0.024 per summary
- **Savings: 3x cost reduction** (1 summary vs 3 per item)

**OpenRouter Models:**

| Model             | Command    | Best For                           |
| ----------------- | ---------- | ---------------------------------- |
| DeepSeek V3.1     | `deepseek` | Best overall quality (671B params) |
| Qwen3 235B        | `qwen`     | Strong reasoning (235B params)     |
| Gemini 2.0 Flash  | `gemini`   | Long bills (1M context)            |
| Mistral Small 3.2 | `mistral`  | Speed (24B params)                 |

## See [OPENROUTER_INTEGRATION.md](../docs/OPENROUTER_INTEGRATION.md) for full details.

## ⚠️ Important: Congress.gov API Limitation

**The Congress.gov API has a hard limit of 250 results per request.**

This means:

- Setting `LIMIT=1000` will still only return 250 bills
- To fetch more than 250 bills, you MUST use pagination
- **Use `fetch-bills-paginated` for automatic pagination** (recommended)
- Or manually paginate with `fetch-bill**Recent Improvements:**

- ✅ **Auto-fetches accurate `introducedDate` from details endpoint** (not available in list endpoint)
- ✅ **Auto-updates bill status** from latest action (INTRODUCED → PASSED_HOUSE → BECAME_LAW, etc.)
- ✅ **Auto-fetches full text for companion bills**
- ✅ Compares Claude 4.5 Sonnet vs GPT-5-nano
- ✅ Performance metrics for model comparison
- ✅ Fixed GPT-5-nano API parameters
- ✅ **Uses actual model names from API responses** (no longer hardcoded) `OFFSET` parameter

**Example:**

```bash
# ❌ This will only fetch 250 bills (not 1000!)
LIMIT=1000 npm run fetch-bills

# ✅ This will fetch 1000 bills (4 batches of 250)
TOTAL_BILLS=1000 npm run fetch-bills-paginated

# ✅ Or manually with fetch-bills
LIMIT=250 OFFSET=0 npm run fetch-bills    # Bills 0-249
LIMIT=250 OFFSET=250 npm run fetch-bills  # Bills 250-499
LIMIT=250 OFFSET=500 npm run fetch-bills  # Bills 500-749
LIMIT=250 OFFSET=750 npm run fetch-bills  # Bills 750-999
```

---

## Prerequisites

- Database must be set up and migrated
- Environment variables configured (`.env` file)
- Required API keys: `CONGRESS_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`

## Available Scripts

### 0. `test-generate-summary.ts` - **Single Bill Summary Generation (Testing & Comparison)** ⭐ NEW!

**Perfect for testing and comparing AI models on specific bills!**

**Usage:**

```bash
# Generate with OpenAI GPT-5-nano
npm run gen-sum openai HR 4398
npm run gen-sum openai S 2309
npm run gen-sum openai HRES 723

# Generate with Anthropic Claude Sonnet 4.5
npm run gen-sum anthropic HR 4398
npm run gen-sum anthropic S 2309

# Compare models back-to-back
npm run gen-sum openai HR 4398
npm run gen-sum anthropic HR 4398  # Same bill, different model
```

**What it does:**

1. ✅ **Checks database** for existing bill
2. ✅ **Fetches complete bill details** from Congress.gov:
   - Accurate `introducedDate`
   - Current status (PASSED_HOUSE, BECAME_LAW, etc.)
   - Latest action information
3. ✅ **Fetches full bill text** (required for summaries)
4. ✅ **Updates or creates bill** in database with all accurate data
5. ✅ **Generates 3 summaries** with selected model:
   - **BRIEF** ⚡ - Quick overview (2-3 sentences)
   - **STANDARD** 📋 - Balanced summary (1-2 paragraphs)
   - **ELI5** 👶 - Explain Like I'm 5 (simple language)
6. ✅ **Saves all summaries** to database
7. ✅ **Shows detailed output** with timing and content

**Example Output:**

```
================================================================================
🤖 SINGLE BILL SUMMARY GENERATION TEST
================================================================================
📄 Bill: HR 4398
🧠 Model: GPT-5-nano
🏛️  Congress: 119
================================================================================

1️⃣  Checking database...
   ✅ Found in database
   ID: cmg8l9v7n0000vg545sect9w0
   Title: Veteran Burial Timeliness and Death Certificate Accountability Act
   Status: PASSED_HOUSE
   Introduced: 2024-07-15
   Has Full Text: Yes
   Existing Summaries: 3
   Companion Bills:
     - S 2309

2️⃣  Fetching bill details from Congress.gov...
   ✅ Fetched bill details
   Title: Veteran Burial Timeliness and Death Certificate Accountability Act
   Introduced: 2024-07-15
   Latest Action: Passed House
   Latest Action Date: 2024-09-20
   Status: PASSED_HOUSE

3️⃣  Fetching bill text...
   ✅ Fetched full text
   Length: 4290 characters
   URL: https://api.congress.gov/v3/bill/119/hr/4398/text

4️⃣  Updating database...
   ✅ Updated bill in database

5️⃣  Generating summaries with GPT-5-nano...
================================================================================

⚡ Generating Brief summary...
✅ Brief summary generated (890ms)
   Model: gpt-5-nano
   Confidence: 85.0%
   Length: 238 chars

   Content:
   ----------------------------------------------------------------------------
   This bill requires the Department of Veterans Affairs to report burial
   timeline data and death certificate processing delays to Congress annually.
   ----------------------------------------------------------------------------

   Key Points:
   1. Mandates annual reporting on burial timelines
   2. Tracks death certificate processing delays
   3. Improves accountability for veteran burial services

   Impact Areas: Veterans, Families, VA Administration

[... STANDARD and ELI5 summaries ...]

================================================================================
✅ GENERATION COMPLETE
================================================================================
📄 Bill: HR 4398
🧠 Model: GPT-5-nano
📊 Summaries Generated: 3
⏱️  Total Time: 2540ms (2.54s)
💾 Database ID: cmg8l9v7n0000vg545sect9w0

💡 Tips:
   - Run with different model to compare:
     npm run gen-sum anthropic HR 4398
   - View in database: npm run db:studio
   - Check existing summaries: 6 already in DB
================================================================================
```

**Why use this?**

- ✅ **Quick testing** - Test a specific bill without processing hundreds
- ✅ **Model comparison** - Run same bill with both models to compare quality
- ✅ **Resolution switching** - Test House vs Senate versions (HR vs S)
- ✅ **Complete data** - Ensures bill has accurate dates, status, and text
- ✅ **Detailed output** - See exactly what each model generates
- ✅ **Database integration** - Saves everything for later viewing

**Perfect for:**

- Testing different resolutions (HR vs S)
- Comparing AI model outputs
- Quick summary generation for specific bills
- Ensuring data accuracy before bulk processing

---

### 1. `fetch-bills-paginated.ts` - **Paginated Bill Fetch (RECOMMENDED FOR LARGE DATASETS)**

**⭐ OPTIMIZED!** Automatically handles Congress.gov's 250-result API limit with pagination.

**🚀 NEW: Two-Phase Workflow** - Now optimized to skip text fetching for faster initial loads. Text is fetched during summarization when actually needed!

**Usage:**

```bash
# Fetch 1000 bills (default) - FAST (no text fetching)
npm run fetch-bills-paginated

# Fetch 500 bills with companion detection
TOTAL_BILLS=500 npm run fetch-bills-paginated

# Force text fetching (slower, not recommended)
FETCH_TEXT=true TOTAL_BILLS=100 npm run fetch-bills-paginated
```

**Environment Variables:**

- `TOTAL_BILLS` - Total number of bills to fetch (default: 1000)
- `FETCH_TEXT` - Fetch full text (default: **false**, for speed)
- `FETCH_COMPANIONS` - Link companion bills (default: true)

**What it does:**

- ✅ **Automatically handles pagination** (no manual offset management!)
- ✅ Fetches bills in batches of 250 (API maximum)
- ✅ **Detects and links companion bills** (HR ↔️ S versions)
- ✅ Shows progress for each batch
- ✅ Uses smart date fallback: `introducedDate || updateDate || latestAction.actionDate`
- ✅ **Skips text fetching by default** (much faster!)
- ✅ Rate limiting between batches (2 second delay)
- ✅ Comprehensive summary at the end

**Why skip text fetching?**

- List endpoint doesn't include text URLs anyway
- Requires individual API call per bill (slow)
- Text is fetched during summarization when needed
- Results in **10x faster** initial fetch

**Example Output:**

```
🏛️  Fetching bills from Congress.gov (Paginated)
📊 Congress: 119th
📦 Total Bills to Fetch: 1000
📄 Fetch Full Text: No         ← Optimized for speed
🔗 Fetch Companions: Yes
⚡ Batch Size: 250 (API limit)

� FINAL SUMMARY (All Batches):
   ✓ Total Created: 1000
   ↻ Total Updated: 0
   ✗ Total Skipped: 0
   📊 Total Processed: 1000
   📄 Total Text Fetched: 0        ← Expected (will fetch during summarization)
   ⚠️  Total Text N/A: 1000
   🔗 Total Companions Linked: 35  ← Companion detection working!

💡 Tip: Run 'npm run summarize-bills' to fetch text + generate AI summaries!
```

**⚠️ IMPORTANT:** The Congress.gov API list endpoint does NOT include `introducedDate` or text URLs. This script uses `updateDate` as a fallback. Accurate dates and full text are fetched during summarization.

---

### 2. `fetch-bills.ts` - Single Batch Fetch (Manual Pagination)

### 2. `fetch-bills.ts` - Single Batch Fetch (Manual Pagination)

Fetches a single batch of bills. **Limited to 250 bills per run** (Congress.gov API limit).

**⚠️ Note:** For fetching more than 250 bills, use `fetch-bills-paginated` instead!

**Usage:**

```bash
# Fetch 100 bills with full text (default)
npm run fetch-bills

# Fetch 250 bills (API maximum)
LIMIT=250 npm run fetch-bills

# Manual pagination for next 250 bills
LIMIT=250 OFFSET=250 npm run fetch-bills

# Fetch WITHOUT full text (faster)
FETCH_TEXT=false LIMIT=250 npm run fetch-bills
```

**Environment Variables:**

- `LIMIT` - Number of bills to fetch (default: 100, **max: 250**)
- `OFFSET` - Pagination offset (default: 0)
- `FETCH_TEXT` - Fetch full text (default: true)

**⚠️ API Limitation:** Congress.gov API returns a maximum of 250 results per request, regardless of the LIMIT you set. Setting `LIMIT=1000` will still only return 250 bills.

**Manual Pagination Example:**

```bash
# Fetch first 250 bills
LIMIT=250 OFFSET=0 npm run fetch-bills

# Fetch next 250 bills (251-500)
LIMIT=250 OFFSET=250 npm run fetch-bills

# Fetch next 250 bills (501-750)
LIMIT=250 OFFSET=500 npm run fetch-bills
```

**When to use this:**

- Testing with small datasets
- Manually controlling which bills to fetch
- Updating specific ranges of bills

**When NOT to use this:**

- Fetching more than 250 bills → Use `fetch-bills-paginated` instead!

**What it does:**

- Fetches bills from the current Congress (119th)
- **Automatically fetches full text when available** (if enabled)
- Creates new bills in the database
- Updates existing bills with latest status and missing text
- Handles date validation with proper fallbacks
- Rate limiting protection (300ms delay between text fetches)
- Visual indicators: 📄 = full text, 🔗 = URL only

**Recent Improvements:**

- ✅ Now fetches full text during initial fetch (configurable)
- ✅ Converts billNumber from string to integer (parseInt)
- ✅ Proper date validation with fallbacks
- ✅ Only updates text fields if not already present
- ✅ Rate limiting to avoid API throttling

**💡 Recommended:** Use `fetch-bills-paginated` for fetching large datasets automatically!

---

### 3. `fetch-bills-recent.ts` - Recent Bills (Last 30 Days)

Fetches only bills from the last 30 days. Perfect for testing without overwhelming the database.

**Usage:**

```bash
npm run fetch-bills-recent
```

**What it does:**

- Fetches bills introduced in the last 30 days
- Filters by date range automatically
- Creates/updates bills in the database
- Useful for testing with recent, active legislation
- **Note:** Does NOT fetch full text (optimized for speed)
- Handles date validation with proper fallbacks
- Converts billNumber to integer

**Note:** Returns fewer results, ideal for development and testing.

---

### 4. `fetch-bill-texts.ts` - Backfill Full Text

Batch fetches full text for bills that don't have it yet.

**Usage:**

```bash
# Fetch text for 20 bills (default)
npm run fetch-bill-texts

# Fetch text for 50 bills
BATCH_SIZE=50 npm run fetch-bill-texts
```

**Environment Variables:**

- `BATCH_SIZE` - Number of bills to process (default: 20)

**What it does:**

- Finds bills with `fullText: null`
- Attempts to fetch full text from Congress.gov
- Updates database with text and/or URL
- Rate limiting protection (500ms delay)
- Tracks success/failure statistics

**Note:** Many recently introduced bills won't have text available yet. Congress.gov typically takes a few days to publish full text after introduction.

---

### 5. `tag-legislation.ts` - **AI-Powered Categorization** 🏷️ NEW!

Automatically tags bills and executive orders with relevant categories using AI analysis.

**Usage:**

```bash
# Tag both bills and executive orders (default)
npm run tag-legislation

# Tag only bills
npm run tag-bills

# Tag only executive orders
npm run tag-executive-orders

# Custom batch size
BATCH_SIZE=20 npm run tag-legislation
```

**Environment Variables:**

- `BATCH_SIZE` - Number of items to tag per run (default: 10)
- `ITEM_TYPE` - What to tag: "bills", "executive-orders", or "both" (default: "both")
- `AI_PROVIDER` - AI model to use: "openai" or "claude" (default: "openai")

**What it does:**

- ✅ **Analyzes content with AI** - Uses GPT-5-nano to understand bills/EOs
- ✅ **Assigns 1-4 relevant categories** - Healthcare, Defense, Immigration, etc.
- ✅ **20 predefined categories** - Comprehensive policy area coverage
- ✅ **Confidence scoring** - AI provides confidence level (0-100%)
- ✅ **Reasoning explanations** - Shows why categories were selected
- ✅ **Creates category badges** - Color-coded for UI display
- ✅ **Handles errors gracefully** - Fallback to default category
- ✅ **Rate limiting** - 500ms delay between items

**Available Categories:**

Healthcare • Education • Defense & National Security • Economy & Jobs • Environment & Energy • Immigration • Tax & Budget • Transportation & Infrastructure • Criminal Justice • Civil Rights & Liberties • Technology & Telecommunications • Agriculture & Food • Housing & Urban Development • Trade & Commerce • Veterans Affairs • Social Services & Welfare • Foreign Policy & Diplomacy • Financial Services • Science & Research • Government Operations

**Example Output:**

```
🏷️  Legislative Tagging System
📦 Batch Size: 10 items
🧠 AI Provider: GPT-5-nano
📋 Item Type: both

📄 Processing: HR 4398
   Title: Veteran Burial Timeliness and Death Certificate Account...
   🤖 Analyzing with AI...
   📊 Confidence: 92%
   🏷️  Categories: veterans-affairs, healthcare
   💭 Reasoning: Focuses on VA opioid treatment programs, combining veteran services and healthcare
   ✅ Tagged successfully

📄 Processing: EO 14352
   Title: Saving TikTok While Protecting National Security...
   🤖 Analyzing with AI...
   📊 Confidence: 88%
   🏷️  Categories: technology-telecommunications, defense-national-security
   💭 Reasoning: Addresses tech platform regulation and national security concerns
   ✅ Tagged successfully

============================================================
📊 SUMMARY
============================================================
✅ Successfully tagged: 10
❌ Failed: 0
📝 Total processed: 10
```

**Cost per item:**

- GPT-5-nano: ~$0.001-0.003 per item
- Claude: ~$0.003-0.005 per item

**See also:** [Tagging System Documentation](../docs/TAGGING_SYSTEM.md)

---

### 6. `fetch-executive-orders.ts` - **Executive Orders & Presidential Documents** 🏛️

Fetches Executive Orders and other Presidential Documents from the Federal Register API.

**Usage:**

```bash
# Fetch 100 most recent executive orders (default)
npm run fetch-executive-orders

# Fetch 50 executive orders
LIMIT=50 npm run fetch-executive-orders

# Fetch all presidential document types
FETCH_ALL_TYPES=true npm run fetch-executive-orders

# Fetch with full text (slower)
FETCH_TEXT=true LIMIT=25 npm run fetch-executive-orders
```

**Environment Variables:**

- `LIMIT` - Number of documents to fetch (default: 100, max: 1000)
- `FETCH_TEXT` - Fetch full text content (default: false)
- `FETCH_ALL_TYPES` - Fetch all presidential doc types vs. just EOs (default: false)

**What it does:**

- ✅ Fetches presidential documents from Federal Register API (free, no key required!)
- ✅ Supports multiple document types:
  - `executive_order` - Official presidential directives
  - `presidential_memorandum` - Policy guidance documents
  - `proclamation` - Formal announcements
  - `determination` - Presidential findings
- ✅ Extracts order numbers automatically
- ✅ Parses signing and publication dates
- ✅ Optionally fetches full text content
- ✅ Updates existing records with missing data
- ✅ Handles duplicates by order number

**Example Output:**

```
🏛️  Fetching Executive Orders from Federal Register API
📊 Limit: 100
📄 Fetch Full Text: No
📋 Document Types: Executive Orders Only
================================================================================

📥 Fetching 100 documents...
✅ Fetched 97 documents

✓ Created: EXECUTIVE_ORDER 14152 [2025-09-28] - Advancing American Leadership...
✓ Created: EXECUTIVE_ORDER 14151 [2025-09-25] - Strengthening Cybersecurity...
○ Exists: EXECUTIVE_ORDER 14150
✓ Created: PRESIDENTIAL_MEMORANDUM 100124 [2025-09-20] - Climate Action Plan...

================================================================================
📊 SUMMARY
================================================================================
✓ Created: 72
↻ Updated: 8
○ Skipped: 17
📄 Text Fetched: 0
⚠️  Text N/A: 0
📊 Total Processed: 97
================================================================================

💡 Tip: Run with FETCH_TEXT=true to fetch full text for executive orders
```

**Why use this:**

- ✅ **No API key required** - Federal Register API is completely free
- ✅ **Comprehensive data** - Full historical archive of presidential documents
- ✅ **Fast fetching** - ~100 documents in 5-10 seconds (without text)
- ✅ **Multiple document types** - Not just executive orders
- ✅ **Reliable API** - Government-maintained, stable endpoints

**See also:** [Executive Orders Implementation Guide](../docs/EXECUTIVE_ORDERS_IMPLEMENTATION.md)

---

### 6. `summarize-bills.ts` - **Smart Text Fetch + AI Summarization** ⭐ ENHANCED!

**🚀 NEW: Two-Phase Workflow** - Now automatically fetches accurate bill details and full text from Congress.gov BEFORE generating summaries!

Generates AI summaries for bills without summaries. **Fetches missing data on-the-fly!**

**Usage:**

```bash
# Summarize 30 bills (default) - compares Claude vs GPT-5-nano
npm run summarize-bills

# Summarize 10 bills
BATCH_SIZE=10 npm run summarize-bills
```

**Environment Variables:**

- `BATCH_SIZE` - Number of bills to summarize (default: 30)

**What it does:**

1. **Finds bills without summaries**
2. **For each bill, fetches from Congress.gov Details endpoint:**
   - ✅ **Accurate `introducedDate`** (not available in list endpoint)
   - ✅ **Current bill status** (e.g., PASSED_HOUSE, BECAME_LAW, VETOED)
   - ✅ **Full bill text** (needed for AI summarization)
   - ✅ Updates database with all accurate data
3. **For companion bills:**
   - ✅ Fetches their `introducedDate`, status, and full text too
   - ✅ Ensures both House and Senate versions have complete and accurate data
4. **Generates AI summaries using full text:**
   - **BRIEF** - Quick overview (2-3 sentences)
   - **STANDARD** - Balanced summary (1-2 paragraphs)
   - **ELI5** - Explain Like I'm 5 (simple language)
5. **Compares both AI models:**
   - Claude 3.5 Sonnet (high quality, higher cost)
   - GPT-5-nano (fast, lower cost)
6. **Performance metrics:** Speed and output length comparison

**Example Output:**

```
📄 Processing: HR 4398
   Title: Veteran Burial Timeliness and Death Certificate Account...
   → Fetching bill details from Congress.gov...
   → Updated introducedDate: 2024-07-15         ← Accurate date from details endpoint
   → Updated status: PASSED_HOUSE               ← Accurate status from latest action
   → Fetching full text from Congress.gov...
   ✓ Updated bill with fetched data
   🔗 Found 1 companion bill(s)
   → Fetching text for companion: S 2309...    ← Also fetches companion data
   ✓ Updated companion S 2309

   🤖 Comparing Claude vs GPT-5-nano:
   → Claude: Generating Brief summary...
   ✓ Claude Brief: 245 chars in 1250ms
   → GPT-5-nano: Generating Brief summary...
   ✓ GPT-5-nano Brief: 238 chars in 890ms
   📊 Speed: GPT-5-nano 28.8% faster | Length diff: +7 chars
   ...
```

**Why this is better:**

- ✅ **Accurate dates**: Fetches `introducedDate` from details endpoint (not available in list endpoint)
- ✅ **Accurate status**: Updates bill status based on latest action (not stuck at INTRODUCED)
- ✅ **Full text guaranteed**: No fallback to titles, proper AI summaries
- ✅ **Companion bills handled**: Both House and Senate versions get complete data
- ✅ **Efficient**: Only fetches details when actually summarizing (not for all 1000 bills)
- ✅ **Database always updated**: Missing data is backfilled automatically

**Recent Improvements:**

- ✅ **Auto-fetches accurate `introducedDate` from details endpoint**
- ✅ **Auto-updates bill status** from latest action (INTRODUCED → PASSED_HOUSE → BECAME_LAW, etc.)
- ✅ **Auto-fetches full text for companion bills**
- ✅ Compares Claude 3.5 Sonnet vs GPT-5-nano
- ✅ Performance metrics for model comparison
- ✅ Fixed GPT-5-nano API parameters

**Note:** Uses Claude API and OpenAI API - costs money per summary! But ensures highest quality summaries with accurate source data.

---

## Typical Testing Workflow

### 🚀 Recommended: Two-Phase Approach (Fast + Accurate)

**Phase 1: Fast Metadata Fetch**

```bash
# Fetch 1000 bills rapidly (metadata only, no text)
npm run fetch-bills-paginated
# Result: 1000 bills in ~5-10 minutes, companion links established
```

**Phase 2: Smart Summarization (fetches details as needed)**

```bash
# Summarize 30 bills (auto-fetches accurate dates + full text)
npm run summarize-bills
# Result: 30 bills with accurate introducedDate, full text, and AI summaries
```

This approach is **10x faster** than fetching text upfront and ensures accurate data when you need it!

---

### Initial Setup

```bash
# 1. Set up database
npm run db:push
npm run db:seed

# 2. Fast fetch of 1000 bills (Phase 1)
npm run fetch-bills-paginated

# 3. Summarize a few bills to test AI (Phase 2)
BATCH_SIZE=5 npm run summarize-bills

# 4. View in browser
npm run dev
```

### Testing with More Data

```bash
# Fetch 500 bills (fast, metadata only)
TOTAL_BILLS=500 npm run fetch-bills-paginated

# Summarize 10 of them (auto-fetches details + text)
BATCH_SIZE=10 npm run summarize-bills
```

### Full Data Load (Production-like)

```bash
# Fetch 5000 bills rapidly (metadata + companion links)
TOTAL_BILLS=5000 npm run fetch-bills-paginated

# Process summaries in batches to avoid rate limits
BATCH_SIZE=20 npm run summarize-bills
# Run multiple times until all bills are summarized
```

### Legacy Approach (Old, Slower)

If you still want to fetch text upfront (not recommended):

```bash
# Fetch WITH text (10x slower, not needed anymore)
FETCH_TEXT=true TOTAL_BILLS=100 npm run fetch-bills-paginated

# Or backfill text separately
npm run fetch-bill-texts
```

### Manual Pagination (Advanced)

If you need precise control over which bills to fetch:

```bash
# Fetch bills 0-249
LIMIT=250 OFFSET=0 npm run fetch-bills

# Fetch bills 250-499
LIMIT=250 OFFSET=250 npm run fetch-bills

# Fetch bills 500-749
LIMIT=250 OFFSET=500 npm run fetch-bills

# Or just use the automated script:
TOTAL_BILLS=750 npm run fetch-bills-paginated
```

---

## Automated Jobs vs. Manual Scripts

| Feature             | Manual Scripts            | Automated Jobs (Inngest) |
| ------------------- | ------------------------- | ------------------------ |
| **Fetch Bills**     | `npm run fetch-bills`     | Cron: Every 6 hours      |
| **Summarize Bills** | `npm run summarize-bills` | Cron: Daily at 2 AM      |
| **Error Handling**  | Basic, fails fast         | Automatic retries        |
| **Concurrency**     | Sequential                | Parallel processing      |
| **Best For**        | Testing, one-time loads   | Production, ongoing sync |

---

## Troubleshooting

### No bills fetched

- **Check API key**: Ensure `CONGRESS_API_KEY` is set in `.env`
- **Check date range**: Congress may not be in session
- **Check API limits**: Congress.gov has rate limits

### Summarization fails

- **Check API key**: Ensure `ANTHROPIC_API_KEY` is set
- **Check bill text**: Some bills may not have full text available
- **Rate limits**: Claude API has rate limits, reduce `BATCH_SIZE`
- **Cost**: Each summary costs ~$0.01-0.05

### Database errors

- **Run migrations**: `npm run db:push` or `npm run db:migrate`
- **Check connection**: Verify `DATABASE_URL` in `.env`
- **Seed data**: Run `npm run db:seed` for categories

---

## Cost Estimates

### Congress.gov API

- **Free** - No cost for fetching bills
- Rate limits: ~5,000 requests per hour

### Anthropic Claude API

- **~$0.024 per summary** (with prompt caching after first request)
- **~$0.0375 per summary** (first request without cache)
- 3 bills = ~$0.11 (Claude only, with caching)
- 30 bills = ~$2.17 (Claude only, with caching) - **saves ~$1.20 vs no caching!**
- 100 bills = ~$7.20 (Claude only, with caching)
- Use `BATCH_SIZE` to control costs
- **💡 Prompt caching saves 35-44%** on batch processing costs!

### OpenAI GPT-5-nano API

- **~$0.0005-0.001 per summary** (with automatic prompt caching)
- 3 bills = ~$0.01 (GPT-5-nano only)
- 30 bills = ~$0.15 (GPT-5-nano only)
- 100 bills = ~$0.50 (GPT-5-nano only)
- **💡 Automatic caching** provides ~44% input cost reduction

### Dual Model Comparison (Default)

- Summarize-bills generates **6 summaries per bill** (3 types × 2 models)
- 3 bills = ~$0.12 total (~$0.11 Claude + ~$0.01 GPT-5-nano) with caching
- 10 bills = ~$0.40 total with caching
- 30 bills = ~$2.32 total with caching (vs $3.50 without!)
- **Caching provides significant savings on batch operations!**

**Note:** Both AI summarizers now use prompt caching to reduce costs. See [Prompt Caching Implementation](../docs/PROMPT_CACHING_IMPLEMENTATION.md) for details.

---

## Development Tips

1. **Start small**: Use `fetch-bills-recent` for testing
2. **Batch wisely**: Summarize 3-5 bills at a time during development
3. **Check logs**: Scripts have detailed console output
4. **Use Prisma Studio**: `npm run db:studio` to inspect data
5. **Monitor costs**: Watch Claude API usage in Anthropic dashboard

---

## See Also

- [Inngest Functions](../src/inngest/functions.ts) - Automated job definitions
- [Congress API Client](../src/lib/api/congress.ts) - API wrapper
- [AI Summarizer](../src/lib/ai/summarizer.ts) - Claude integration
- [Architecture Doc](../architecture.md) - Full system design
