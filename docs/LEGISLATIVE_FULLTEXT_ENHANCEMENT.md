# Legislative Full Text Enhancement

**Date:** October 2, 2025  
**Status:** ✅ Completed  
**Impact:** Cleaner, more readable legislative text display with better structure

## Problem Statement

Legislative full text from Congress.gov contained:

1. **HTML entities** - `&lt;DOC&gt;` and `&lt;all&gt;` instead of proper tags
2. **Marker tags** - `<DOC>` and `<all>` markers with excessive whitespace
3. **Poor formatting** - Large blocks of monospace text without structure
4. **Low readability** - No visual hierarchy or separation of sections

### Example Before

```plaintext
[Congressional Bills 119th Congress]
[From the U.S. Government Publishing Office]
[H. Con. Res. 49 Introduced in House (IH)]

&lt;DOC&gt;






119th CONGRESS
  1st Session
H. CON. RES. 49
...
&lt;all&gt;
```

## Solution Overview

Created a two-part solution:

1. **Utility functions** to clean and parse legislative text
2. **React component** to display structured, styled text

## Implementation

### 1. Text Cleaning Utilities (`src/lib/utils/legislation-text.ts`)

#### `cleanLegislativeText(text: string)`

Cleans legislative text by:

- Decoding HTML entities (`&lt;` → `<`, `&gt;` → `>`, `&amp;` → `&`)
- Removing `<DOC>` and `<all>` markers
- Reducing excessive blank lines (3+ newlines → 2 newlines)
- Trimming leading/trailing whitespace

**Usage:**

```typescript
const cleaned = cleanLegislativeText(rawText);
// "&lt;DOC&gt;\n\n\n\nBill text"
// becomes
// "Bill text"
```

#### `parseLegislativeText(text: string)`

Intelligently parses legislative text into structured sections:

**Returns:**

```typescript
{
  header: string | null; // GPO header (Congressional Bills 119th...)
  billInfo: string | null; // Congress session, bill number, title
  title: string | null; // Extracted bill title
  content: string; // Main legislative text
}
```

**Logic:**

1. Identifies GPO header section (starts with `[Congressional Bills...`)
2. Extracts Congress session and bill info (e.g., "119th CONGRESS")
3. Finds divider before main content ("IN THE HOUSE OF REPRESENTATIVES")
4. Separates structured metadata from legislative prose

**Example:**

```typescript
const parsed = parseLegislativeText(rawText);

// parsed.header:
// "[Congressional Bills 119th Congress]
//  [From the U.S. Government Publishing Office]
//  [H. Con. Res. 49 Introduced in House (IH)]"

// parsed.billInfo:
// "119th CONGRESS
//   1st Session
// H. CON. RES. 49
//
// Expressing the sense of Congress..."

// parsed.content:
// "IN THE HOUSE OF REPRESENTATIVES
//  September 19, 2025
//  Mr. Thompson of Pennsylvania..."
```

### 2. Display Component (`src/components/bills/LegislativeFullText.tsx`)

React component that renders legislative text with visual structure:

#### Features

**Header Information Card** (if available)

- Gray/slate themed card with left border accent
- Building icon for GPO header metadata
- FileText icon for bill information
- Monospace font for official formatting
- Extracted title displayed prominently

**Main Legislative Text Card**

- Clean white/dark card with proper padding
- Monospace font preserving original formatting
- Prose typography for readability
- Pre-wrapped text maintaining line breaks

**Footer Note**

- Small metadata indicator
- Shows bill identifier

#### Component API

```typescript
<LegislativeFullText
  text={string} // Raw legislative text
  billIdentifier={string} // e.g., "HR 5370", "SRES 427"
/>
```

#### Visual Structure

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ 🏛 HEADER INFORMATION CARD         ┃ (Gray accent)
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ [Congressional Bills 119th Congress]┃
┃ [From GPO]                          ┃
┃ [H. Con. Res. 49 IH]                ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 📄 119th CONGRESS                   ┃
┃    1st Session                      ┃
┃    H. CON. RES. 49                  ┃
┃                                     ┃
┃    Expressing the sense of...      ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ MAIN LEGISLATIVE TEXT CARD          ┃ (White/dark)
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ IN THE HOUSE OF REPRESENTATIVES     ┃
┃                                     ┃
┃ September 19, 2025                  ┃
┃                                     ┃
┃ Mr. Thompson of Pennsylvania...    ┃
┃ [Full legislative text...]          ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

📄 Official legislative text for H. CON. RES. 49
```

### 3. Updated Pages

#### Bill Detail Page (`src/app/bills/[id]/page.tsx`)

```tsx
{/* Before */}
<CardContent>
  {bill.fullText ? (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <pre className="whitespace-pre-wrap rounded-lg bg-muted p-4 text-sm">
        {bill.fullText}
      </pre>
    </div>
  ) : ...}
</CardContent>

{/* After */}
{bill.fullText ? (
  <LegislativeFullText
    text={bill.fullText}
    billIdentifier={billIdentifier}
  />
) : ...}
```

#### Executive Order Detail Page (`src/app/bills/eo/[id]/page.tsx`)

```tsx
{executiveOrder.fullText ? (
  <LegislativeFullText
    text={formatExecutiveOrderText(executiveOrder.fullText)}
    billIdentifier={`EO ${executiveOrder.orderNumber}`}
  />
) : ...}
```

## Before & After Comparison

### Before

- Raw text dump with HTML entities
- `<DOC>` and `<all>` markers visible
- 5+ consecutive blank lines
- No visual hierarchy
- Everything in one gray box
- Hard to identify official metadata vs. content

### After

- Clean, decoded text
- Markers removed automatically
- Reasonable spacing (max 2 blank lines)
- Clear visual sections with cards
- Header metadata separated and styled
- Bill info prominently displayed with icons
- Professional, government-document aesthetic

## Benefits

1. **Improved Readability**

   - Structured sections easier to scan
   - Visual hierarchy guides the eye
   - Icons provide context at a glance

2. **Cleaner Display**

   - HTML entities decoded
   - Marker tags removed
   - Excessive whitespace normalized

3. **Better UX**

   - Professional appearance
   - Consistent with other legislative sites
   - Clear separation of metadata vs. content

4. **Maintainability**

   - Reusable utility functions
   - Single component for all full text display
   - Easy to enhance further

5. **Accessibility**
   - Semantic HTML structure
   - Proper heading hierarchy
   - Icon + text labels

## Technical Details

### HTML Entity Decoding

```typescript
text
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&nbsp;/g, " ");
```

### Marker Removal

```typescript
text
  .replace(/<DOC>\s*/g, "") // Remove <DOC> with trailing whitespace
  .replace(/\s*<all>/g, ""); // Remove <all> with leading whitespace
```

### Whitespace Normalization

```typescript
text.replace(/\n{3,}/g, "\n\n"); // 3+ newlines → 2 newlines
```

### Section Parsing

1. Scan for `[Congressional Bills...` pattern
2. Look for status markers like `[IH]`, `[ATS]`, etc.
3. Find congress session header (`119th CONGRESS`)
4. Identify chamber marker (`IN THE HOUSE OF REPRESENTATIVES`)
5. Extract sections based on identified boundaries

## Future Enhancements

### Short-term

1. **Copy to Clipboard** - Add button to copy cleaned text
2. **Print Optimization** - Ensure proper page breaks
3. **Section Navigation** - Jump to Whereas clauses, Resolved sections
4. **Search within Text** - Find terms in full text

### Medium-term

5. **Syntax Highlighting** - Highlight legal keywords (Whereas, Resolved, Section)
6. **Collapsible Sections** - Fold/unfold Whereas clauses
7. **Line Numbers** - Optional line numbering for reference
8. **Version Comparison** - Show diffs between bill versions

### Long-term

9. **PDF Export** - Generate formatted PDF with proper styling
10. **Citation Generator** - One-click citation in various formats
11. **Annotate Text** - User highlighting and notes
12. **Cross-references** - Link to referenced bills/statutes

## Testing Recommendations

### Manual Testing

- [ ] View bill with full text (HR, S, SRES, HCONRES)
- [ ] Verify `<DOC>` and `<all>` markers removed
- [ ] Check HTML entities decoded properly
- [ ] Confirm header card displays metadata
- [ ] Test executive order full text
- [ ] Verify dark mode appearance
- [ ] Check mobile/tablet responsive layout

### Edge Cases

- [ ] Bill with no GPO header
- [ ] Text with only `<all>` marker
- [ ] Very short bills (< 100 characters)
- [ ] Very long bills (> 100KB)
- [ ] Bill with special characters in title
- [ ] Empty fullText field

### Browser Testing

- [ ] Chrome
- [ ] Firefox
- [ ] Safari
- [ ] Edge
- [ ] Mobile Safari
- [ ] Mobile Chrome

## Performance Considerations

### Text Cleaning

- Regex operations are fast (< 1ms for typical bills)
- Parsing algorithm is O(n) where n = number of lines
- No external libraries required

### Component Rendering

- Single render pass
- No re-parsing on updates (text prop stable)
- Minimal DOM nodes (2-3 cards max)

### Memory Usage

- Temporary strings created during cleaning (garbage collected)
- Parsed structure objects are small (< 1KB)
- No state management needed

## Related Files

```
src/
├── lib/
│   └── utils/
│       └── legislation-text.ts     # Text cleaning utilities
├── components/
│   └── bills/
│       └── LegislativeFullText.tsx # Display component
└── app/
    └── bills/
        ├── [id]/
        │   └── page.tsx            # Bill detail (updated)
        └── eo/
            └── [id]/
                └── page.tsx        # EO detail (updated)
```

## Rollback Plan

If issues arise, revert to simple display:

```tsx
<Card>
  <CardContent>
    <pre className="whitespace-pre-wrap font-mono text-sm">{bill.fullText}</pre>
  </CardContent>
</Card>
```

No database changes were made, so rollback is purely frontend.

## Related Documentation

- [Summary Section Enhancement](./SUMMARY_SECTION_ENHANCEMENT.md) - Related UI improvements
- [Search Performance Optimization](./SEARCH_PERFORMANCE_OPTIMIZATION.md) - Query optimizations

## Conclusion

This enhancement transforms raw legislative text from Congress.gov into a clean, readable, professionally formatted display. By intelligently parsing and structuring the content, we provide users with a better experience for reviewing official legislative documents.

**Key Takeaway:** Small details matter - cleaning HTML entities and removing marker tags might seem minor, but they significantly improve the professional appearance and usability of legislative text display. The structured card layout makes government documents feel more accessible and less intimidating.
