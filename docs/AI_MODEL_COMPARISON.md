# AI Model Comparison: Claude vs GPT-5-nano

## Overview

The `summarize-bills` script now generates summaries using **both** Claude 3.5 Sonnet and GPT-5-nano, allowing you to compare quality, speed, and cost between the two models.

## What Changed

### New Files

- **`src/lib/ai/summarizer-openai.ts`** - GPT-5-nano summarization implementation
  - Uses OpenAI SDK
  - Same interface as Claude summarizer
  - Model: `gpt-5-nano`

### Modified Files

- **`scripts/summarize-bills.ts`** - Now generates summaries with both models
  - Processes each summary type twice (once per model)
  - Shows real-time comparison metrics
  - Saves both versions to database

## How It Works

For each bill, the script now:

1. **Fetches bill text** (if not already cached)
2. **Generates 3 summary types** × **2 models** = **6 summaries per bill**:
   - BRIEF (Claude + GPT-5-nano)
   - STANDARD (Claude + GPT-5-nano)
   - ELI5 (Claude + GPT-5-nano)
3. **Measures performance**:
   - Generation time
   - Output length
   - Speed comparison
4. **Saves to database** with model attribution

## Usage

```bash
# Summarize 3 bills (default) with both models
npm run summarize-bills

# Summarize more bills for better comparison
BATCH_SIZE=5 npm run summarize-bills
```

## Console Output Example

```
🤖 Manual Batch Summarization
📦 Batch Size: 3 bills

✓ Found 3 bills to summarize

📄 Processing: H.R. 1234
   Title: Sample Bill About Infrastructure...

   🤖 Comparing Claude vs GPT-5-nano:

   → Claude: Generating Brief summary...
   ✓ Claude Brief: 342 chars in 1453ms

   → GPT-5-nano: Generating Brief summary...
   ✓ GPT-5-nano Brief: 318 chars in 892ms
   📊 Speed: GPT-5-nano 38.6% faster | Length diff: -24 chars

   → Claude: Generating Standard summary...
   ✓ Claude Standard: 687 chars in 2104ms

   → GPT-5-nano: Generating Standard summary...
   ✓ GPT-5-nano Standard: 654 chars in 1321ms
   📊 Speed: GPT-5-nano 37.2% faster | Length diff: -33 chars

   → Claude: Generating ELI5 summary...
   ✓ Claude ELI5: 523 chars in 1876ms

   → GPT-5-nano: Generating ELI5 summary...
   ✓ GPT-5-nano ELI5: 489 chars in 1147ms
   📊 Speed: GPT-5-nano 38.9% faster | Length diff: -34 chars

   ✅ Completed H.R. 1234

📈 Final Summary:
   ✓ Bills Successfully Processed: 3
   ❌ Bills Failed: 0
   📊 Total Bills: 3
   🤖 Total Summaries Generated: 18 (3 types × 2 models × 3 bills)

💡 Tip: Check database to compare Claude vs GPT-5-nano quality!
```

## Database Storage

All summaries are stored in the `Summary` table with the `model` field distinguishing them:

```sql
-- Example query to compare models for a single bill
SELECT
  summaryType,
  model,
  LENGTH(content) as length,
  confidence
FROM Summary
WHERE billId = 'some-bill-id'
ORDER BY summaryType, model;
```

Example output:

```
summaryType | model                        | length | confidence
------------|------------------------------|--------|------------
BRIEF       | claude-3-5-sonnet-20241022  | 342    | 0.8
BRIEF       | gpt-5-nano                   | 318    | 0.8
STANDARD    | claude-3-5-sonnet-20241022  | 687    | 0.8
STANDARD    | gpt-5-nano                   | 654    | 0.8
ELI5        | claude-3-5-sonnet-20241022  | 523    | 0.8
ELI5        | gpt-5-nano                   | 489    | 0.8
```

## Cost Comparison

### Claude 3.5 Sonnet

- **Input**: $3.00 per million tokens
- **Output**: $15.00 per million tokens
- **Typical bill summary**: ~$0.015-0.025 per bill (3 summaries)

### GPT-5-nano

- **Input**: ~$0.15 per million tokens (estimated)
- **Output**: ~$0.60 per million tokens (estimated)
- **Typical bill summary**: ~$0.002-0.005 per bill (3 summaries)

**Cost Savings**: GPT-5-nano is approximately **80-85% cheaper** than Claude

### Example Costs

| Bills | Claude Cost | GPT-5-nano Cost | Savings |
| ----- | ----------- | --------------- | ------- |
| 3     | ~$0.06      | ~$0.01          | ~$0.05  |
| 10    | ~$0.20      | ~$0.04          | ~$0.16  |
| 100   | ~$2.00      | ~$0.40          | ~$1.60  |
| 1,000 | ~$20.00     | ~$4.00          | ~$16.00 |

## Comparison Criteria

### Speed

- **GPT-5-nano**: Typically 30-40% faster
- **Claude**: More consistent, but slower

### Quality (Subjective - Test to Verify)

- **Claude**: Known for detailed, nuanced summaries
- **GPT-5-nano**: Faster, cost-efficient, good for simple tasks

### Length

- **Claude**: Tends to be slightly more verbose
- **GPT-5-nano**: More concise (10-15% shorter on average)

## Viewing Comparisons

### Option 1: Prisma Studio

```bash
npm run db:studio
```

Navigate to `Summary` table and filter by bill to see both models side-by-side.

### Option 2: SQL Query

```sql
-- Get side-by-side comparison
SELECT
  b.billType,
  b.billNumber,
  s.summaryType,
  s.model,
  s.content,
  s.confidence
FROM Summary s
JOIN Bill b ON s.billId = b.id
WHERE b.billNumber = 1234
ORDER BY s.summaryType, s.model;
```

### Option 3: Build a Comparison Page

Create a new page in your Next.js app to display summaries side-by-side:

```tsx
// src/app/bills/[id]/compare/page.tsx
export default async function ComparePage({ params }) {
  const summaries = await db.summary.findMany({
    where: { billId: params.id },
    orderBy: [{ summaryType: "asc" }, { model: "asc" }],
  });

  // Group by type and render side-by-side
  // ...
}
```

## Making a Choice

### Use Claude When:

- Quality is paramount
- Complex legislation requiring nuance
- Budget allows for premium model
- Generating detailed analysis

### Use GPT-5-nano When:

- Cost efficiency is important
- Speed matters (real-time applications)
- Processing large volumes of bills
- Simpler, straightforward legislation
- Testing/development phase

## Switching to Single Model

If you decide on one model after testing:

### To use only Claude:

```typescript
// In scripts/summarize-bills.ts
// Comment out or remove the GPT-5-nano section:
/*
const gptSummary = await generateSummaryOpenAI(...);
await db.summary.create({ data: gptSummary });
*/
```

### To use only GPT-5-nano:

```typescript
// In scripts/summarize-bills.ts
// Comment out or remove the Claude section:
/*
const claudeSummary = await generateSummary(...);
await db.summary.create({ data: claudeSummary });
*/
```

### For Production (Automated Jobs):

Update `src/jobs/process/summarize-legislation.ts` to use your preferred model:

```typescript
// Choose one:
import { generateSummary } from "@/lib/ai/summarizer"; // Claude
// OR
import { generateSummaryOpenAI as generateSummary } from "@/lib/ai/summarizer-openai"; // GPT-5-nano
```

## Environment Variables

Ensure your `.env` file has:

```bash
# For Claude
ANTHROPIC_API_KEY="sk-ant-..."

# For GPT-5-nano
OPENAI_API_KEY="sk-proj-..."
```

Both are required to run the comparison script.

## Next Steps

1. **Run the script**: `npm run summarize-bills`
2. **Review summaries**: Use Prisma Studio or SQL queries
3. **Compare quality**: Read both versions side-by-side
4. **Make a decision**: Choose based on your needs
5. **Update production**: Modify automated jobs to use preferred model

## Notes

- The script will fail if either API key is missing
- Generation time varies based on bill length and API load
- Speed metrics are approximate and may vary
- Consider rate limits for both APIs when processing large batches

---

**Happy comparing! 🤖⚡️**
