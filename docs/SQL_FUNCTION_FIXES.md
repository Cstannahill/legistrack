# SQL Function Fixes

## Issues Fixed

### 1. CompanionBill relationshipType Column Error ✅

**Error:** `column cb.relationshiptype does not exist`

**Location:** `prisma/functions/get_bill_by_id.plpgsql` line 11

**Problem:** PostgreSQL requires camelCase column names to be quoted, but the SQL was using `cb.relationshipType` instead of `cb."relationshipType"`

**Fix:** Updated the CTE to properly quote the column name:

```sql
companion_rel AS (
    SELECT cb."companionBillId" AS companion_id, cb."relationshipType"
    FROM public."CompanionBill" cb
    JOIN target t ON cb."sourceBillId" = t.id
)
```

---

### 2. get_bills Function Ambiguity ✅

**Error:** `function get_bills(integer, integer) is not unique`

**Location:** `src/app/bills/page.tsx` line 381

**Problem:** PostgreSQL has multiple function signatures for `get_bills` (one with 2 parameters, one with 8 parameters). When calling with only 2 parameters, the database couldn't determine which function to use.

**Fix:** Updated the TypeScript code to explicitly pass all 8 parameters:

```typescript
const billRows = await db.$queryRaw<BillRow[]>`
    SELECT * FROM get_bills(
        ${skip}::int,
        ${limit}::int,
        NULL::public."BillStatus",
        NULL::text,
        NULL::int,
        NULL::text,
        ${"introducedDate"}::text,
        ${"desc"}::text
    )`;
```

---

### 3. Executive Orders Status Filter Issue ✅

**Error:** Selecting any status filter was showing ALL executive orders instead of filtering them out

**Location:** `src/app/bills/page.tsx` line 268

**Problem:** When `legislationType === 'ALL'` and a status filter was selected, the code was using the unified `get_bills_and_orders` function which returns both bills AND executive orders. Since executive orders don't have a status field, they were all being shown regardless of the status filter.

**Fix:** Updated the condition to skip the unified function when a status filter is active:

```typescript
// Always use unified function for ALL view (parameterized) regardless of filters; incomplete toggle still forces bill filter logic client-side
// BUT: don't use unified if status is selected (EOs don't have status, so only bills should show)
const useUnified = legislationType === "ALL" && !params.status;
```

This ensures that when a status filter is applied:

- Only bills are fetched (not executive orders)
- The status filter correctly applies to bills
- Executive orders are completely excluded from results

---

## How to Apply These Fixes

### Step 1: Apply the SQL Function Update

The SQL function fix needs to be applied to your database:

```bash
npm run db:apply-functions
```

This will:

- Read all `.plpgsql` files from `prisma/functions/`
- Execute them to create/replace the functions in your database
- Show a summary of successful and failed applications

### Step 2: Restart Your Development Server

The TypeScript changes are already in place, but you need to restart your server:

```bash
npm run dev
```

### Step 3: Test the Fixes

1. **Test Bill Detail Page:**

   - Navigate to any bill detail page (e.g., `/bills/[id]`)
   - Verify it loads without the "relationshiptype does not exist" error
   - Check that companion bills are displayed correctly

2. **Test Bill List Page:**

   - Navigate to `/bills`
   - Verify the page loads without the "function get_bills is not unique" error
   - Check that bills are displayed correctly

3. **Test Status Filtering:**

   - On the bills page, select "ALL" legislation type
   - Click on any status filter (e.g., "Passed House")
   - Verify that ONLY bills are shown (no executive orders)
   - Verify that the bills shown match the selected status

4. **Test Executive Orders:**
   - Select "Executive Orders" legislation type
   - Verify that only executive orders are shown
   - Verify that status filters are hidden (as they don't apply to EOs)

---

## Files Changed

### SQL Functions

- ✅ `prisma/functions/get_bill_by_id.plpgsql` - Fixed relationshipType column reference

### TypeScript Code

- ✅ `src/app/bills/page.tsx` - Fixed get_bills function call ambiguity
- ✅ `src/app/bills/page.tsx` - Fixed executive orders status filter logic

### New Files

- ✅ `scripts/apply-sql-functions.ts` - Script to apply SQL functions to database
- ✅ `package.json` - Added `db:apply-functions` script

---

## Technical Details

### Why PostgreSQL Requires Quoted Identifiers

PostgreSQL treats unquoted identifiers as lowercase. When Prisma generates tables with camelCase column names, it quotes them. Therefore, when writing raw SQL, you must also quote them:

```sql
-- ❌ Wrong (PostgreSQL looks for lowercase "relationshiptype")
cb.relationshipType

-- ✅ Correct (PostgreSQL looks for exact case "relationshipType")
cb."relationshipType"
```

### Why Function Overloading Can Be Ambiguous

PostgreSQL allows function overloading (multiple functions with the same name but different parameters). However, when the overloads differ only in the number of parameters with defaults, and you call with fewer parameters, PostgreSQL can't determine which function you mean.

**Solution:** Always provide all parameters explicitly, using NULL for optional ones.

### Why Status Filters Don't Apply to Executive Orders

The database schema shows:

- Bills have a `currentStatus` field of type `BillStatus` enum
- Executive Orders have NO status field

Therefore, when filtering by status:

- Only bills should be fetched
- Executive orders should be excluded entirely
- The unified query function should NOT be used

---

## Prevention

To prevent similar issues in the future:

1. **Always quote camelCase identifiers in SQL:**

   ```sql
   cb."relationshipType"  -- ✅ Good
   cb.relationshipType    -- ❌ Bad
   ```

2. **Call overloaded functions with all parameters:**

   ```sql
   get_bills(${skip}::int, ${limit}::int, NULL::text, ...)  -- ✅ Good
   get_bills(${skip}::int, ${limit}::int)                   -- ❌ Ambiguous
   ```

3. **Check filter compatibility before using unified queries:**
   ```typescript
   // Don't use unified query if filters don't apply to all types
   const useUnified = legislationType === "ALL" && !params.status;
   ```

---

## Testing Checklist

- [ ] Bill detail pages load without errors
- [ ] Bill list page loads without errors
- [ ] Status filtering excludes executive orders
- [ ] Status filtering correctly filters bills
- [ ] Executive orders page works correctly
- [ ] Companion bills are displayed correctly
- [ ] No console errors in browser or server logs

---

## Related Documentation

- [Architecture](../architecture.md) - System design overview
- [Companion Bills Implementation](./COMPANION_BILL_IMPLEMENTATION.md) - Companion bill feature
- [Executive Orders Implementation](./EXECUTIVE_ORDERS_IMPLEMENTATION.md) - Executive orders feature
