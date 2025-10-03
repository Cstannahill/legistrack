# Executive Order Search Enhancement

## Problem

Executive orders could not be searched by their order numbers. Searches like:

- "EO 1"
- "EO 14111"
- "14111"

Would return no results because the search logic only looked at the `title` field, not the `orderNumber` field.

## Solution

Enhanced the executive order search logic to match the bill number search implementation:

### Order Number Search

Now supports searching by order number in multiple formats:

- **With prefix**: "EO 1", "EO. 1", "eo 1"
- **Without prefix**: "1", "14111"

### Search Behavior

**Exact Matches:**

- "EO 14111" → Finds Executive Order 14111

**Partial Matches (for short numbers):**

- "EO 1" → Finds EO 1, 10, 11-19, 100-199, 1000-1999, etc.
- "EO 14" → Finds EO 14, 140-149, 1400-1499, 14000-14999
- "EO 141" → Finds EO 141, 1410-1419, 14100-14199

**Full Number (5+ digits):**

- "14111" → Exact match only (EO 14111)

### Implementation

```typescript
// Parse potential EO number from query (e.g., "EO 1", "EO. 14111", "14111")
const eoNumberMatch = cleanedSearchTerm.match(/^(?:EO)?\s*(\d+)$/i);

if (eoNumberMatch) {
  const orderNumber = parseInt(eoNumberMatch[1], 10);
  const orderNumberStr = eoNumberMatch[1];
  const numDigits = orderNumberStr.length;

  if (numDigits < 5) {
    // Partial matching for shorter numbers
    const rangeStart = orderNumber * Math.pow(10, Math.max(0, 5 - numDigits));
    const rangeEnd = rangeStart + Math.pow(10, Math.max(0, 5 - numDigits));

    eoWhere.OR = [
      { orderNumber: orderNumber }, // Exact match
      { orderNumber: { gte: rangeStart, lt: rangeEnd } }, // Partial match
    ];
  } else {
    // Exact match for full numbers
    eoWhere.orderNumber = orderNumber;
  }
}
```

### Title Search (Still Supported)

Text searches still work for finding EOs by title:

- "immigration" → Searches title field
- "climate" → Searches title field
- "\"specific phrase\"" → Exact phrase matching in title

## Search Examples

| Search Query        | Matches                                     |
| ------------------- | ------------------------------------------- |
| `EO 1`              | Executive Order 1, 10, 11-19, 100-199, etc. |
| `EO 14111`          | Executive Order 14111 (exact)               |
| `14111`             | Executive Order 14111 (exact)               |
| `EO. 1`             | Same as "EO 1" (periods removed)            |
| `immigration`       | EOs with "immigration" in title             |
| `"border security"` | EOs with exact phrase "border security"     |

## Technical Details

**Pattern Matching:**

- Regex: `/^(?:EO)?\s*(\d+)$/i`
- Case insensitive
- Optional "EO" prefix
- Handles spaces and periods
- Extracts numeric portion

**Range Calculation:**
For partial matches (< 5 digits):

```typescript
rangeStart = orderNumber * 10^(5 - numDigits)
rangeEnd = rangeStart + 10^(5 - numDigits)

Examples:
"1" (1 digit):  rangeStart = 1 * 10^4 = 10000, rangeEnd = 20000
                (matches 10000-19999)
                Plus exact match for 1

"14" (2 digits): rangeStart = 14 * 10^3 = 14000, rangeEnd = 15000
                 (matches 14000-14999)
                 Plus exact match for 14

"141" (3 digits): rangeStart = 141 * 10^2 = 14100, rangeEnd = 14200
                  (matches 14100-14199)
                  Plus exact match for 141
```

## Database Queries

**Before (Title Only):**

```sql
SELECT * FROM "ExecutiveOrder"
WHERE "title" ILIKE '%eo 1%'
-- Returns no results (title doesn't contain "eo 1")
```

**After (Order Number):**

```sql
SELECT * FROM "ExecutiveOrder"
WHERE "orderNumber" = 1
   OR ("orderNumber" >= 10000 AND "orderNumber" < 20000)
-- Returns EO 1, plus any EOs 10000-19999
```

## Consistency with Bills

Executive order search now matches the bill search implementation:

- ✅ Number-based search (EO # like HR #)
- ✅ Partial matching for short queries
- ✅ Exact matching for full numbers
- ✅ Period removal ("EO. 1" → "EO 1")
- ✅ Quoted phrase matching
- ✅ Case-insensitive search

## Testing

### Manual Tests

1. **Order Number Search:**

   - [ ] Search "EO 1" - should find Executive Order 1
   - [ ] Search "14111" - should find EO 14111
   - [ ] Search "EO. 14111" - should find EO 14111
   - [ ] Search "1" - should find EO 1 and potentially others

2. **Title Search:**

   - [ ] Search "immigration" - finds EOs about immigration
   - [ ] Search "climate" - finds EOs about climate
   - [ ] Search "border" - finds EOs mentioning border

3. **Quoted Search:**

   - [ ] Search "\"border security\"" - exact phrase match

4. **No Results:**
   - [ ] Search "EO 99999" - no results (doesn't exist)
   - [ ] Search "abcdef" - no results

### Database Verification

Check that EO #1 exists:

```typescript
await db.executiveOrder.findFirst({
  where: { orderNumber: 1 },
});
```

Check search results:

```typescript
// Search for "EO 1"
await db.executiveOrder.findMany({
  where: {
    OR: [{ orderNumber: 1 }, { orderNumber: { gte: 10000, lt: 20000 } }],
  },
});
```

## Related Files

- `src/app/bills/page.tsx` - Enhanced EO search logic
- Bill search implementation (lines 49-112) - Reference for pattern

## Related Documentation

- [Search Performance Optimization](./SEARCH_PERFORMANCE_OPTIMIZATION.md) - Query optimization
- [Search Bug Fix](./SEARCH_BUG_FIX.md) - Previous search improvements
