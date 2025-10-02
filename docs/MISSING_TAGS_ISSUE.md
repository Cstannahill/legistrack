# Missing Tags on Production - Root Cause & Solutions

**Date:** October 2, 2025  
**Status:** ⚠️ Issue Identified  
**Impact:** No bills showing tags/categories on live site

---

## 🔍 Root Cause

The many-to-many join table (`_BillCategories`) relationships were **NOT migrated** during the data migration from local to Supabase.

### What Was Migrated ✅

- Bills (1,000 records)
- Executive Orders
- Categories (15 records)
- Summaries
- Companion Bills

### What Was NOT Migrated ❌

- Bill ↔ Category relationships (join table)
- Executive Order ↔ Category relationships (join table)

---

## 📊 Current Production State

```
Total Bills: 1,000
Total Categories: 15
Bills with Categories: 0 ❌
```

### Verified Categories in Production

1. Healthcare
2. Education
3. Environment & Climate
4. Economy & Taxes
5. Defense & National Security
6. Immigration
7. Technology & Innovation
8. Civil Rights & Justice
9. Infrastructure
10. Social Services
11. Labor & Employment
12. Agriculture & Food
13. Housing & Urban Development
14. Financial Services
15. Veterans Affairs

---

## ✅ Solution Options

### Option 1: Run AI Tagging Script (RECOMMENDED)

**Pros:**

- Works independently of local database
- Can improve categorization with fresh AI analysis
- Batch processing with rate limiting
- Handles both bills and executive orders

**Cons:**

- Costs OpenAI API credits
- Takes time (processes in batches of 10 by default)
- Requires OpenAI API key in production

**How to Run:**

```bash
# Set environment variables if needed
export BATCH_SIZE=10
export LEGISLATION_TYPE=all  # or "bills" or "executive-orders"

# Run the tagging script
npm run tag-legislation

# Or with tsx directly
npx tsx scripts/tag-legislation.ts
```

**Expected Output:**

- Tags 10 bills per batch
- 500ms delay between requests
- Shows categories assigned to each bill
- Summary of success/failures

---

### Option 2: Migrate Join Table from Local Database

**Pros:**

- Preserves existing categorizations
- No API costs
- One-time operation
- Faster than re-tagging

**Cons:**

- Requires access to local database
- Assumes local database has tagged bills
- Categories must match by slug

**How to Run:**

```bash
# Make sure you have local database access
# Update the connection string in the script if needed

npx tsx scripts/migrate-bill-categories.ts
```

**What It Does:**

1. Fetches all bills with categories from local DB
2. Maps categories by slug to Supabase category IDs
3. Creates the relationships in Supabase
4. Handles both bills and executive orders
5. Skips bills that already have categories

---

## 🔧 Prevention for Future Migrations

Update `scripts/migrate-data-to-supabase.ts` to include join table migration:

```typescript
// 6. Migrate Bill-Category relationships
console.log("🏷️  Migrating Bill-Category relationships...");
const billsWithCategories = await localDb.bill.findMany({
  where: { categories: { some: {} } },
  include: { categories: true },
});

for (const bill of billsWithCategories) {
  await supabaseDb.bill.update({
    where: { id: bill.id },
    data: {
      categories: {
        connect: bill.categories.map((cat) => ({ id: cat.id })),
      },
    },
  });
}
```

---

## 📝 Action Items

### Immediate

- [ ] Decide on Option 1 (AI tagging) or Option 2 (migrate relationships)
- [ ] Ensure required environment variables are set
- [ ] Run the chosen script
- [ ] Verify tags appear on production site

### Post-Migration

- [ ] Test filtering by category on `/bills` page
- [ ] Verify category badges show on bill cards
- [ ] Check executive orders have categories too
- [ ] Document the process

### Future

- [ ] Update main migration script to include join tables
- [ ] Add category relationship verification to CI/CD
- [ ] Consider adding a health check endpoint for data integrity

---

## 🧪 Verification Steps

After running either solution:

```bash
# Check if bills now have categories
npx tsx -e "import { PrismaClient } from '@prisma/client'; \
const db = new PrismaClient(); \
(async () => { \
  const count = await db.bill.count({ where: { categories: { some: {} } } }); \
  console.log('Bills with categories:', count); \
  const sample = await db.bill.findFirst({ \
    where: { categories: { some: {} } }, \
    include: { categories: true } \
  }); \
  console.log('Sample:', JSON.stringify(sample, null, 2)); \
  await db.\$disconnect(); \
})()"
```

Expected result: Should show > 0 bills with categories

---

## 📚 Related Files

- `scripts/migrate-data-to-supabase.ts` - Original migration (missing join tables)
- `scripts/migrate-bill-categories.ts` - NEW: Migrates join table relationships
- `scripts/tag-legislation.ts` - AI tagging script
- `prisma/schema.prisma` - Database schema with Category relations
- `src/components/bills/BillCard.tsx` - Displays category badges
- `src/app/api/bills/route.ts` - API includes categories in response

---

## 💡 Recommendation

**Use Option 1 (AI Tagging)** because:

1. Your production data may have more bills than your local database
2. Fresh AI analysis might improve categorization accuracy
3. It's self-contained and doesn't depend on local DB state
4. The script is already well-tested and production-ready

Run with conservative batch size to start:

```bash
BATCH_SIZE=5 npx tsx scripts/tag-legislation.ts
```

Then increase batch size once you confirm it's working correctly.
