# Executive Orders Status Filter Fix - October 2, 2025

## Problem

When selecting a bill status filter in the sidebar (e.g., "Introduced", "Passed House", etc.), Executive Orders were still showing in the results. This is incorrect because:

1. Executive Orders don't have a `currentStatus` field (they're not bills)
2. Bill status filters should only apply to bills, not EOs
3. The UI was confusing users by showing EOs for every status

## Root Cause

In `src/app/bills/page.tsx`, the logic for determining whether to fetch Executive Orders didn't account for the status filter:

```typescript
// OLD (INCORRECT):
const shouldFetchEOs =
  legislationType === "ALL" || legislationType === "EXECUTIVE_ORDERS";
```

This meant that when:

- `legislationType` was `'ALL'` (default)
- A `status` filter was selected (e.g., `status=INTRODUCED`)

Both bills AND executive orders would be fetched, even though the status filter only applies to bills.

## Solution

Updated line 32 in `src/app/bills/page.tsx` to exclude Executive Orders when any status filter is active:

```typescript
// NEW (CORRECT):
const shouldFetchEOs =
  (legislationType === "ALL" || legislationType === "EXECUTIVE_ORDERS") &&
  !params.status;
```

This ensures that:

- ✅ When viewing "All Legislation" with NO status filter → Shows both bills and EOs
- ✅ When viewing "All Legislation" with a status filter → Shows only bills (filtered by status)
- ✅ When viewing "Bills Only" → Shows only bills (with or without status filter)
- ✅ When viewing "Executive Orders Only" → Shows only EOs (status filter hidden in UI)

## Testing Scenarios

### Before Fix:

1. Navigate to `/bills` (All Legislation)
2. Select "Introduced" status
3. ❌ **BUG**: Would show ALL executive orders plus introduced bills

### After Fix:

1. Navigate to `/bills` (All Legislation)
2. Select "Introduced" status
3. ✅ **CORRECT**: Shows only bills with "Introduced" status (no EOs)

### Additional Test Cases:

- ✅ `/bills?type=ALL` → Shows both bills and EOs (mixed list, sorted by date)
- ✅ `/bills?type=ALL&status=INTRODUCED` → Shows only introduced bills (no EOs)
- ✅ `/bills?type=BILLS` → Shows only bills
- ✅ `/bills?type=BILLS&status=PASSED_HOUSE` → Shows only bills passed by House
- ✅ `/bills?type=EXECUTIVE_ORDERS` → Shows only EOs (status filter hidden)
- ✅ `/bills?type=EXECUTIVE_ORDERS&category=healthcare` → Shows only EOs in healthcare category

## UI Behavior

The FilterPanel component (`src/components/search/FilterPanel.tsx`) already has proper UI logic:

- Line 96: Status filter section is hidden when `currentType === 'EXECUTIVE_ORDERS'`
- This prevents users from selecting a status when viewing EOs only

Now the backend data fetching matches this UI expectation.

## Impact

- ✅ Status filters now work correctly
- ✅ Users get expected results when filtering by status
- ✅ No performance impact (actually better - fewer unnecessary EO queries)
- ✅ Cleaner separation between bills and executive orders
- ✅ UI and backend logic are now aligned

## Related Files

- ✅ `src/app/bills/page.tsx` - **FIXED** (line 32)
- ℹ️ `src/components/search/FilterPanel.tsx` - Already correct (hides status filter for EOs)
- ℹ️ `src/lib/constants.ts` - Contains BILL_STATUS_LABELS and LEGISLATION_TYPE_LABELS
