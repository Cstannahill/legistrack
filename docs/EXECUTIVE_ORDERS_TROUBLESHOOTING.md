# Executive Orders Fetching - Troubleshooting Guide

## Issue Encountered

When running `npm run fetch-executive-orders`, all 100 documents are being skipped with the message:

```
⚠️  Skipping non-presidential document: 2025-XXXXX
```

## Root Cause Analysis

The script is checking `if (doc.type !== "PRESDOCU")` and skipping documents, which suggests one of two things:

1. **API Filter Not Working**: The Federal Register API conditions aren't being applied correctly
2. **Type Field Name Mismatch**: The actual API response uses a different field name than `type`

## Diagnostic Steps

### Step 1: Run the Test Script

```bash
npm run test-federal-register
```

This will show you:

- The actual structure of documents returned by the API
- What fields are available (type, presidential_document_type, etc.)
- Sample documents of each type

### Step 2: Check API Response Structure

The test script will print the first document's JSON structure. Look for:

```json
{
  "document_number": "2025-XXXXX",
  "type": "???", // <-- What value is this?
  "presidential_document_type": "executive_order", // <-- Is this field present?
  "title": "..."
  // ... other fields
}
```

## Possible Issues & Fixes

### Issue A: API Returns Different Type Field

**If the API response shows something like:**

```json
{
  "document_type": "Presidential Document",  // Instead of "type": "PRESDOCU"
  ...
}
```

**Fix:**

```typescript
// In fetch-executive-orders.ts, change:
if (doc.type !== "PRESDOCU") {

// To:
if (!doc.presidential_document_type) {
  // Skip if no presidential document type specified
}
```

### Issue B: API Conditions Not Applied

**If test shows documents without `presidential_document_type`:**

The Federal Register API client may not be correctly formatting the query parameters.

**Fix in `src/lib/api/federal-register.ts`:**

```typescript
// Current (line 28):
url.searchParams.set("conditions[type][]", "PRESDOCU");

// Try changing to:
url.searchParams.append("conditions[type]", "PRESDOCU");
// OR
url.searchParams.set("conditions[type]", "PRESDOCU");
```

### Issue C: Presidential Document Type Not Filtering

**If test shows all document types:**

The `conditions[presidential_document_type][]` parameter might not be working.

**Fix:**

```typescript
// In federal-register.ts, try:
url.searchParams.set(
  "conditions[presidential_document_type]",
  "executive_order"
);

// Instead of:
url.searchParams.set(
  "conditions[presidential_document_type][]",
  "executive_order"
);
```

## Federal Register API Query Formats

### Method 1: Direct URL Construction (Most Reliable)

```typescript
const url =
  "https://www.federalregister.gov/api/v1/documents.json?" +
  "conditions[type]=PRESDOCU&" +
  "conditions[presidential_document_type][]=executive_order&" +
  "per_page=100&" +
  "order=newest";
```

### Method 2: URL SearchParams (Current Approach)

```typescript
const url = new URL("https://www.federalregister.gov/api/v1/documents.json");
url.searchParams.set("conditions[type][]", "PRESDOCU");
url.searchParams.set(
  "conditions[presidential_document_type][]",
  "executive_order"
);
```

### Method 3: Test with curl

```bash
curl "https://www.federalregister.gov/api/v1/documents.json?conditions[type][]=PRESDOCU&conditions[presidential_document_type][]=executive_order&per_page=5"
```

## Quick Fix: Bypass Type Check Temporarily

To test if the rest of the script works, you can temporarily comment out the type check:

```typescript
// In fetch-executive-orders.ts:

// Skip if not a presidential document
// if (doc.type !== "PRESDOCU") {
//   console.log(
//     `⚠️  Skipping non-presidential document: ${doc.document_number} (type: ${doc.type})`
//   );
//   skipped++;
//   continue;
// }

// Instead, check for executive order type:
if (!doc.presidential_document_type) {
  console.log(`⚠️  Skipping document without type: ${doc.document_number}`);
  skipped++;
  continue;
}
```

## Expected vs Actual API Response

### Expected Response Structure:

```json
{
  "results": [
    {
      "document_number": "2025-12345",
      "type": "PRESDOCU",
      "presidential_document_type": "executive_order",
      "title": "Executive Order on...",
      "signing_date": "2025-09-15",
      "publication_date": "2025-09-16",
      "executive_order_number": 14321,
      "president": {
        "name": "President Name"
      },
      "html_url": "https://...",
      "pdf_url": "https://...",
      "abstract": "This executive order...",
      "full_text_xml_url": "https://...",
      "body_html_url": "https://..."
    }
  ],
  "count": 1,
  "total_pages": 1
}
```

## Recommended Next Steps

1. **Run test script first:**

   ```bash
   npm run test-federal-register
   ```

2. **Compare actual vs expected structure**

3. **Update fetch-executive-orders.ts based on findings:**

   - Adjust field names if different
   - Remove or modify type check
   - Update filtering logic

4. **Test with small batch:**

   ```bash
   LIMIT=5 npm run fetch-executive-orders
   ```

5. **Once working, run full fetch:**
   ```bash
   LIMIT=1000 npm run fetch-executive-orders
   ```

## Alternative: Use Direct API Approach

If the helper functions aren't working, we can bypass them:

```typescript
// In fetch-executive-orders.ts:

const response = await fetch(
  "https://www.federalregister.gov/api/v1/documents.json?" +
    "conditions[type][]=PRESDOCU&" +
    "conditions[presidential_document_type][]=executive_order&" +
    "per_page=100&" +
    "order=newest"
);

const data = await response.json();
const documents = data.results || [];

// Process documents...
```

## Debug Logging

Add comprehensive logging to see what's happening:

```typescript
console.log("🔍 API URL:", url.toString());
console.log("🔍 Response status:", response.status);
console.log("🔍 Response headers:", Object.fromEntries(response.headers));
console.log("🔍 First doc keys:", Object.keys(documents[0] || {}));
console.log("🔍 First doc type field:", documents[0]?.type);
console.log(
  "🔍 First doc pres_doc_type:",
  documents[0]?.presidential_document_type
);
```

## Common Federal Register API Gotchas

1. **Array parameters need `[]` suffix:**

   - ✅ `conditions[type][]=PRESDOCU`
   - ❌ `conditions[type]=PRESDOCU`

2. **Some filters are mutually exclusive:**

   - Don't combine too many condition types

3. **Pagination:**

   - Max `per_page` is 1000
   - Results may be less than requested

4. **Date formats:**

   - Use ISO 8601: `YYYY-MM-DD`
   - `publication_date` vs `signing_date`

5. **Response structure:**
   - Results are in `data.results` array
   - Metadata in `data.count`, `data.total_pages`

## Success Criteria

When fixed, you should see:

```
🏛️  Fetching Executive Orders from Federal Register API
📊 Limit: 100
📄 Fetch Full Text: No
📋 Document Types: Executive Orders Only
================================================================================

📥 Fetching 100 documents...
✅ Fetched 100 documents

✓ Created: Executive Order 14123 - "Title..."
✓ Created: Executive Order 14122 - "Title..."
...

================================================================================
📊 SUMMARY
================================================================================
✓ Created: 50
↻ Updated: 0
○ Skipped: 0
📄 Text Fetched: 0
⚠️  Text N/A: 0
📊 Total Processed: 50
================================================================================
```

## Contact & References

- **Federal Register API Docs:** https://www.federalregister.gov/developers/documentation/api/v1
- **API Playground:** https://www.federalregister.gov/developers/api/v1
- **Example Queries:** https://www.federalregister.gov/developers/documentation/api/v1#get-documents

## After Fixing

Once the issue is resolved, document the fix in this file and update:

1. `src/lib/api/federal-register.ts` with correct query format
2. `scripts/fetch-executive-orders.ts` with correct filtering logic
3. `docs/EXECUTIVE_ORDERS_IMPLEMENTATION.md` with lessons learned
