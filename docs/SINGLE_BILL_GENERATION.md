# Single Bill Summary Generation Test Script

## Quick Reference

### Usage

```bash
# OpenAI GPT-5-nano
npm run gen-sum openai HR 4398
npm run gen-sum openai S 2309
npm run gen-sum openai HRES 723

# Anthropic Claude Sonnet 4.5
npm run gen-sum anthropic HR 4398
npm run gen-sum anthropic S 2309
npm run gen-sum anthropic SRES 381
```

### Syntax

```
npm run gen-sum <model> <billType> <billNumber>
```

**Models:**

- `openai` - GPT-5-nano (fast, cheaper)
- `anthropic` - Claude Sonnet 4.5 (smarter, same price as 3.5)

**Bill Types:**

- `HR` - House Bill
- `S` - Senate Bill
- `HRES` - House Resolution
- `SRES` - Senate Resolution
- `HJRES` - House Joint Resolution
- `SJRES` - Senate Joint Resolution

## What It Does

1. **Fetches from Congress.gov:**

   - Bill details (accurate introducedDate)
   - Current status (PASSED_HOUSE, BECAME_LAW, etc.)
   - Full bill text

2. **Updates Database:**

   - Creates or updates bill with accurate data
   - Stores introducedDate, status, statusDate
   - Saves full text and URL

3. **Generates Summaries:**

   - BRIEF ⚡ - 2-3 sentences
   - STANDARD 📋 - 1-2 paragraphs
   - ELI5 👶 - Simple language explanation

4. **Saves to Database:**
   - All 3 summaries saved
   - Includes model name, confidence score
   - Key points and impact areas

## Comparison Workflow

### Test Same Bill with Both Models

```bash
# Generate with OpenAI
npm run gen-sum openai HR 4398

# Generate with Anthropic (same bill)
npm run gen-sum anthropic HR 4398

# View in database to compare
npm run db:studio
```

### Test Companion Bills (House vs Senate)

```bash
# House version with OpenAI
npm run gen-sum openai HR 4398

# Senate version with Anthropic
npm run gen-sum anthropic S 2309

# These are companion bills - see how models handle each
```

### Test Different Resolutions

```bash
# House Resolution with OpenAI
npm run gen-sum openai HRES 723

# Senate Resolution with Anthropic
npm run gen-sum anthropic SRES 381
```

## Output Structure

```
================================================================================
🤖 SINGLE BILL SUMMARY GENERATION TEST
================================================================================
📄 Bill: HR 4398
🧠 Model: GPT-5-nano / Claude Sonnet 4.5
🏛️  Congress: 119
================================================================================

1️⃣  Checking database...
   ✅ Found in database / ⚠️ Not found (will fetch)
   [Bill details if found]

2️⃣  Fetching bill details from Congress.gov...
   ✅ Fetched bill details
   [Title, dates, status]

3️⃣  Fetching bill text...
   ✅ Fetched full text
   [Length, URL]

4️⃣  Updating database...
   ✅ Updated / Created bill in database

5️⃣  Generating summaries with [Model Name]...
================================================================================

⚡ Generating Brief summary...
✅ Brief summary generated (XXXms)
   Model: gpt-5-nano / claude-sonnet-4-5-20250929
   Confidence: XX.X%
   Length: XXX chars

   Content:
   [Summary text]

   Key Points:
   [Bullet points]

   Impact Areas: [Areas]

[Repeat for STANDARD and ELI5]

================================================================================
✅ GENERATION COMPLETE
================================================================================
[Summary statistics and tips]
```

## Use Cases

### 1. Model Quality Comparison

```bash
# Same bill, both models
npm run gen-sum openai HR 4398
npm run gen-sum anthropic HR 4398
```

**Compare:** Summary quality, key points accuracy, language style

### 2. Resolution Type Testing

```bash
# Different bill types
npm run gen-sum openai HR 4398    # Regular bill
npm run gen-sum openai HRES 723   # Resolution
```

**Compare:** How models handle different legislative types

### 3. Companion Bill Analysis

```bash
# House and Senate versions
npm run gen-sum openai HR 4398
npm run gen-sum anthropic S 2309
```

**Compare:** How models summarize identical legislation in different chambers

### 4. Quick Single Bill Processing

```bash
# Just need one bill summarized
npm run gen-sum anthropic HR 5000
```

**Result:** Bill fetched, stored, and summarized in one command

## Tips

1. **Check Existing Summaries:**

   - Script shows count of existing summaries
   - View in Prisma Studio: `npm run db:studio`

2. **Model Selection:**

   - OpenAI: Faster, cheaper (~$0.001/summary)
   - Anthropic: Higher quality, same price as 3.5 (~$0.015/summary)

3. **Error Handling:**

   - Bill not found → Check bill type and number
   - No text available → Bill too recent or not published
   - API errors → Check API keys in `.env`

4. **Database Integration:**
   - Bill automatically created/updated
   - Summaries stored with metadata
   - Companion bills detected (if in DB)

## Comparison with Other Scripts

| Script             | Purpose             | Scope     | Model                        |
| ------------------ | ------------------- | --------- | ---------------------------- |
| `gen-sum`          | Single bill testing | 1 bill    | Choose: OpenAI or Anthropic  |
| `summarize-bills`  | Batch processing    | 30+ bills | Both (generates 6 summaries) |
| `test-single-bill` | API exploration     | 1 bill    | No AI (just data fetch)      |

## Examples

### Example 1: Quick Test

```bash
npm run gen-sum openai HR 4398
```

**Result:** Bill fetched, stored, 3 summaries generated in ~3 seconds

### Example 2: Model Comparison

```bash
npm run gen-sum openai HR 4398
npm run gen-sum anthropic HR 4398
```

**Result:** Same bill with 6 total summaries (3 per model) for comparison

### Example 3: Companion Bill Analysis

```bash
npm run gen-sum openai HR 4398   # House version
npm run gen-sum anthropic S 2309 # Senate version
```

**Result:** Both bills stored, summaries show how models handle each chamber

### Example 4: Resolution Testing

```bash
npm run gen-sum openai HRES 723  # House Resolution
npm run gen-sum anthropic SRES 381  # Senate Resolution
```

**Result:** Test how models summarize resolutions vs regular bills

## Database Schema

Summaries are stored with:

```typescript
{
  id: string
  billId: string
  summaryType: "BRIEF" | "STANDARD" | "ELI5"
  content: string          // Main summary text
  keyPoints: string[]      // Bullet points
  impactAreas: string[]    // Who this affects
  aiModel: string          // "gpt-5-nano" or "claude-sonnet-4-5-20250929"
  confidence: number       // 0-1 score
  generatedAt: DateTime
}
```

## Troubleshooting

**Bill not found:**

```
❌ Bill not found on Congress.gov
```

→ Check bill type and number are correct

**No text available:**

```
❌ No full text available for this bill
💡 Bill may be too recent or text not yet published
```

→ Bill text not published yet, try older bill

**Invalid arguments:**

```
❌ Invalid arguments!
```

→ Check syntax: `npm run gen-sum <model> <billType> <billNumber>`

**API key errors:**

```
❌ Error: Invalid API key
```

→ Check `.env` file has `CONGRESS_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`

## Performance

**OpenAI GPT-5-nano:**

- BRIEF: ~800ms
- STANDARD: ~1200ms
- ELI5: ~900ms
- **Total: ~3 seconds**

**Anthropic Claude Sonnet 4.5:**

- BRIEF: ~1200ms
- STANDARD: ~1800ms
- ELI5: ~1400ms
- **Total: ~4.5 seconds**

## Next Steps After Generation

1. **View in Database:**

   ```bash
   npm run db:studio
   ```

2. **Compare Summaries:**

   - Navigate to Bill → Summaries
   - Compare different models side-by-side

3. **Run UI:**

   ```bash
   npm run dev
   ```

   - View bill at `http://localhost:3000/bills/{id}`
   - See all summaries in tabs

4. **Generate More:**
   - Test different bills
   - Compare models
   - Test companion bills
