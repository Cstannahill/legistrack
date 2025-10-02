# Quick Reference: Fetching Bills with Pagination

## The Problem

Congress.gov API has a **hard limit of 250 results per request**, regardless of the `LIMIT` parameter you set.

## The Solution

### ⭐ Recommended: Use Automated Pagination

```bash
# Fetch 5000 bills with full text (automatic pagination)
TOTAL_BILLS=5000 npm run fetch-bills-paginated

# Fetch 5000 bills WITHOUT text (faster)
FETCH_TEXT=false TOTAL_BILLS=5000 npm run fetch-bills-paginated

# Default is 1000 bills with text
npm run fetch-bills-paginated
```

**What happens:**

- Script automatically divides 5000 into 20 batches of 250
- Processes each batch with 2-second delay between batches
- Shows progress for each batch
- Provides comprehensive final summary

### Manual Pagination (If Needed)

```bash
# Batch 1: Bills 0-249
LIMIT=250 OFFSET=0 npm run fetch-bills

# Batch 2: Bills 250-499
LIMIT=250 OFFSET=250 npm run fetch-bills

# Batch 3: Bills 500-749
LIMIT=250 OFFSET=500 npm run fetch-bills

# And so on...
```

## Performance Notes

### With Full Text Fetching (`FETCH_TEXT=true`)

- **Time per bill**: ~1-2 seconds (300ms API delay + fetch time)
- **Time for 250 bills**: ~8-15 minutes
- **Time for 1000 bills**: ~30-60 minutes
- **Time for 5000 bills**: ~2.5-5 hours

### Without Full Text (`FETCH_TEXT=false`)

- **Time per bill**: ~0.1-0.2 seconds
- **Time for 250 bills**: ~30 seconds
- **Time for 1000 bills**: ~2 minutes
- **Time for 5000 bills**: ~10 minutes

## Recommended Strategy

### Option 1: Two-Step Approach (Fastest)

```bash
# Step 1: Fetch metadata only (fast)
FETCH_TEXT=false TOTAL_BILLS=5000 npm run fetch-bills-paginated

# Step 2: Backfill text for older bills that have it
npm run fetch-bill-texts
```

### Option 2: Direct with Text (Slower but Complete)

```bash
# Fetch everything in one go
TOTAL_BILLS=5000 npm run fetch-bills-paginated
```

## Why Go Back 5000 Bills?

- **Recent bills** (0-250): Very new, text usually not available yet
- **Recent bills** (250-1000): May have some text, but most still pending
- **Older bills** (1000-5000): Much more likely to have full text published
- **Going back further** increases chances of finding bills with full text

## Example Run (5000 bills with text)

```
🏛️  Fetching bills from Congress.gov (Paginated)
📊 Congress: 119th
📦 Total Bills to Fetch: 5000
📄 Fetch Full Text: Yes
⚡ Batch Size: 250 (API limit)

🔢 Will process 20 batch(es)

📦 Batch 1/20 (offset: 0, limit: 250)
============================================================
↻ Updated: HR 5650
↻ Updated: HR 5649
... (247 more bills)

📊 Batch 1 Summary:
   ✓ Created: 0
   ↻ Updated: 250
   ✗ Skipped: 0
   📄 Text Fetched: 0      ← Recent bills don't have text yet
   ⚠️  Text N/A: 250

⏳ Waiting 2 seconds before next batch...

📦 Batch 8/20 (offset: 1750, limit: 250)
============================================================
✓ Created: HR 1234 📄 [45KB] - Sample Bill Title...  ← Found text!
↻ Updated: HR 1235 📄 [+text]                        ← Added text to existing!
... (248 more bills)

📊 Batch 8 Summary:
   ✓ Created: 5
   ↻ Updated: 245
   ✗ Skipped: 0
   📄 Text Fetched: 127    ← Success! Older bills have text
   ⚠️  Text N/A: 123

[...continues through all 20 batches...]

📈 FINAL SUMMARY (All Batches):
   ✓ Total Created: 2500
   ↻ Total Updated: 2500
   ✗ Total Skipped: 0
   📊 Total Processed: 5000
   📄 Total Text Fetched: 1847     ← Found text for ~37% of bills!
   ⚠️  Total Text N/A: 3153

💡 Tip: Run 'npm run summarize-bills' to generate AI summaries!
```

## Tips

1. **Start with metadata only** if you just want to populate the database
2. **Use pagination script** for anything over 250 bills
3. **Run during off-hours** if fetching thousands of bills with text
4. **Monitor the logs** to see progress
5. **Be patient** - large fetches take time!

## Troubleshooting

**Script seems stuck?**

- It's probably fetching text (300ms delay per bill)
- Check the Prisma query logs - you'll see UPDATE queries
- Wait for batch summary to appear

**No text being fetched?**

- Recent bills don't have text published yet
- Try going further back (OFFSET=2000+)
- Or run `fetch-bill-texts` later to backfill

**Getting rate limited?**

- Increase delay in script (change 300ms to 500ms)
- Run smaller batches with breaks between
- Use `FETCH_TEXT=false` and backfill later
