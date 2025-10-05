# Executive Orders Implementation

## ✅ STATUS: SUCCESSFULLY IMPLEMENTED AND TESTED

**Date Completed**: October 1, 2025  
**Test Results**: ✅ All tests passing  
**Records Created**: 10 executive orders successfully stored in database

### Quick Start

```bash
# Fetch latest 10 executive orders
LIMIT=10 npm run fetch-executive-orders

# Fetch 50 with full text
LIMIT=50 FETCH_TEXT=true npm run fetch-executive-orders

# Check what's in the database
npx tsx scripts/check-executive-orders.ts
```

### Key Fixes Applied

1. ✅ **Fixed Type Check**: Changed from `"PRESDOCU"` to `"Presidential Document"`
2. ✅ **Two-Step Fetching**: Implemented list view → detail view for complete data
3. ✅ **Type Conversion**: Fixed `executive_order_number` string → integer conversion
4. ✅ **Subtype Mapping**: Using `subtype` field instead of `presidential_document_type`
5. ✅ **President Names**: Infer from signing date when API doesn't provide

---

## Overview

Implementation for fetching, storing, and processing Executive Orders and other Presidential Documents from the Federal Register API.

---

## Federal Register API

### Base Information

- **API URL**: `https://www.federalregister.gov/api/v1/`
- **Authentication**: None required (public API)
- **Rate Limits**: ~1000 requests/hour (generous)
- **Documentation**: https://www.federalregister.gov/developers/documentation/api/v1

### Document Types

The Federal Register publishes several types of presidential documents:

| Type                      | Description                        | Example                            |
| ------------------------- | ---------------------------------- | ---------------------------------- |
| `executive_order`         | Official directives from President | Executive Order 14001              |
| `presidential_memorandum` | Policy guidance documents          | Presidential Memorandum on Climate |
| `proclamation`            | Formal announcements               | National Day Proclamations         |
| `determination`           | Presidential findings              | Trade determinations               |
| `notice`                  | Informational announcements        | Various notices                    |

---

## Database Schema

### ExecutiveOrder Model

```prisma
model ExecutiveOrder {
  id                String   @id @default(cuid())

  // Official identifiers
  orderNumber       Int      @unique
  executiveOrderType ExecutiveOrderType

  // Core information
  title             String   @db.Text
  signingDate       DateTime
  publicationDate   DateTime?

  // Content
  fullText          String?  @db.Text
  fullTextUrl       String?
  federalRegisterUrl String?

  // Relationships
  summaries         Summary[]
  categories        Category[]

  // Metadata
  presidentName     String
  sourceUrl         String?
  lastFetchedAt     DateTime @default(now())
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

enum ExecutiveOrderType {
  EXECUTIVE_ORDER
  PRESIDENTIAL_MEMORANDUM
  PROCLAMATION
  DETERMINATION
}
```

---

## Fetching Executive Orders

### Script: `fetch-executive-orders.ts`

**Purpose**: Fetch Executive Orders and Presidential Documents from Federal Register API

**Usage:**

```bash
# Fetch 100 most recent executive orders (default)
npm run fetch-executive-orders

# Fetch 50 executive orders
LIMIT=50 npm run fetch-executive-orders

# Fetch all presidential document types
FETCH_ALL_TYPES=true npm run fetch-executive-orders

# Fetch with full text (slower)
FETCH_TEXT=true LIMIT=25 npm run fetch-executive-orders
```

**Environment Variables:**

| Variable          | Default | Description                                   |
| ----------------- | ------- | --------------------------------------------- |
| `LIMIT`           | `100`   | Number of documents to fetch (max 1000)       |
| `FETCH_TEXT`      | `false` | Whether to fetch full text content            |
| `FETCH_ALL_TYPES` | `false` | Fetch all presidential doc types vs. just EOs |

**What it does:**

1. ✅ Fetches recent presidential documents from Federal Register
2. ✅ Extracts order numbers (for EOs)
3. ✅ Maps document types to database enum
4. ✅ Parses signing and publication dates
5. ✅ Optionally fetches full text content
6. ✅ Creates or updates records in database
7. ✅ Handles duplicates (by order number)
8. ✅ Provides detailed progress output

**Example Output:**

```
🏛️  Fetching Executive Orders from Federal Register API
📊 Limit: 100
📄 Fetch Full Text: No
📋 Document Types: Executive Orders Only
================================================================================

📥 Fetching 100 documents...
✅ Fetched 97 documents

✓ Created: EXECUTIVE_ORDER 14152 [2025-09-28] - Advancing American Leadership...
✓ Created: EXECUTIVE_ORDER 14151 [2025-09-25] - Strengthening Cybersecurity...
↻ Updated: EXECUTIVE_ORDER 14150
○ Exists: EXECUTIVE_ORDER 14149
✓ Created: PRESIDENTIAL_MEMORANDUM 100124 [2025-09-20] - Climate Action Plan...

================================================================================
📊 SUMMARY
================================================================================
✓ Created: 72
↻ Updated: 8
○ Skipped: 17
📄 Text Fetched: 0
⚠️  Text N/A: 0
📊 Total Processed: 97
================================================================================

💡 Tip: Run with FETCH_TEXT=true to fetch full text for executive orders
```

---

## API Client

### Location: `src/lib/api/federal-register.ts`

**Main Functions:**

#### 1. `fetchExecutiveOrders(params)`

Fetches list of executive orders with filtering options.

```typescript
const orders = await fetchExecutiveOrders({
  perPage: 100,
  conditions: {
    presidentialDocumentType: ["executive_order"],
    publicationDate: {
      gte: "2024-01-01",
      lte: "2024-12-31",
    },
  },
});
```

**Parameters:**

- `page`: Page number (default: 1)
- `perPage`: Results per page (max: 1000)
- `conditions`: Filter criteria
  - `presidentialDocumentType`: Array of document types
  - `publicationDate`: Date range filters

**Returns:** Array of `FederalRegisterDocument` objects

#### 2. `fetchExecutiveOrderDetails(documentNumber)`

Fetches detailed information for a specific document.

```typescript
const details = await fetchExecutiveOrderDetails("2025-12345");
```

**Parameters:**

- `documentNumber`: Federal Register document number

**Returns:** Detailed document object with full metadata

#### 3. `fetchExecutiveOrderFullText(documentNumber)`

Attempts to fetch the full text content of a document.

```typescript
const fullText = await fetchExecutiveOrderFullText("2025-12345");
```

**Parameters:**

- `documentNumber`: Federal Register document number

**Returns:** String of full text content or `null` if unavailable

---

## Type Mappings

### Federal Register → Database

The script automatically maps Federal Register document types to our database enum:

```typescript
// Federal Register API          → Database Enum
"executive_order"                → "EXECUTIVE_ORDER"
"presidential_memorandum"        → "PRESIDENTIAL_MEMORANDUM"
"proclamation"                   → "PROCLAMATION"
"determination"                  → "DETERMINATION"
```

### Order Number Extraction

**For Executive Orders:**

- Uses `executive_order_number` field from API
- Falls back to regex extraction from title: `"Executive Order 14001"`

**For Other Document Types:**

- No official order number
- Generates synthetic number from document_number hash
- Range: 100000-999999 (to avoid conflicts with real EO numbers)

---

## Data Flow

### 1. Fetch Stage

```
Federal Register API
        ↓
fetch-executive-orders.ts
        ↓
    Database
```

### 2. Processing Stage (Future)

```
Database ExecutiveOrders
        ↓
summarize-executive-orders.ts
        ↓
AI Summarization
        ↓
Database Summaries
```

---

## Typical Workflows

### Initial Data Load

```bash
# 1. Fetch recent executive orders (no text)
npm run fetch-executive-orders

# 2. View in database
npm run db:studio

# 3. Fetch older orders with date range (future enhancement)
# PUBLICATION_DATE_START=2024-01-01 npm run fetch-executive-orders
```

### Fetch All Presidential Documents

```bash
# Fetch all types (EOs, memoranda, proclamations, etc.)
FETCH_ALL_TYPES=true LIMIT=200 npm run fetch-executive-orders
```

### Fetch with Full Text

```bash
# Fetch 25 recent EOs with full text (slower)
FETCH_TEXT=true LIMIT=25 npm run fetch-executive-orders
```

### Update Existing Records

```bash
# Re-run to update missing data (like full text)
FETCH_TEXT=true npm run fetch-executive-orders
# Only updates records missing text/president name
```

---

## API Response Structure

### Document List Response

```json
{
  "count": 97,
  "description": "Presidential Documents",
  "total_pages": 1,
  "results": [
    {
      "document_number": "2025-12345",
      "type": "PRESDOCU",
      "presidential_document_type": "executive_order",
      "executive_order_number": 14152,
      "title": "Advancing American Leadership in AI",
      "signing_date": "2025-09-28",
      "publication_date": "2025-09-30",
      "president": {
        "name": "Joseph R. Biden"
      },
      "html_url": "https://www.federalregister.gov/documents/...",
      "pdf_url": "https://www.govinfo.gov/content/pkg/...",
      "abstract": "This executive order...",
      "body_html_url": "https://www.federalregister.gov/documents/.../body.html"
    }
  ]
}
```

### Key Fields

| Field                        | Type   | Description                             |
| ---------------------------- | ------ | --------------------------------------- |
| `document_number`            | string | Unique Federal Register ID              |
| `type`                       | string | Always "PRESDOCU" for presidential docs |
| `presidential_document_type` | string | Specific type (see types above)         |
| `executive_order_number`     | number | Official EO number (EOs only)           |
| `title`                      | string | Official title                          |
| `signing_date`               | string | Date president signed (YYYY-MM-DD)      |
| `publication_date`           | string | Date published in Federal Register      |
| `president.name`             | string | President's name                        |
| `html_url`                   | string | Federal Register webpage URL            |
| `pdf_url`                    | string | GovInfo PDF URL                         |
| `body_html_url`              | string | Full text HTML URL                      |

---

## Error Handling

### Common Issues

**1. No order number for Executive Order**

```
⚠️  Skipping EO without number: Advancing American Leadership in AI...
```

**Solution:** Document is likely mislabeled or too new. Check Federal Register directly.

**2. Invalid date**

```
⚠️  Skipping EXECUTIVE_ORDER 14150: invalid date
```

**Solution:** Document has malformed date field. Will be skipped automatically.

**3. Text fetch failed**

```
⚠️  Could not fetch text for EXECUTIVE_ORDER 14151: 404
```

**Solution:** Full text not yet published. Document metadata still saved.

**4. Rate limit hit**

```
Federal Register API error: 429 - Too Many Requests
```

**Solution:** Wait 10 minutes and retry. Script includes 300ms delays between text fetches.

---

## Performance Considerations

### Fetching Speed

**Without Full Text:**

- ~100 documents in 5-10 seconds
- API metadata only
- Ideal for initial data load

**With Full Text:**

- ~25 documents in 30-60 seconds
- Includes 300ms delay per document
- Each text fetch is additional HTTP request

**Recommendations:**

- Use `FETCH_TEXT=false` (default) for bulk imports
- Use `FETCH_TEXT=true` selectively for important documents
- Consider separate text backfill script (like `fetch-bill-texts.ts`)

### Rate Limiting

Federal Register API is generous:

- ~1000 requests/hour
- No API key required
- Public access

Script includes built-in delays:

- 300ms between full text fetches
- Prevents overwhelming the API

---

## Future Enhancements

### Planned Features

1. **Date Range Filtering**

   ```bash
   PUBLICATION_DATE_START=2024-01-01 \
   PUBLICATION_DATE_END=2024-12-31 \
   npm run fetch-executive-orders
   ```

2. **Paginated Fetching**

   - `fetch-executive-orders-paginated.ts`
   - Auto-paginate through large result sets
   - Similar to `fetch-bills-paginated.ts`

3. **Specific President Filtering**

   ```bash
   PRESIDENT="Biden" npm run fetch-executive-orders
   ```

4. **Text Backfill Script**

   - `fetch-executive-order-texts.ts`
   - Batch fetch missing full text
   - Similar to `fetch-bill-texts.ts`

5. **AI Summarization**

   - `summarize-executive-orders.ts`
   - Generate BRIEF, STANDARD, ELI5 summaries
   - Use existing summarization infrastructure

6. **Presidential Comparison**
   - Compare EO counts by president
   - Analyze topics and trends
   - Historical analysis

---

## Database Queries

### Useful Prisma Queries

**Get all Executive Orders:**

```typescript
const orders = await db.executiveOrder.findMany({
  where: {
    executiveOrderType: "EXECUTIVE_ORDER",
  },
  orderBy: {
    orderNumber: "desc",
  },
});
```

**Get orders by president:**

```typescript
const bidenOrders = await db.executiveOrder.findMany({
  where: {
    presidentName: "Joseph R. Biden",
  },
});
```

**Get orders without full text:**

```typescript
const needsText = await db.executiveOrder.findMany({
  where: {
    fullText: null,
  },
});
```

**Get recent orders:**

```typescript
const recent = await db.executiveOrder.findMany({
  where: {
    signingDate: {
      gte: new Date("2025-01-01"),
    },
  },
  orderBy: {
    signingDate: "desc",
  },
});
```

---

## Testing

### Quick Test

```bash
# Fetch 10 recent EOs
LIMIT=10 npm run fetch-executive-orders

# Check database
npm run db:studio
```

### Comprehensive Test

```bash
# 1. Fetch metadata for 100 orders
LIMIT=100 npm run fetch-executive-orders

# 2. Verify count
# Open Prisma Studio, check ExecutiveOrder table

# 3. Fetch full text for 10 orders
FETCH_TEXT=true LIMIT=10 npm run fetch-executive-orders

# 4. Verify text was added
# Check fullText field is populated
```

---

## Integration with Existing System

### Shared Components

**Already Compatible:**

- ✅ Summary model (polymorphic: billId OR executiveOrderId)
- ✅ Category model (relations to both Bills and ExecutiveOrders)
- ✅ AI summarizers (work with any text content)

**Requires Minor Updates:**

- 📝 UI components for displaying executive orders
- 📝 Search/filter components to include executive orders
- 📝 Routes for executive order detail pages

### Reusable Patterns

The implementation follows the same patterns as bills:

| Bills                     | Executive Orders                          |
| ------------------------- | ----------------------------------------- |
| `fetch-bills.ts`          | `fetch-executive-orders.ts`               |
| `fetch-bill-texts.ts`     | (future) `fetch-executive-order-texts.ts` |
| `summarize-bills.ts`      | (future) `summarize-executive-orders.ts`  |
| `Congress.gov API`        | `Federal Register API`                    |
| `billType` + `billNumber` | `executiveOrderType` + `orderNumber`      |

---

## Files Created

1. ✅ `scripts/fetch-executive-orders.ts` - Main fetching script
2. ✅ `src/lib/api/federal-register.ts` - API client (already existed)
3. ✅ `docs/EXECUTIVE_ORDERS_IMPLEMENTATION.md` - This documentation
4. ✅ `package.json` - Added `fetch-executive-orders` script

---

## Cost Comparison

| Service             | Bills (Congress.gov)         | Executive Orders (Federal Register) |
| ------------------- | ---------------------------- | ----------------------------------- |
| **API Access**      | Free, requires key           | Free, no key needed                 |
| **Rate Limits**     | ~5,000/hour                  | ~1,000/hour                         |
| **Data Quality**    | Excellent                    | Excellent                           |
| **Full Text**       | Variable availability        | Consistent availability             |
| **Historical Data** | Limited to recent congresses | Full historical archive             |

---

## Next Steps

1. ✅ **Basic Fetching** - Implemented
2. 📝 **Text Backfill Script** - Create `fetch-executive-order-texts.ts`
3. 📝 **AI Summarization** - Create `summarize-executive-orders.ts`
4. 📝 **UI Components** - Display executive orders in web app
5. 📝 **Search Integration** - Include EOs in search results
6. 📝 **Paginated Fetching** - Handle large historical imports
7. 📝 **Date Range Filtering** - Fetch by date range
8. 📝 **President Filtering** - Filter by president name

---

## Summary

✅ **Federal Register API Client** - Ready to use  
✅ **Database Schema** - Already in place  
✅ **Fetch Script** - Production ready  
✅ **Type Mapping** - Automatic conversion  
✅ **Error Handling** - Comprehensive  
✅ **Documentation** - Complete

**Ready to fetch executive orders now:**

```bash
npm run fetch-executive-orders
```

🎉 **Implementation complete!**

---

## Database Listing Function (Added)

### `get_executive_orders` (Parameterized)

The application now uses a parameterized SQL function for executive order list pages, mirroring the bill listing approach for performance and consistency.

```
get_executive_orders(
  offset_val INT DEFAULT 0,
  limit_val INT DEFAULT 50,
  p_category_slug TEXT DEFAULT NULL,
  p_president_name TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_signing_start DATE DEFAULT NULL,
  p_signing_end DATE DEFAULT NULL,
  p_sort_field TEXT DEFAULT 'signingDate',      -- allowed: signingDate | publicationDate | updatedAt
  p_sort_dir TEXT DEFAULT 'desc'                -- allowed: asc | desc
)
RETURNS (id, kind, billType, billNumber, congress, title, currentStatus, sort_date, presidentName, categories, sponsor, total_count)
```

#### Behavior

- Filters are optional; NULL means "do not filter".
- Only returns executive orders that have `fullText` and at least one non-null `Summary.content` (parity with bill listing completeness constraint).
- `sort_date` is derived dynamically with a precedence fallback: chosen field → `signingDate`.
- Deterministic ordering: primary sort date (NULLS LAST) → kind → stable id.
- `total_count` uses a window function over the filtered set (no separate COUNT query needed).

#### Mapping in UI

The list page (`bills/page.tsx`) now always calls this function for EXECUTIVE_ORDERS view. Prisma fallback for EO lists was removed, reducing divergent code paths.

#### Future Alignment

`get_bills_and_orders` will be parameterized next to unify ALL view filtering without app-layer merging.

#### Indexes Leveraged

- `eo_signingDate_id_idx`, `eo_publicationDate_id_idx`, `eo_updatedAt_id_idx`
- Trigram indexes: `eo_title_trgm_idx`, `eo_president_trgm_idx`
- Category bridge index: `eo_category_bridge_idx`

---
