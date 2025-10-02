# Single Bill Analysis Findings

## Veteran Burial Timeliness and Death Certificate Accountability Act

**Date**: October 1, 2025  
**Test Script**: `scripts/test-single-bill.ts`

---

## 🎯 Purpose

Test ALL available Congress.gov API endpoints with a single known bill to ensure we're:

1. Fetching all available data
2. Storing it correctly in our database
3. Handling companion bills / duplicates properly
4. Using the right dates (introducedDate vs updateDate)

---

## 📊 Test Bills

| Bill        | Congress | Chamber | Introduced | Status                | Full Text Size |
| ----------- | -------- | ------- | ---------- | --------------------- | -------------- |
| **HR 4398** | 119th    | House   | 2025-07-15 | Referred to Committee | 4,290 chars    |
| **S 2309**  | 119th    | Senate  | 2025-07-16 | Referred to Committee | 4,251 chars    |

---

## ✅ What's Working

### 1. Full Text Fetching

- ✅ Both bills have full text available from Congress.gov API
- ✅ Text extraction from HTML `<pre>` tags working correctly
- ✅ Fetched successfully: 4,290 chars (HR 4398) and 4,251 chars (S 2309)

### 2. Companion Bill Detection

- ✅ Congress.gov `relatedBills` API returns companion bills
- ✅ HR 4398 → S 2309 relationship detected
- ✅ S 2309 → HR 4398 relationship detected
- Relationship type: "Related bill"

### 3. Rich Metadata Available

- ✅ Actions (3 for HR 4398, 2 for S 2309)
- ✅ Committees (1 each - Veterans' Affairs)
- ✅ Cosponsors (20 for HR 4398, 4 for S 2309)
- ✅ Sponsor info (bioguideId, party, state)
- ✅ Policy area ("Armed Forces and National Security")
- ✅ Constitutional authority statement (House bill)
- ✅ Multiple title versions (Display, Short, Official)

---

## ❌ Critical Issues Found

### 1. **ZERO Bills Have Text in Database**

- Database check shows: `Full Text: ❌ NONE` for both bills
- API successfully fetches 4K+ characters
- **Root Cause**: Text fetching is working, but NOT being stored in database

### 2. **Duplicate Bills in Database**

- Same legislation exists twice:
  - `cmg8hnogg01s0vge4zy081u03` (S 2309)
  - `cmg8hpfjv01w9vge47ziae2b7` (HR 4398)
- **Root Cause**: No companion bill linking implemented

### 3. **Wrong Dates Being Used**

- **HR 4398**:
  - API: Introduced 2025-07-15
  - DB: Shows 2025-10-01 (using `updateDate`!)
- **S 2309**:
  - API: Introduced 2025-07-16
  - DB: Shows 2025-09-10 (using `updateDate`!)
- **Root Cause**: Using `updateDate` instead of `introducedDate`

### 4. **Missing Data Not Being Stored**

- ❌ Related bills / companion bills
- ❌ Legislative subjects/topics
- ❌ Actions (available but not stored)
- ❌ Committee assignments (available but not stored)
- ❌ Cosponsor lists (available but not stored)
- ❌ Multiple title versions

---

## 📋 Available API Endpoints (10 Total)

| #   | Endpoint                                                | Purpose               | Data Available | Currently Stored |
| --- | ------------------------------------------------------- | --------------------- | -------------- | ---------------- |
| 1   | `/bill/{congress}/{billType}/{billNumber}`              | Main details          | ✅ Yes         | ✅ Partial       |
| 2   | `/bill/{congress}/{billType}/{billNumber}/actions`      | Action history        | ✅ Yes         | ❌ No            |
| 3   | `/bill/{congress}/{billType}/{billNumber}/amendments`   | Amendments            | ⚠️ None yet    | ❌ No            |
| 4   | `/bill/{congress}/{billType}/{billNumber}/committees`   | Committee assignments | ✅ Yes         | ❌ No            |
| 5   | `/bill/{congress}/{billType}/{billNumber}/cosponsors`   | Cosponsor list        | ✅ Yes         | ❌ No            |
| 6   | `/bill/{congress}/{billType}/{billNumber}/relatedbills` | **Companion bills**   | ✅ Yes         | ❌ No            |
| 7   | `/bill/{congress}/{billType}/{billNumber}/subjects`     | Topics/subjects       | ⚠️ None yet    | ❌ No            |
| 8   | `/bill/{congress}/{billType}/{billNumber}/summaries`    | Official summaries    | ⚠️ None yet    | ❌ No            |
| 9   | `/bill/{congress}/{billType}/{billNumber}/text`         | Full text versions    | ✅ Yes         | ❌ No (broken)   |
| 10  | `/bill/{congress}/{billType}/{billNumber}/titles`       | All title versions    | ✅ Yes         | ✅ Partial       |

---

## 🔍 Data Structure Examples

### Main Bill Data

```json
{
  "congress": 119,
  "type": "hr",
  "number": "4398",
  "title": "Veteran Burial Timeliness and Death Certificate Accountability Act",
  "introducedDate": "2025-07-15",
  "latestAction": {
    "actionDate": "2025-07-15",
    "text": "Referred to the House Committee on Veterans' Affairs."
  },
  "updateDate": "2025-10-01T08:05:35Z",
  "sponsors": [
    {
      "bioguideId": "E000294",
      "fullName": "Rep. Emmer, Tom [R-MN-6]",
      "party": "R",
      "state": "MN"
    }
  ],
  "policyArea": {
    "name": "Armed Forces and National Security"
  }
}
```

### Related Bills (KEY FOR DUPLICATES!)

```json
{
  "relatedBills": [
    {
      "title": "Veteran Burial Timeliness and Death Certificate Accountability Act",
      "type": "s",
      "number": "2309",
      "congress": 119,
      "relationshipDetails": [
        {
          "type": "Related bill",
          "identified": "2025-07-16"
        }
      ]
    }
  ]
}
```

### Actions

```json
{
  "actions": [
    {
      "actionDate": "2025-07-15",
      "text": "Referred to the House Committee on Veterans' Affairs.",
      "actionCode": "H11100"
    },
    {
      "actionDate": "2025-07-15",
      "text": "Introduced in House",
      "actionCode": "Intro-H"
    }
  ]
}
```

### Cosponsors

```json
{
  "cosponsors": [
    {
      "bioguideId": "R000610",
      "fullName": "Rep. Reschenthaler, Guy [R-PA-14]",
      "party": "R",
      "state": "PA",
      "sponsorshipDate": "2025-07-15"
    }
  ]
}
```

---

## 🎯 Immediate Next Steps

### 1. Fix Text Storage (CRITICAL)

**Problem**: Text fetching works but not being saved  
**Fix**: Debug `fetch-bills-paginated.ts` - check if `fullText` field is being passed to database

```typescript
// In fetch-bills-paginated.ts, verify this section:
if (existing) {
  await db.bill.update({
    where: { id: existing.id },
    data: {
      fullText, // ← Is this being passed?
      fullTextUrl,
      // ...
    },
  });
}
```

### 2. Implement Companion Bill Linking (HIGH PRIORITY)

**Solution**: Use the `/relatedbills` endpoint

**Approach Options**:

**Option A: Single Primary Entry** (Recommended)

- Store ONE entry for the legislation
- Add `companionBills` array field
- Example:
  ```json
  {
    "id": "...",
    "title": "Veteran Burial Act",
    "primaryBill": "hr4398",
    "companionBills": [{ "billType": "s", "billNumber": 2309, "congress": 119 }]
  }
  ```

**Option B: Separate Entries with Links**

- Keep both bills as separate records
- Add `relatedBillIds` field linking them
- On detail page, show both versions side-by-side

**Recommendation**: Option A - Single primary entry with companions array

### 3. Fix Date Usage (CRITICAL)

**Problem**: Using `updateDate` instead of `introducedDate`  
**Fix**:

```typescript
// Current (WRONG):
const introducedDateStr = billData.introducedDate || billData.updateDate;

// Should be:
const introducedDateStr = billData.introducedDate;
if (!introducedDateStr) {
  console.log(`⚠ Skipping: missing introducedDate`);
  continue;
}
```

### 4. Store Actions, Committees, Cosponsors (MEDIUM PRIORITY)

**Schema already supports**:

- `Action` model ✅
- `Member` model for cosponsors ✅
- Need to add: Committee model

**Implementation**:

1. Fetch actions after creating/updating bill
2. Store in `Action` table
3. Fetch committee assignments
4. Fetch and link cosponsors

### 5. Add Schema for Missing Data (LOW PRIORITY)

**New models needed**:

```prisma
model RelatedBill {
  id              String   @id @default(cuid())

  billId          String
  bill            Bill     @relation(fields: [billId], references: [id])

  relatedBillType String   // "hr", "s", etc.
  relatedBillNumber Int
  relatedCongress Int

  relationshipType String  // "Identical bill", "Companion bill", etc.
  identifiedDate   DateTime?

  @@unique([billId, relatedBillType, relatedBillNumber, relatedCongress])
}

model Subject {
  id              String   @id @default(cuid())
  name            String   @unique
  bills           Bill[]   @relation("BillSubjects")
}
```

---

## 🚀 Recommended Implementation Order

### Phase 1: Fix Critical Issues (DO THIS FIRST)

1. **Fix text storage** - Debug why fullText isn't being saved
2. **Fix date usage** - Use `introducedDate` not `updateDate`
3. **Test with single bill** - Run test script to verify fixes

### Phase 2: Prevent Duplicates

1. **Add RelatedBill model** to schema
2. **Fetch related bills** in fetch scripts
3. **Check for companions** before creating new bill
4. **Link existing duplicates** - Run migration script to link HR 4398 ↔ S 2309

### Phase 3: Enrich Data

1. **Store actions** - Already have model, just fetch and save
2. **Store committees** - Add model and fetch
3. **Store cosponsors** - Use existing Member model
4. **Store subjects** - Add model and fetch

### Phase 4: UI Enhancements

1. **Show companion bills** on detail page
2. **Display action timeline**
3. **Show committee assignments**
4. **List cosponsors**
5. **Add subjects/topics**

---

## 📝 Test Script Usage

```bash
# Run comprehensive single-bill analysis
npm run test-single-bill

# Output includes:
# - Database duplicate check
# - 10 API endpoint tests per bill
# - Full text preview
# - Companion bill analysis
# - Missing data identification
```

---

## 💡 Key Insights

1. **Congress.gov API is Rich**: We're only using ~30% of available data
2. **Companion Bills Are Critical**: This is how Congress.gov prevents duplicates
3. **Dates Matter**: `introducedDate` is stable, `updateDate` changes constantly
4. **Text Fetching Works**: The infrastructure is there, just not saving to DB
5. **Schema Needs Expansion**: Many useful fields not being captured

---

## ✅ Success Criteria

**Phase 1 Complete When**:

- ✅ Text is being stored in database
- ✅ Bills use `introducedDate` not `updateDate`
- ✅ Test script shows both bills with full text

**Phase 2 Complete When**:

- ✅ Duplicate detection via `/relatedbills` endpoint
- ✅ HR 4398 and S 2309 linked as companions
- ✅ Detail page shows "Also available as S 2309"

**Phase 3 Complete When**:

- ✅ Actions timeline displayed
- ✅ Committee assignments shown
- ✅ Cosponsors listed
- ✅ Topics/subjects tagged

---

## 📚 Resources

- **API Docs**: https://api.congress.gov/
- **Test Script**: `scripts/test-single-bill.ts`
- **Schema**: `prisma/schema.prisma`
- **API Client**: `src/lib/api/congress.ts`
- **Fetch Scripts**: `scripts/fetch-bills-*.ts`

---

**Last Updated**: October 1, 2025  
**Next Review**: After fixing Phase 1 critical issues
