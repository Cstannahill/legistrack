# Executive Order Full Text & Summarization Setup

## Overview

This document describes the complete setup for fetching full text content from executive orders and generating AI summaries.

## Problem Statement

Executive orders were initially fetched without their full text content (only titles and metadata). This prevented the generation of meaningful AI summaries, as the summarization system requires the complete text of the order to analyze.

## Solution Components

### 1. Full Text Update Script

**File**: `scripts/update-eo-full-text.ts`

**Purpose**: Fetch and populate full text for existing executive orders that don't have it.

**Features**:

- Finds all executive orders with `fullText: null`
- Extracts document number from Federal Register URL
- Fetches full text via Federal Register API
- Updates database records
- Includes rate limiting (300ms delay between requests)

**Usage**:

```bash
npm run update-eo-full-text
```

**Result**: Successfully updated 100 executive orders with full text content (ranging from 3.2KB to 156KB per order).

### 2. Executive Order Summarization Script

**File**: `scripts/summarize-executive-orders.ts`

**Purpose**: Generate AI summaries for executive orders using GPT-5-nano (configurable).

**Features**:

- Finds executive orders without summaries
- Validates that full text exists before attempting summarization
- Uses GPT-5-nano API by default to generate STANDARD summaries
- Extracts key points and impact areas
- Stores summaries with metadata (model, confidence, timestamp)

**Usage**:

```bash
npm run summarize-executive-orders
```

**Configuration**:

- Batch size: 10 executive orders per run (configurable via `BATCH_SIZE` env var)
- AI Provider: GPT-5-nano (OpenAI) by default, configurable via `AI_PROVIDER` env var
- Summary type: STANDARD (can be extended to support BRIEF, DETAILED, etc.)

### 3. HTML to Text Formatter

**File**: `src/lib/utils/html-to-text.ts`

**Purpose**: Convert Federal Register HTML content to readable plain text.

**Functions**:

#### `htmlToText(html: string): string`

Generic HTML to text converter that:

- Removes script and style tags
- Converts headings to properly spaced text
- Converts paragraphs and line breaks
- Converts lists with bullet points
- Removes HTML tags while preserving text
- Decodes HTML entities
- Cleans up excessive whitespace

#### `formatExecutiveOrderText(html: string): string`

Executive order-specific formatter that:

- Calls `htmlToText()` for base conversion
- Adds section separators (━━━━━) for visual structure
- Formats "NOW, THEREFORE" clauses
- Formats signature sections
- Preserves proper executive order structure

**Usage in Frontend**:

```tsx
import { formatExecutiveOrderText } from "@/lib/utils/html-to-text";

// In component:
{
  formatExecutiveOrderText(executiveOrder.fullText);
}
```

### 4. Updated Detail Page

**File**: `src/app/bills/eo/[id]/page.tsx`

**Changes**:

- Imports `formatExecutiveOrderText` utility
- Applies formatting to full text before display
- Uses monospace font for better readability
- Maintains proper whitespace with `whitespace-pre-wrap`

**Display Style**:

```tsx
<div className="prose max-w-none whitespace-pre-wrap font-mono text-sm leading-relaxed">
  {formatExecutiveOrderText(executiveOrder.fullText)}
</div>
```

## Data Flow

```
1. Initial Fetch (without full text)
   └─> fetch-executive-orders.ts (FETCH_TEXT=false)
       └─> Database: 100 EOs with fullText: null

2. Full Text Population
   └─> update-eo-full-text.ts
       └─> Extracts document number from federalRegisterUrl
       └─> Calls fetchExecutiveOrderFullText(documentNumber)
       └─> Federal Register API returns HTML content
       └─> Database: 100 EOs with fullText populated (HTML)

3. AI Summarization
   └─> summarize-executive-orders.ts
       └─> Validates fullText exists
       └─> Calls generateSummaryOpenAI() with full text
       └─> GPT-5-nano API processes and returns summary
       └─> Database: Summaries linked to executive orders

4. Frontend Display
   └─> User visits /bills/eo/[id]
       └─> Page fetches EO with fullText (HTML)
       └─> formatExecutiveOrderText() converts HTML to readable text
       └─> Display: Clean, formatted text with proper structure
```

## Package.json Scripts

Added the following npm scripts:

```json
{
  "update-eo-full-text": "tsx scripts/update-eo-full-text.ts",
  "summarize-executive-orders": "tsx scripts/summarize-executive-orders.ts"
}
```

## Federal Register API Integration

### Full Text Endpoint

**Function**: `fetchExecutiveOrderFullText(documentNumber: string)`
**Location**: `src/lib/api/federal-register.ts`

**Process**:

1. Fetches document metadata with URLs: `/documents/{documentNumber}.json`
2. Tries `body_html_url` first (preferred, includes formatting)
3. Falls back to `raw_text_url` if HTML not available
4. Returns HTML content as string

### Document Number Format

- Format: `YYYY-NNNNN` (e.g., "2025-18479")
- Extracted from Federal Register URL pattern: `/documents/YYYY/MM/DD/{document_number}/...`

## Best Practices

### When Fetching New Executive Orders

Always use `FETCH_TEXT=true` for production data:

```bash
FETCH_TEXT=true LIMIT=100 npm run fetch-executive-orders
```

### When Generating Summaries

1. Ensure full text is populated first
2. Use appropriate batch sizes to avoid API rate limits
3. Monitor API costs (GPT-5-nano is cost-effective; Claude available via AI_PROVIDER env var)

### HTML Formatting

- The formatter is designed for Federal Register HTML structure
- Test with new content if Federal Register changes their format
- Consider caching formatted text if performance becomes an issue

## Troubleshooting

### "Full Text: Not fetched"

**Cause**: Executive orders fetched without `FETCH_TEXT=true`
**Solution**: Run `npm run update-eo-full-text`

### "Skipping - no full text available"

**Cause**: Trying to summarize before full text is fetched
**Solution**: Run `npm run update-eo-full-text` first, then summarize

### HTML Tags Showing in Display

**Cause**: Not using `formatExecutiveOrderText()` utility
**Solution**: Import and apply formatter in component

### Rate Limiting Errors

**Cause**: Too many API requests in short time
**Solution**: Script includes 300ms delays; check Federal Register API limits

## Performance Notes

### Full Text Fetching

- **Time**: ~30 seconds per 100 executive orders (with 300ms delay)
- **Size**: Average 15-20KB per executive order
- **API Calls**: 2 calls per EO (metadata + text content)

### Summarization

- **Time**: ~5-10 seconds per executive order (GPT-5-nano API processing)
- **Cost**: Varies based on text length and GPT-5-nano pricing (more cost-effective than Claude)
- **API**: OpenAI GPT-5-nano (default), Anthropic Claude available via AI_PROVIDER=claude

## Future Enhancements

1. **Caching**: Cache formatted text to avoid repeated HTML parsing
2. **Batch Updates**: Automatically update full text during regular fetches
3. **Summary Types**: Support BRIEF, DETAILED, ELI5, KEY_CHANGES
4. **PDF Support**: Some executive orders have PDF versions
5. **Search**: Enable full-text search across executive orders

## Related Documentation

- [Executive Orders Implementation](./EXECUTIVE_ORDERS_IMPLEMENTATION.md)
- [Executive Orders Frontend Integration](./EXECUTIVE_ORDERS_FRONTEND_INTEGRATION.md)
- [AI Summarization System](../src/lib/ai/README.md) (if exists)
