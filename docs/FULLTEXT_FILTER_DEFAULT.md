# Default Full Text Filter Implementation

## Problem

The bills list was displaying all bills in the database, including:

- Newly introduced bills without full text yet
- Bills pending text retrieval from Congress.gov
- Bills with only metadata (title, sponsor, status) but no substantive content

This resulted in:

- Poor user experience - users clicking on bills only to find no content
- Incomplete information - badges showing "Summary" but no actual text to read
- Confusion about which bills are ready to be viewed

## Solution

Implemented a **default filter** to show only bills with full legislative text, with an optional toggle to include incomplete bills.

### Key Changes

1. **Default Behavior**: Only display bills where `fullText IS NOT NULL`
2. **Optional Toggle**: Users can enable "Show Incomplete Bills" to see all bills
3. **Smart Filtering**: Filter only applies to bills, not executive orders (EOs always have content)
4. **URL-Based State**: Toggle state persisted in URL query parameter

## Implementation Details

### 1. Bills Page Query (`src/app/bills/page.tsx`)

**Added `showIncomplete` Parameter:**

```typescript
interface PageProps {
  searchParams: Promise<{
    // ... existing params
    showIncomplete?: string; // 'true' to show bills without fullText
  }>;
}
```

**Default Filter Logic:**

```typescript
const showIncomplete = params.showIncomplete === "true"; // Default: false

// Build where clause for bills
const billWhere: Record<string, unknown> = {};

// By default, only show bills with full text (better UX - complete content)
// Users can toggle to see incomplete bills
if (!showIncomplete && shouldFetchBills) {
  billWhere.fullText = { not: null };
}
```

**How It Works:**

- Default (`showIncomplete` not set): Query includes `fullText: { not: null }`
- Toggled ON (`showIncomplete=true`): No fullText filter, shows all bills
- Only applies when fetching bills (not executive orders)

### 2. Filter Panel UI (`src/components/search/FilterPanel.tsx`)

**Added Switch Component:**

```tsx
import { Switch } from "@/components/ui/switch";

// Track toggle state from URL
const showIncomplete = searchParams.get("showIncomplete") === "true";

// Toggle UI - Only visible for bills (not EOs)
{
  currentType !== "EXECUTIVE_ORDERS" && (
    <div className="rounded-lg border bg-muted/50 p-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <label htmlFor="show-incomplete" className="text-sm font-medium">
            Show Incomplete Bills
          </label>
          <p className="text-xs text-muted-foreground">
            Include bills without full text
          </p>
        </div>
        <Switch
          id="show-incomplete"
          checked={showIncomplete}
          onCheckedChange={(checked) => {
            updateFilter("showIncomplete", checked ? "true" : null);
          }}
        />
      </div>
    </div>
  );
}
```

**Visual Design:**

- Highlighted card with muted background for emphasis
- Label with explanatory subtext
- Switch toggle for on/off state
- Only shown for bills (hidden when viewing executive orders)

**Clear Filters:**
Updated to include toggle state:

```typescript
const hasActiveFilters =
  currentStatus || currentCategory || currentType !== "ALL" || showIncomplete;
```

### 3. Switch Component (`src/components/ui/switch.tsx`)

Added via shadcn/ui:

```bash
npx shadcn@latest add switch
```

Uses `@radix-ui/react-switch` for:

- Accessible toggle control
- Keyboard navigation support
- Focus management
- Smooth animations

## User Experience

### Default Experience (showIncomplete = false)

**User navigates to `/bills`:**

1. Sees only bills with full legislative text
2. Every bill is guaranteed to have substantive content
3. "Full Text" badge visible on all bills
4. Can click any bill and immediately read full text

**Benefits:**

- ✅ Better first impression - all bills have content
- ✅ No disappointed clicks on empty bills
- ✅ Focus on actionable, complete legislation
- ✅ Cleaner list with fewer incomplete items

### With Toggle Enabled (showIncomplete = true)

**User enables "Show Incomplete Bills":**

1. Toggle switch turns on in filter panel
2. URL updates to `/bills?showIncomplete=true`
3. Page reloads showing all bills (including those without text)
4. Bills without full text show only "Summary" badge (if summarized)

**Use Cases:**

- Tracking newly introduced bills
- Monitoring bills before text is available
- Research on bill introduction patterns
- Comprehensive catalog view

## URL Examples

| URL                                            | Behavior                            |
| ---------------------------------------------- | ----------------------------------- |
| `/bills`                                       | Default - only bills with full text |
| `/bills?showIncomplete=true`                   | All bills (including incomplete)    |
| `/bills?type=EXECUTIVE_ORDERS`                 | All EOs (toggle hidden, no filter)  |
| `/bills?congress=118&showIncomplete=true`      | All 118th Congress bills            |
| `/bills?status=Became+Law`                     | Only laws with full text            |
| `/bills?status=Became+Law&showIncomplete=true` | All laws (complete + incomplete)    |

## Logic Table

| Type Filter      | showIncomplete  | fullText Filter Applied | Result                    |
| ---------------- | --------------- | ----------------------- | ------------------------- |
| ALL              | false (default) | ✅ Yes                  | Bills with text + All EOs |
| ALL              | true            | ❌ No                   | All bills + All EOs       |
| BILLS            | false (default) | ✅ Yes                  | Only bills with text      |
| BILLS            | true            | ❌ No                   | All bills                 |
| EXECUTIVE_ORDERS | false (default) | ❌ N/A                  | All EOs (toggle hidden)   |
| EXECUTIVE_ORDERS | true            | ❌ N/A                  | All EOs (toggle hidden)   |

## Database Impact

### Query Without Filter (Old Behavior)

```sql
SELECT * FROM "Bill"
WHERE "congress" = 119
ORDER BY "introducedDate" DESC
LIMIT 20;
```

### Query With Filter (New Default)

```sql
SELECT * FROM "Bill"
WHERE "congress" = 119
  AND "fullText" IS NOT NULL
ORDER BY "introducedDate" DESC
LIMIT 20;
```

**Performance Notes:**

- Uses existing `fullText` column (no new index needed)
- Simple NULL check is very fast
- May reduce result count (fewer bills to paginate)
- No impact on executive orders queries

## Statistics Example

Before filter (example data):

- Total bills in DB: 150
- Bills with fullText: 85
- Bills without fullText: 65

After filter (default view):

- Shown in list: 85 bills (57%)
- Hidden by default: 65 bills (43%)
- User can toggle to see all 150

## Edge Cases Handled

1. **Empty Results**: If no bills have full text yet, shows empty state
2. **Mixed Content**: When `type=ALL`, bills filtered but EOs not affected
3. **Filter Persistence**: Toggle state persists in URL when navigating
4. **Clear Filters**: Clears toggle along with other filters
5. **Status Filter**: Works in combination (e.g., "Became Law" + "has full text")

## Future Enhancements

1. **Show Count**: Display "Showing 85 of 150 bills" with filter indicator
2. **Default Preference**: Allow users to set their default preference
3. **Badge Indicator**: Add "Incomplete" badge to bills without text when toggle is on
4. **Bulk Actions**: "Show only bills missing full text" for admin purposes
5. **Filter Stats**: Show count of incomplete bills in filter panel
6. **Processing Status**: Add badges like "Text Pending", "Processing", "Available"

## Testing

### Manual Testing Steps

1. **Default View (Complete Bills Only)**:

   - [ ] Navigate to `/bills`
   - [ ] Verify all bills have "Full Text" badge
   - [ ] Click any bill - confirm full text is available
   - [ ] Check pagination - all pages show complete bills

2. **Toggle ON (Show Incomplete)**:

   - [ ] Enable "Show Incomplete Bills" toggle
   - [ ] URL updates to include `?showIncomplete=true`
   - [ ] Page shows more bills (if incomplete bills exist)
   - [ ] Some bills may only have "Summary" badge

3. **Toggle OFF**:

   - [ ] Disable toggle
   - [ ] URL removes `showIncomplete` parameter
   - [ ] Returns to showing only complete bills

4. **Clear Filters**:

   - [ ] Enable toggle + set other filters
   - [ ] Click "Clear" button
   - [ ] Toggle resets to OFF
   - [ ] All filters cleared

5. **Executive Orders**:

   - [ ] Switch to type filter "Executive Orders"
   - [ ] Toggle should be hidden (EOs always have content)
   - [ ] All EOs displayed regardless of toggle state

6. **Combined Filters**:
   - [ ] Toggle ON + Status filter
   - [ ] Toggle ON + Category filter
   - [ ] Toggle ON + Congress filter
   - [ ] All combinations work correctly

### Data Verification

Check database to confirm filter works:

```typescript
// Count total bills
await db.bill.count({ where: { congress: 119 } });

// Count bills with full text
await db.bill.count({
  where: {
    congress: 119,
    fullText: { not: null },
  },
});

// Count bills without full text
await db.bill.count({
  where: {
    congress: 119,
    fullText: null,
  },
});
```

## Related Files

- `src/app/bills/page.tsx` - Query logic with fullText filter
- `src/components/search/FilterPanel.tsx` - Toggle UI component
- `src/components/ui/switch.tsx` - Switch component (shadcn)
- `src/components/search/MobileFilterDrawer.tsx` - Mobile filter drawer (includes toggle)

## Related Documentation

- [Content Availability Badges](./CONTENT_AVAILABILITY_BADGES.md) - Visual indicators for content availability
- [Mobile Filter Drawer](./MOBILE_FILTER_DRAWER.md) - Mobile-friendly filter interface
- [Search Performance Optimization](./SEARCH_PERFORMANCE_OPTIMIZATION.md) - Query optimization details
