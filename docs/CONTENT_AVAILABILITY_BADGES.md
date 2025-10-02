# Content Availability Badges

## Problem

On the bills list page, users could not easily distinguish which bills had been fully processed with AI summaries and full legislative text versus those still awaiting processing. This made it difficult to:

- Identify bills with complete information at a glance
- Understand the processing status of legislation
- Prioritize which bills to view based on available content
- Track data completeness across the collection

## Solution

Added visual availability badges to both bill cards and executive order cards on the list page. These badges indicate the presence of AI-generated summaries and full legislative text.

## Implementation

### Badge Types

**AI Summary Badge** (Blue)

- **Icon**: Sparkles (✨)
- **Color**: Blue (bg-blue-100/text-blue-800)
- **Condition**: Displayed when `summaries.length > 0`
- **Label**: "Summary"
- **Purpose**: Indicates AI-generated summary is available

**Full Text Badge** (Green)

- **Icon**: FileText (📄)
- **Color**: Green (bg-green-100/text-green-800)
- **Condition**: Displayed when `fullText` exists
- **Label**: "Full Text"
- **Purpose**: Indicates complete legislative text is available

### Visual Design

The badges appear below the bill/order identifier in the card header:

```
┌─────────────────────────────────────┐
│ HR 1234    119th Congress    Active │
│ Title of the Bill                   │
│                                     │
│ [✨ Summary] [📄 Full Text]        │  ← Availability Indicators
│                                     │
│ Brief summary text...               │
└─────────────────────────────────────┘
```

### Technical Details

**Database Queries** (`src/app/bills/page.tsx`)

```typescript
// Bills query now explicitly selects fullText
const [bills, totalCount] = await Promise.all([
  prisma.bill.findMany({
    select: {
      id: true,
      billType: true,
      billNumber: true,
      congress: true,
      title: true,
      currentStatus: true,
      introducedDate: true,
      fullText: true, // ← Added for badges
      sponsor: {
        select: {
          fullName: true,
          party: true,
          state: true,
        },
      },
      categories: {
        select: {
          id: true,
          name: true,
          slug: true,
          color: true,
        },
      },
      summaries: {
        select: {
          content: true,
        },
      },
      companionBills: {
        select: {
          companionBill: {
            select: {
              id: true,
              billType: true,
              billNumber: true,
              congress: true,
            },
          },
        },
      },
    },
    // ... rest of query
  }),
]);
```

**Type Definitions** (`src/components/bills/BillList.tsx`)

```typescript
interface BillItem {
  id: string;
  billType: string;
  billNumber: number;
  congress: number;
  title: string;
  currentStatus: string;
  introducedDate: Date | string;
  fullText?: string | null; // ← Added for badges
  // ... rest of properties
}
```

**Badge Rendering** (`src/components/bills/BillCard.tsx`)

```typescript
export function BillCard({ bill }: BillCardProps) {
  const hasSummary = !!bill.summaries?.[0]?.content;
  const hasFullText = !!bill.fullText;

  return (
    <Card>
      <CardHeader>
        {/* ... bill identifier and title ... */}

        {/* Availability Indicators */}
        {(hasSummary || hasFullText) && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {hasSummary && (
              <Badge
                variant="secondary"
                className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs"
              >
                <Sparkles className="mr-1 h-3 w-3" />
                Summary
              </Badge>
            )}
            {hasFullText && (
              <Badge
                variant="secondary"
                className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs"
              >
                <FileText className="mr-1 h-3 w-3" />
                Full Text
              </Badge>
            )}
          </div>
        )}
      </CardHeader>
      {/* ... rest of card content ... */}
    </Card>
  );
}
```

### Components Updated

1. **BillCard** (`src/components/bills/BillCard.tsx`)

   - Added `fullText` to interface
   - Added availability indicators section
   - Imported `FileText` and `Sparkles` icons

2. **ExecutiveOrderCard** (`src/components/bills/ExecutiveOrderCard.tsx`)

   - Added `fullText` to interface
   - Added availability indicators section
   - Imported `FileText` and `Sparkles` icons

3. **BillList** (`src/components/bills/BillList.tsx`)

   - Added `fullText` to `BillItem` type
   - Added `fullText` to `ExecutiveOrderItem` type

4. **Bills Page** (`src/app/bills/page.tsx`)
   - Updated query to explicitly select `fullText`
   - Applied to both bills and executive orders queries

## User Experience

### Benefits

1. **Quick Scanning**: Users can immediately identify which legislation has been fully processed
2. **Informed Decisions**: Users know what content is available before clicking into a bill
3. **Processing Status**: Visual feedback on the state of data collection
4. **Reduced Clicks**: Users can prioritize bills with complete information

### Badge States

| Badge State      | Meaning                                                                             |
| ---------------- | ----------------------------------------------------------------------------------- |
| No badges        | Bill/order has neither summary nor full text (recently added or pending processing) |
| Blue badge only  | AI summary generated, but full text not yet available                               |
| Green badge only | Full text available, but AI summary not yet generated                               |
| Both badges      | Complete information available (ideal state)                                        |

## Performance Considerations

- **Query Optimization**: Uses explicit `select` rather than `include` to minimize data transfer
- **Conditional Rendering**: Badges only render when content exists, avoiding empty sections
- **Responsive Design**: Badges wrap naturally on smaller screens with `flex-wrap`

## Future Enhancements

Potential improvements for this feature:

1. **Filter by Availability**: Add filter options to show only bills with summaries/full text
2. **Tooltip Explanations**: Add hover tooltips explaining what each badge means
3. **Processing Indicators**: Show "Processing..." badge for bills currently being analyzed
4. **Date Information**: Display when summary was generated or full text was fetched
5. **Click Actions**: Make badges clickable to jump directly to that content section
6. **Stats Dashboard**: Show overall statistics (e.g., "85% of bills have summaries")

## Testing

To test the badges:

1. **View Bills List**: Navigate to `/bills`
2. **Verify Badge Display**:

   - Bills with summaries should show blue "Summary" badge
   - Bills with full text should show green "Full Text" badge
   - Bills with both should show both badges
   - Bills with neither should show no badges

3. **Test Responsive Behavior**:

   - Resize browser window
   - Verify badges wrap appropriately on smaller screens
   - Check dark mode appearance

4. **Test Executive Orders**: Navigate to executive orders section and verify same behavior

## Related Files

- `src/components/bills/BillCard.tsx` - Bill card with badges
- `src/components/bills/ExecutiveOrderCard.tsx` - Executive order card with badges
- `src/components/bills/BillList.tsx` - Type definitions
- `src/app/bills/page.tsx` - Database queries
- `src/components/ui/badge.tsx` - Badge component (shadcn/ui)

## Related Documentation

- [Search Performance Optimization](./SEARCH_PERFORMANCE_OPTIMIZATION.md) - Query optimization that made this feature possible
- [Summary Section Enhancement](./SUMMARY_SECTION_ENHANCEMENT.md) - Related UI improvements for summary display
