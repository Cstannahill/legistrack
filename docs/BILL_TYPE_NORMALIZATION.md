# Bill Type Normalization Fix

## Problem

The database was creating duplicate bill entries because `billType` was stored inconsistently:

- Some bills had uppercase: `"HR"`, `"S"`, `"HRES"`
- Scripts were querying with lowercase: `"hr"`, `"s"`, `"hres"`
- The unique constraint `@@unique([congress, billType, billNumber])` failed to match

**Result:** Running `gen-sum` created NEW bills instead of updating existing ones.

## Root Cause

1. **Congress.gov API** returns lowercase bill types: `"hr"`, `"s"`, etc.
2. **Initial fetch scripts** stored these as-is from the API
3. **Some older data** may have been stored with uppercase manually or from different sources
4. **Case-sensitive database** (PostgreSQL) treats `"hr"` ≠ `"HR"`

## Solutions Implemented

### 1. ✅ Forward Compatibility (Prevents Future Issues)

**Updated all fetch scripts to normalize to lowercase:**

- `scripts/fetch-bills-paginated.ts`
- `scripts/fetch-bills.ts`
- `scripts/fetch-bills-recent.ts`
- `scripts/test-generate-summary.ts`

**Changes:**

```typescript
// OLD
billType: billData.type; // Could be any case

// NEW
billType: billData.type.toLowerCase(); // Always lowercase
```

### 2. ✅ Backward Compatibility (Works with Existing Data)

**Updated `test-generate-summary.ts` to check BOTH cases:**

```typescript
// Try lowercase first (new standard)
let bill = await db.bill.findFirst({
  where: {
    billType: billType.toLowerCase(),
    // ...
  },
});

// Fallback to uppercase if not found (old data)
if (!bill) {
  bill = await db.bill.findFirst({
    where: {
      billType: billType.toUpperCase(),
      // ...
    },
  });
}
```

**Result:** Script now finds bills regardless of how they're stored!

### 3. 🔧 Optional: One-Time Data Migration

**Script: `scripts/normalize-bill-types.ts`**

Run once to fix all existing bills in the database:

```bash
npm run db:normalize-types
```

**What it does:**

1. Finds all bills in the database
2. Converts `billType` to lowercase for any that aren't already
3. Updates the database records
4. Reports how many were changed

**Example output:**

```
🔄 Normalizing billType to lowercase for all existing bills...

📊 Found 1000 bills to check

✏️  Updating: HR 5401 → hr
✏️  Updating: S 2802 → s
✏️  Updating: HRES 727 → hres
...

============================================================
✅ Migration Complete!
============================================================
📝 Updated: 847 bills
⏭️  Skipped: 153 bills (already lowercase)
📊 Total: 1000 bills
============================================================
```

## Testing

### Before Fix:

```bash
npm run gen-sum anthropic hr 5401
# ❌ Creates NEW bill (duplicate)

npm run gen-sum anthropic hr 5401  # Run again
# ✅ Now finds and updates existing bill
```

### After Fix (Option 1 - Backward Compatible):

```bash
npm run gen-sum anthropic hr 5401
# ✅ Finds and updates existing bill (even if stored as "HR")

npm run gen-sum anthropic hr 5401  # Run again
# ✅ Still finds and updates same bill
```

### After Fix (Option 2 - After Migration):

```bash
npm run db:normalize-types  # Run once

npm run gen-sum anthropic hr 5401
# ✅ Finds and updates existing bill (now stored as "hr")

npm run gen-sum anthropic hr 5401  # Run again
# ✅ Still finds and updates same bill
```

## Recommendation

**Use BOTH solutions:**

1. **Immediate:** The backward compatibility fix in `test-generate-summary.ts` works NOW
2. **Long-term:** Run `npm run db:normalize-types` to clean up your data

This ensures:

- ✅ Script works immediately with existing data
- ✅ Future data is stored consistently (lowercase)
- ✅ Database queries are faster (only one lookup needed)
- ✅ No duplicates created

## Database Schema

The schema already has the correct unique constraint:

```prisma
model Bill {
  // ...
  billType          String   // Should be lowercase
  billNumber        Int
  congress          Int

  @@unique([congress, billType, billNumber])
}
```

This constraint works correctly when `billType` is consistently lowercase.

## Files Changed

### Scripts Updated:

1. ✅ `scripts/test-generate-summary.ts` - Backward compatible lookup
2. ✅ `scripts/fetch-bills-paginated.ts` - Normalize to lowercase on create
3. ✅ `scripts/fetch-bills.ts` - Normalize to lowercase on create
4. ✅ `scripts/fetch-bills-recent.ts` - Normalize to lowercase on create

### New Files:

1. ✅ `scripts/normalize-bill-types.ts` - One-time migration script
2. ✅ `docs/BILL_TYPE_NORMALIZATION.md` - This documentation

### Configuration:

1. ✅ `package.json` - Added `db:normalize-types` script

## Future Considerations

**If you ever need to add more fetch scripts:**

Always normalize `billType` to lowercase:

```typescript
const billData = {
  billType: rawBillType.toLowerCase(), // ✅ Always normalize
  billNumber: parseInt(rawBillNumber),
  // ...
};
```

**When querying bills:**

Use lowercase for consistency:

```typescript
const bill = await db.bill.findFirst({
  where: {
    billType: userInput.toLowerCase(), // ✅ Normalize input
    // ...
  },
});
```
