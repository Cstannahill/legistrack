# Workflow Optimization: Two-Phase Bill Processing

## Problem Identified

The Congress.gov API has two endpoints with different data:

1. **List Endpoint** (`/bill/{congress}`)

   - ❌ No `introducedDate` field
   - ❌ No bill text
   - ✅ Fast batch fetching (250 bills/request)
   - ✅ Has `updateDate` and `latestAction.actionDate`

2. **Details Endpoint** (`/bill/{congress}/{billType}/{billNumber}`)
   - ✅ Has accurate `introducedDate`
   - ✅ Can fetch full text via separate call
   - ❌ Requires individual API call per bill
   - ❌ Slow for bulk operations

## Solution: Two-Phase Approach

### Phase 1: Fast Metadata Fetch (`fetch-bills-paginated.ts`)

**Goal:** Quickly populate database with basic bill info

**What it does:**

- ✅ Fetches 1000+ bills rapidly using list endpoint
- ✅ Detects and links companion bills automatically
- ✅ Stores: title, type, number, congress, status, updateDate
- ❌ **Does NOT fetch** full text (saves time and API calls)
- ❌ Uses `updateDate` as fallback (less accurate but available)

**Configuration:**

```bash
# Default settings (recommended)
npm run fetch-bills-paginated

# Custom settings
TOTAL_BILLS=5000 FETCH_COMPANIONS=true npm run fetch-bills-paginated

# Force text fetching (slow, not recommended)
TOTAL_BILLS=100 FETCH_TEXT=true npm run fetch-bills-paginated
```

**Result:**

- 1000 bills fetched in ~5-10 minutes
- Companion relationships established
- Ready for summarization

### Phase 2: Smart Text Fetch + Summarization (`summarize-bills.ts`)

**Goal:** Fetch detailed data only when needed for AI processing

**What it does:**

1. ✅ Queries bills without summaries
2. ✅ For each bill:
   - Fetches **accurate** `introducedDate` from details endpoint
   - Fetches **current status** from latest action (e.g., PASSED_HOUSE, BECAME_LAW)
   - Fetches full bill text
   - Updates database with all accurate data
3. ✅ For companion bills:
   - Fetches their `introducedDate`, status, and full text too
   - Ensures both versions have complete and accurate data
4. ✅ Generates AI summaries using full text
5. ✅ Compares Claude vs GPT-5-nano

**Configuration:**

```bash
# Default: 30 bills
npm run summarize-bills

# Custom batch size
BATCH_SIZE=50 npm run summarize-bills
```

**Result:**

- Accurate introduced dates from details endpoint
- Full bill text for AI summarization
- Companion bills also get their text fetched
- Database fully populated with accurate data

## Benefits of This Approach

### ✅ Speed

- Phase 1: Fast bulk fetch (1000 bills in minutes)
- Phase 2: Only fetch details when needed

### ✅ API Efficiency

- Avoid 1000+ individual detail calls upfront
- Only call details endpoint for bills you'll summarize
- Reduces overall API usage

### ✅ Accuracy

- Phase 1: Uses available dates (good enough for listing)
- Phase 2: Fetches accurate `introducedDate` when summarizing
- Best of both worlds

### ✅ Flexibility

- Can run Phase 1 anytime to get new bills fast
- Run Phase 2 when ready to generate summaries
- Can summarize in smaller batches (cost control)

## Workflow Example

```bash
# Step 1: Fast fetch of recent bills
npm run fetch-bills-paginated
# Result: 1000 bills with metadata, 35 companion links

# Step 2: Summarize first 30 bills
npm run summarize-bills
# Result: 30 bills with:
#   - Accurate introducedDate from details endpoint
#   - Full text from text endpoint
#   - AI-generated summaries (Claude + GPT-5-nano)
#   - Companion bills also updated with text

# Step 3: Summarize more bills in batches
BATCH_SIZE=50 npm run summarize-bills
# Processes next 50 bills without summaries
```

## Configuration Reference

### `fetch-bills-paginated.ts`

```bash
TOTAL_BILLS=1000        # Number of bills to fetch
FETCH_TEXT=false        # Skip text (default, faster)
FETCH_COMPANIONS=true   # Link companion bills (default)
```

### `summarize-bills.ts`

```bash
BATCH_SIZE=30          # Bills to summarize per run
```

## Updated Output Examples

### Phase 1: Fast Fetch

```
📈 FINAL SUMMARY (All Batches):
   ✓ Total Created: 1000
   ↻ Total Updated: 0
   ✗ Total Skipped: 0
   📊 Total Processed: 1000
   📄 Total Text Fetched: 0          ← Intentionally 0 (faster)
   ⚠️  Total Text N/A: 1000           ← Expected (will fetch later)
   🔗 Total Companions Linked: 35     ← Companion detection working!
```

### Phase 2: Summarization

```
📄 Processing: HR 4398
   Title: Veteran Burial Timeliness and Death Certificate Account...
   → Fetching bill details from Congress.gov...
   → Updated introducedDate: 2024-07-15
   → Fetching full text from Congress.gov...
   ✓ Updated bill with fetched data
   🔗 Found 1 companion bill(s)
   → Fetching text for companion: S 2309...
   ✓ Updated companion S 2309

   🤖 Comparing Claude vs GPT-5-nano:
   → Claude: Generating Brief summary...
   ✓ Claude Brief: 245 chars in 1250ms
   → GPT-5-nano: Generating Brief summary...
   ✓ GPT-5-nano Brief: 238 chars in 890ms
   ...
```

## Migration Notes

### What Changed?

1. `FETCH_TEXT` now defaults to `false` in `fetch-bills-paginated.ts`
2. `summarize-bills.ts` now fetches:
   - Accurate `introducedDate` from details endpoint
   - Full text for main bill
   - Full text for companion bills
3. Date fallback chain in paginated fetch:
   ```typescript
   introducedDate || updateDate || latestAction.actionDate;
   ```

### Backward Compatibility

- Old behavior: `FETCH_TEXT=true npm run fetch-bills-paginated`
- Still works, just slower and unnecessary now
- Recommended: Use new two-phase approach

## Best Practices

1. **Initial Setup:**

   ```bash
   npm run fetch-bills-paginated  # Get metadata fast
   npm run summarize-bills        # Add details + summaries
   ```

2. **Regular Updates:**

   ```bash
   npm run fetch-bills-paginated  # Get new bills
   npm run summarize-bills        # Summarize new ones
   ```

3. **Cost Control:**

   - Summarize in small batches (`BATCH_SIZE=10`)
   - Monitor AI API costs
   - Only summarize important bills if needed

4. **Testing:**
   ```bash
   TOTAL_BILLS=10 npm run fetch-bills-paginated
   BATCH_SIZE=5 npm run summarize-bills
   ```
