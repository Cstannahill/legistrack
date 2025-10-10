# OpenAI Summarization Fix - October 2, 2025

## Problem Identified

The OpenAI bill summarization was generating poor quality summaries with messages like "Only able to go off the title..." because:

1. **Fallback to Title**: When `fetchBillText()` failed to retrieve full text, the script used this fallback logic:

   ```typescript
   const textToSummarize = sourceText || bill.officialTitle || bill.title || "";
   ```

   This caused summaries to be generated using ONLY the title, resulting in terrible quality.

2. **Missing Full Text Not Handled**: When the Congress.gov API couldn't provide bill text (text not yet published), the script would:

   - Set `sourceText = null`
   - Fall back to using just the title
   - Generate a useless summary
   - Save that bad summary to the database

3. **Inconsistent Behavior**: The executive orders script properly skipped items without full text, but the bills script did not.

## Root Cause

Many bills in Congress are introduced but their full text is not immediately available via the API. The old logic would:

- Attempt to fetch text → API returns `{ text: null, url: "...", date: "..." }`
- Script interprets this as "no text available"
- Falls back to title-only summarization
- Generates poor quality output

## Solution Implemented

### 1. Skip Bills Without Full Text

Updated `scripts/summarize-bills.ts` to:

```typescript
if (!textData || !textData.text) {
  console.log(`   ⚠️  Full text not available yet for ${billIdentifier}`);
  console.log(`   ⏭️  Skipping - will retry once text is published`);
  failCount++;
  continue; // Skip this bill entirely
}
```

### 2. Removed Title Fallback

Removed the dangerous fallback logic:

```typescript
// OLD (BAD):
const textToSummarize = sourceText || bill.officialTitle || bill.title || "";

// NEW (GOOD):
// Just use sourceText directly, after validating it exists
```

### 3. Added Length Validation

Added check to ensure we have substantial text:

```typescript
if (!sourceText || sourceText.length < 100) {
  console.log(`   ⚠️  No full text available (only have title/metadata)`);
  console.log(
    `   ⏭️  Skipping - cannot generate quality summary without full text`
  );
  failCount++;
  continue;
}
```

### 4. Use sourceText Directly

Changed summary generation calls to use `sourceText` directly instead of `textToSummarize`:

```typescript
summary = await generateSummaryOpenAI({
  title: bill.title || billIdentifier,
  fullText: sourceText, // ← Now using validated full text only
  summaryType: "STANDARD",
});
```

## Impact

### Before Fix:

- ❌ Generated summaries from titles only
- ❌ Saved poor quality summaries to database
- ❌ No way to distinguish good vs bad summaries
- ❌ Wasted API calls on incomplete data
- ❌ Created "Only able to go off the title..." summaries

### After Fix:

- ✅ Skips bills without full text
- ✅ Only generates summaries with actual bill content
- ✅ Provides clear feedback when text unavailable
- ✅ Can re-run script later when text becomes available
- ✅ Consistent behavior with executive orders script
- ✅ Better use of API credits

## Testing Recommendations

1. **Test with bill that has no text yet**:

   ```bash
   npm run summarize-bills-openai
   ```

   Should see: "⚠️ Full text not available yet" and skip

2. **Test with bill that has full text**:

   ```bash
   npm run gen-sum openai HR 5328
   ```

   Should generate quality summary with full context

3. **Check completeness gap**:
   ```bash
   npm run check-completeness
   ```
   Gap between "Without Summaries" and "Without Full Text" should close over time as text becomes available

## Related Scripts

- ✅ `scripts/summarize-bills.ts` - **FIXED**
- ✅ `scripts/summarize-executive-orders.ts` - Already handled correctly
- ℹ️ `scripts/test-generate-summary.ts` - Uses similar logic (should work correctly)

## Next Steps

1. Delete bad summaries generated with title-only:

   ```sql
   DELETE FROM "Summary" WHERE "content" LIKE '%Only able to go off the title%';
   DELETE FROM "Summary" WHERE LENGTH("content") < 100 AND "aiModel" LIKE '%gpt%';
   ```

2. Re-run summarization for those bills:

   ```bash
   npm run summarize-bills-openai
   ```

3. For bills still without text, wait for Congress.gov to publish, then re-run.

## Prevention

The script now validates full text BEFORE attempting summarization, ensuring:

- No more title-only summaries
- Clear user feedback about availability
- Proper retry mechanism (just re-run the script later)
- Consistent quality across all AI models
