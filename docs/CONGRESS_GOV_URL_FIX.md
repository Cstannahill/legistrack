# Congress.gov URL Fix

**Date:** October 2, 2025  
**Status:** ✅ Completed  
**Impact:** Fixed "View on Congress.gov" links to use proper human-readable URLs

## Problem Statement

The "View on Congress.gov" links were pointing to the API endpoint instead of the human-readable website:

**Before:**

```
❌ https://api.congress.gov/v3/bill/119/sres/427?format=json
```

**After:**

```
✅ https://www.congress.gov/bill/119th-congress/senate-resolution/427
```

## Root Cause

The `bill.sourceUrl` field stored in the database contains the Congress.gov API URL, not the website URL. While this is useful for API calls, it's not appropriate for user-facing links.

## Solution

Created a utility function to dynamically generate proper Congress.gov URLs based on bill metadata.

### Implementation

#### 1. Congress.gov URL Utility (`src/lib/utils/congress-url.ts`)

**Core Function:**

```typescript
function getCongressGovBillUrl(
  congress: number,
  billType: string,
  billNumber: number
): string;
```

**Bill Type Mappings:**
| Database Value | Congress.gov URL Format |
|---------------|------------------------|
| `hr` | `house-bill` |
| `hres` | `house-resolution` |
| `hjres` | `house-joint-resolution` |
| `hconres` | `house-concurrent-resolution` |
| `s` | `senate-bill` |
| `sres` | `senate-resolution` |
| `sjres` | `senate-joint-resolution` |
| `sconres` | `senate-concurrent-resolution` |

**URL Format:**

```
https://www.congress.gov/bill/{congress}th-congress/{bill-type}/{number}
```

**Examples:**

```typescript
getCongressGovBillUrl(119, "SRES", 427);
// → https://www.congress.gov/bill/119th-congress/senate-resolution/427

getCongressGovBillUrl(119, "HR", 5370);
// → https://www.congress.gov/bill/119th-congress/house-bill/5370

getCongressGovBillUrl(119, "S", 1234);
// → https://www.congress.gov/bill/119th-congress/senate-bill/1234
```

**Helper Function:**

```typescript
function getBillCongressUrl(bill: {
  congress: number;
  billType: string;
  billNumber: number;
}): string;
```

This convenience function accepts a bill object and extracts the necessary fields.

#### 2. Updated Bill Detail Page (`src/app/bills/[id]/page.tsx`)

**Changes Made:**

1. **Import utility:**

```typescript
import { getBillCongressUrl } from "@/lib/utils/congress-url";
```

2. **Generate URL in BillContent:**

```typescript
function BillContent({ bill }: { bill: any }) {
  const billIdentifier = `${bill.billType.toUpperCase()} ${bill.billNumber}`;
  const congressGovUrl = getBillCongressUrl(bill); // ← New
  // ...
}
```

3. **Use generated URL in Details tab:**

```typescript
// Before: Conditional render based on bill.sourceUrl
{bill.sourceUrl && (
    <div>
        <a href={bill.sourceUrl} ...>
            View on Congress.gov
        </a>
    </div>
)}

// After: Always render with generated URL
<div>
    <a href={congressGovUrl} ...>
        View on Congress.gov
    </a>
</div>
```

4. **Use generated URL in header section:**

```typescript
// Before: Conditional render based on bill.sourceUrl
{bill.sourceUrl && (
    <div className="mt-4">
        <a href={bill.sourceUrl} ...>
            View on Congress.gov
        </a>
    </div>
)}

// After: Always render with generated URL
<div className="mt-4">
    <a href={getBillCongressUrl(bill)} ...>
        View on Congress.gov
    </a>
</div>
```

## Benefits

1. **Correct URLs**

   - Links now point to actual Congress.gov pages
   - Users can read bills directly on the official site
   - No API endpoint errors in browser

2. **Always Available**

   - No longer dependent on `sourceUrl` field
   - Generated dynamically from bill metadata
   - Works for all bills, even if `sourceUrl` is null

3. **Maintainable**

   - Single source of truth for URL generation
   - Easy to update if Congress.gov changes URL format
   - Type-safe with TypeScript

4. **Predictable**
   - Consistent URL format across all bills
   - No variations or inconsistencies
   - Easy to debug and test

## Technical Details

### URL Structure

Congress.gov uses a consistent URL pattern:

```
https://www.congress.gov/bill/{congress}th-congress/{bill-type}/{bill-number}
```

**Components:**

- `{congress}th-congress` - e.g., "119th-congress"
- `{bill-type}` - Hyphenated format (e.g., "senate-resolution")
- `{bill-number}` - Numeric value (e.g., 427)

### Bill Type Normalization

The function handles various input formats:

```typescript
// Case-insensitive
getCongressGovBillUrl(119, "SRES", 427); // ✅ Works
getCongressGovBillUrl(119, "sres", 427); // ✅ Works
getCongressGovBillUrl(119, "SRes", 427); // ✅ Works
```

### Error Handling

If an unknown bill type is encountered:

```typescript
// Unknown type warning logged
getCongressGovBillUrl(119, "UNKNOWN", 123);
// → console.warn("Unknown bill type: UNKNOWN")
// → Fallback URL: https://www.congress.gov/bill/119th-congress/unknown/123
```

This ensures the link is still generated, even if the bill type mapping is missing.

## Testing

### Manual Testing

- [x] Senate Resolution (SRES 427) → `/119th-congress/senate-resolution/427`
- [x] House Bill (HR 5370) → `/119th-congress/house-bill/5370`
- [x] Senate Bill (S 1234) → `/119th-congress/senate-bill/1234`
- [x] House Resolution (HRES) → `/119th-congress/house-resolution/{n}`
- [x] Joint Resolutions (HJRES, SJRES)
- [x] Concurrent Resolutions (HCONRES, SCONRES)

### Link Verification

- [x] Header "View on Congress.gov" link works
- [x] Details tab "View on Congress.gov" link works
- [x] Links open in new tab (`target="_blank"`)
- [x] Links have proper `rel="noopener noreferrer"`

### Edge Cases

- [x] Bill with null `sourceUrl` (still generates link)
- [x] Various bill types (all 8 types)
- [x] Case variations in billType field
- [x] Different congress numbers

## Migration Notes

### Database Impact

- ✅ **No database changes required**
- ✅ **Backward compatible** - `sourceUrl` field still exists but not used for display
- ✅ **API unchanged** - Still useful for programmatic API calls

### Future Considerations

1. **Update sourceUrl on import**

   - Could update import scripts to store proper Congress.gov URLs
   - Or remove field entirely since we generate dynamically

2. **Add URL field to API response**

   - Expose `congressGovUrl` in API endpoints
   - Clients don't need to generate URLs themselves

3. **Executive Orders**
   - Similar fix may be needed for Executive Order links
   - Federal Register URLs may have similar issues

## Related Files

```
src/
├── lib/
│   └── utils/
│       └── congress-url.ts          # New utility (42 lines)
└── app/
    └── bills/
        └── [id]/
            └── page.tsx              # Updated (2 locations)
```

## Rollback Plan

If issues arise, revert to using `bill.sourceUrl`:

```typescript
// Remove import
// import { getBillCongressUrl } from '@/lib/utils/congress-url'

// Revert to conditional render
{bill.sourceUrl && (
    <a href={bill.sourceUrl} ...>
        View on Congress.gov
    </a>
)}
```

The utility file can be deleted without impacting anything else.

## Related Documentation

- [Congress.gov URL Structure](https://www.congress.gov/help/legislative-data) - Official documentation
- Congress.gov API vs Website - Understanding the difference

## Conclusion

This fix ensures users clicking "View on Congress.gov" are taken to the actual bill page on Congress.gov, not the API endpoint. By generating URLs dynamically from bill metadata, we have a robust, maintainable solution that works for all bills regardless of what's stored in `sourceUrl`.

**Key Takeaway:** Always verify that user-facing links point to human-readable pages, not API endpoints. When in doubt, generate URLs dynamically from structured data rather than relying on pre-stored URLs that may be incorrect or outdated.
