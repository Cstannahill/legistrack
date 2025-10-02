# Companion Bill Implementation Guide

## Overview

This document outlines the implementation of companion bill detection and linking in the legislation tracker application.

## Database Schema (✅ COMPLETED)

### CompanionBill Model

```prisma
model CompanionBill {
  id                String   @id @default(cuid())
  sourceBillId      String
  sourceBill        Bill     @relation("SourceBill", fields: [sourceBillId], references: [id], onDelete: Cascade)
  companionBillId   String
  companionBill     Bill     @relation("CompanionBill", fields: [companionBillId], references: [id], onDelete: Cascade)
  relationshipType  CompanionType @default(IDENTICAL)
  verifiedAt        DateTime @default(now())
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([sourceBillId, companionBillId])
  @@index([sourceBillId])
  @@index([companionBillId])
}

enum CompanionType {
  IDENTICAL       // Exact same text in both chambers
  RELATED         // Similar but with differences
  SUPERSEDED      // One replaces the other
}
```

### Bill Model Updates

```prisma
model Bill {
  // ... existing fields ...

  // Companion bills (same legislation in different chambers)
  companionBills    CompanionBill[] @relation("SourceBill")
  companionOf       CompanionBill[] @relation("CompanionBill")
}
```

## Migration Status

✅ Migration created: `20251001224551_add_companion_bills`
✅ Applied to database successfully
⚠️ Prisma client needs regeneration (file lock issue on Windows)

## Implementation Steps

### 1. Fetch Script Enhancement (IN PROGRESS)

**File**: `scripts/fetch-bills.ts`

**Add helper function**:

```typescript
async function processCompanionBills(
  billId: string,
  billType: string,
  billNumber: string,
  congress: number
) {
  // Fetch /relatedbills endpoint from Congress.gov
  // Find matching bills in database
  // Create CompanionBill entries (bidirectional)
  // Return count of companions created
}
```

**Integration point** (after bill creation/update):

```typescript
// After creating or updating a bill
if (FETCH_COMPANIONS && billId) {
  const companions = await processCompanionBills(
    billId,
    billData.type,
    billData.number,
    CURRENT_CONGRESS
  );
  if (companions > 0) {
    console.log(`   🔗 Linked ${companions} companion bill(s)`);
  }
}
```

### 2. API Endpoint Updates (TODO)

**File**: `src/app/api/bills/[id]/route.ts`

Update to include companion bill data:

```typescript
const bill = await db.bill.findUnique({
  where: { id: params.id },
  include: {
    sponsor: true,
    categories: { include: { category: true } },
    summaries: { orderBy: { createdAt: "desc" }, take: 1 },
    amendments: true,
    votes: true,
    actions: { orderBy: { actionDate: "desc" }, take: 10 },
    // NEW: Include companion bills
    companionBills: {
      include: {
        companionBill: {
          select: {
            id: true,
            billType: true,
            billNumber: true,
            congress: true,
            title: true,
            introducedDate: true,
            currentStatus: true,
            fullText: true,
          },
        },
      },
    },
  },
});
```

### 3. Bill Detail Page UI (TODO)

**File**: `src/app/bills/[id]/page.tsx`

#### Upper Tabs (Chamber Selection)

```tsx
<Tabs defaultValue={primaryChamber}>
  <TabsList>
    <TabsTrigger value="house">House Version (HR {houseNumber})</TabsTrigger>
    <TabsTrigger value="senate">Senate Version (S {senateNumber})</TabsTrigger>
  </TabsList>

  <TabsContent value="house">
    {/* Display House bill content */}
    <LowerTabs billData={houseBill} />
  </TabsContent>

  <TabsContent value="senate">
    {/* Display Senate bill content */}
    <LowerTabs billData={senateBill} />
  </TabsContent>
</Tabs>
```

#### Lower Tabs (Content Type)

```tsx
<Tabs defaultValue="summary">
  <TabsList>
    <TabsTrigger value="summary">Summary</TabsTrigger>
    <TabsTrigger value="fulltext">Full Text</TabsTrigger>
    <TabsTrigger value="details">Details</TabsTrigger>
    <TabsTrigger value="actions">Actions</TabsTrigger>
  </TabsList>

  <TabsContent value="summary">{/* ... */}</TabsContent>
  <TabsContent value="fulltext">{/* ... */}</TabsContent>
  <TabsContent value="details">{/* ... */}</TabsContent>
  <TabsContent value="actions">{/* ... */}</TabsContent>
</Tabs>
```

### 4. Bills Listing Page (TODO)

**File**: `src/app/bills/page.tsx`

Group companion bills together:

```typescript
// In the search/filter logic, detect companions
const groupedBills = bills.reduce((acc, bill) => {
  // If bill has companions, group them together
  if (bill.companionBills.length > 0) {
    const groupKey = `${bill.title}-${bill.congress}`;
    if (!acc[groupKey]) {
      acc[groupKey] = {
        primary: bill,
        companions: [],
      };
    }
    // Add companions
    bill.companionBills.forEach((cb) => {
      acc[groupKey].companions.push(cb.companionBill);
    });
  } else {
    // Standalone bill
    acc[bill.id] = { primary: bill, companions: [] };
  }
  return acc;
}, {});
```

Display with chamber badges:

```tsx
<BillCard>
  <div className="flex gap-2">
    {group.primary.billType.startsWith("H") && (
      <Badge>
        House: {group.primary.billType} {group.primary.billNumber}
      </Badge>
    )}
    {group.companions.map((comp) => (
      <Badge key={comp.id}>
        {comp.billType.startsWith("S") ? "Senate" : "House"}:{comp.billType}{" "}
        {comp.billNumber}
      </Badge>
    ))}
  </div>
</BillCard>
```

## Testing Plan

### 1. Test Companion Detection

```bash
# Delete test bills
npm run test-delete-veteran-bills

# Fetch bills with companion detection
FETCH_COMPANIONS=true npm run fetch-bills

# Verify companion relationships created
npm run test-companion-links
```

### 2. Test UI Display

- Navigate to `/bills/[id]` for HR 4398 or S 2309
- Verify upper tabs show both chambers
- Verify clicking tabs switches between versions
- Verify lower tabs (Summary, Full Text, etc.) maintain state
- Verify bills listing groups companions together

## Expected Results

### Database

- HR 4398 and S 2309 should have CompanionBill entries linking them
- Relationship should be bidirectional
- relationshipType should be "RELATED" (based on API data)

### UI

- Bills listing shows one entry for "Veteran Burial Timeliness..." with both HR and S badges
- Bill detail page shows chamber tabs
- Clicking chamber tabs switches between HR 4398 and S 2309
- All content tabs (Summary, Full Text, etc.) work correctly for both versions

## API Endpoint Reference

### Congress.gov Related Bills Endpoint

```
GET https://api.congress.gov/v3/bill/{congress}/{type}/{number}/relatedbills
```

**Response Structure**:

```json
{
  "relatedBills": [
    {
      "congress": 119,
      "type": "S",
      "number": "2309",
      "title": "Veteran Burial Timeliness and Death Certificate Accountability Act",
      "relationshipDetails": [
        {
          "type": "Related bill",
          "identifiedBy": "CRS"
        }
      ]
    }
  ]
}
```

## Next Steps

1. ✅ Create CompanionBill schema
2. ✅ Run migration
3. ⏳ Regenerate Prisma client (waiting for file unlock)
4. ⏳ Complete fetch script companion detection
5. TODO: Update API endpoints to include companion data
6. TODO: Create bill detail page with chamber tabs
7. TODO: Update bills listing to group companions
8. TODO: Test with HR 4398 and S 2309

## Notes

- The Congress.gov API provides companion bill information via the `/relatedbills` endpoint
- Companion bills typically have the same title but different bill types (HR vs S)
- The relationship is bidirectional - both bills reference each other
- Some bills may have multiple companions or no companions at all
- The UI should gracefully handle bills with 0, 1, or multiple companions
