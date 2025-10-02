# Mobile Filter Drawer Implementation

## Problem

On mobile devices, the filter sidebar (categories, status, congress, type) was taking up half the page before users could see any bills. This resulted in:

- Poor mobile UX - excessive scrolling required to reach content
- Filters always visible even when not needed
- Wasted vertical space on small screens
- Categories list pushing bill content far down the page

## Solution

Implemented a responsive design pattern with:

- **Mobile**: Hamburger menu button that opens a slide-out drawer
- **Desktop (lg+)**: Traditional sidebar layout (unchanged)

## Implementation

### 1. Sheet Component (`src/components/ui/sheet.tsx`)

Created a slide-out drawer component using Radix UI Dialog primitive:

**Key Features:**

- Animated slide-in/out transitions
- Backdrop overlay with fade effect
- Configurable side (left, right, top, bottom)
- Accessible with focus management
- Close button and ESC key support
- Touch-friendly on mobile

**Configuration:**

- Mobile: 75% width (w-3/4) with max 400px on larger mobiles
- Slide from left side for natural UX
- Smooth 300ms transition duration
- Z-index 50 to overlay content

### 2. Mobile Filter Drawer (`src/components/search/MobileFilterDrawer.tsx`)

Wrapper component that combines Sheet with FilterPanel:

```tsx
export function MobileFilterDrawer({ categories }: MobileFilterDrawerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="w-full lg:hidden">
          <Filter className="mr-2 h-4 w-4" />
          Filters & Categories
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[300px] sm:w-[400px] overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>
        <div className="mt-6">
          <FilterPanel categories={categories} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

**Key Decisions:**

- `lg:hidden` - Only show on mobile/tablet (< 1024px)
- `w-full` button - Full width for easy tapping
- `overflow-y-auto` - Scrollable drawer for long category lists
- Reuses existing FilterPanel component (no duplication)

### 3. Bills Page Layout (`src/app/bills/page.tsx`)

Updated to support both mobile and desktop layouts:

```tsx
{/* Mobile Filter Button */}
<div className="mb-4 lg:hidden">
    <MobileFilterDrawer categories={categories} />
</div>

<div className="flex flex-col gap-8 lg:flex-row">
    {/* Sidebar Filters - Desktop Only */}
    <aside className="hidden w-full lg:block lg:w-64 lg:shrink-0">
        <div className="sticky top-4">
            <FilterPanel categories={categories} />
        </div>
    </aside>

    {/* Main Content */}
    <main className="flex-1">
        {/* ... bills list ... */}
    </main>
</div>
```

**Layout Strategy:**

- Mobile (< 1024px):
  - Show filter button above content
  - Hide sidebar with `hidden lg:block`
  - Full-width bill list
  - Drawer opens on button tap
- Desktop (≥ 1024px):
  - Hide mobile button with `lg:hidden`
  - Show sidebar with `hidden lg:block`
  - Traditional two-column layout
  - Sticky sidebar for easy access

## User Experience

### Mobile Flow

1. **Initial View**: User sees search bar and filter button immediately, then bills
2. **Opening Filters**: Tap "Filters & Categories" button
3. **Drawer Slides In**: Smooth left-to-right animation with backdrop
4. **Select Filters**: Full filter panel in scrollable drawer
5. **Auto-Close**: Drawer closes when filter is selected (FilterPanel navigates)
6. **Results Update**: Page reloads with filtered results

### Desktop Flow

No changes - traditional sidebar layout preserved for larger screens.

## Responsive Breakpoints

| Screen Size              | Behavior       | Rationale                               |
| ------------------------ | -------------- | --------------------------------------- |
| < 1024px (mobile/tablet) | Hamburger menu | Maximize vertical space for content     |
| ≥ 1024px (desktop)       | Sidebar        | Sufficient horizontal space for sidebar |

## Technical Details

### Dependencies

- `@radix-ui/react-dialog` (already installed)
- `lucide-react` for Filter icon
- Tailwind CSS for responsive classes

### State Management

- Local state in MobileFilterDrawer for open/close
- URL state in FilterPanel for active filters (unchanged)
- No global state needed

### Animations

- Drawer: `slide-in-from-left` / `slide-out-to-left`
- Backdrop: `fade-in-0` / `fade-out-0`
- Duration: 300ms for smooth transitions

### Accessibility

- ✅ Keyboard navigation (ESC to close, Tab through filters)
- ✅ Focus trap in drawer when open
- ✅ Screen reader labels ("Close" button, "Filters" title)
- ✅ ARIA attributes from Radix UI primitives
- ✅ Touch-friendly button size (full width, adequate padding)

## Performance

- **No Re-renders**: FilterPanel only rendered when drawer opens
- **Lazy Sheet**: Sheet content only mounts when triggered
- **Same Logic**: Reuses FilterPanel component (no code duplication)
- **No Extra Requests**: Filter logic unchanged, same URL-based routing

## Testing

### Mobile Testing (< 1024px)

1. **Button Visibility**:

   - [ ] Filter button appears below search bar
   - [ ] Button spans full width
   - [ ] Filter icon visible with text

2. **Drawer Behavior**:

   - [ ] Tap button opens drawer from left
   - [ ] Backdrop appears with fade
   - [ ] Drawer slides smoothly (300ms)
   - [ ] Content scrolls if needed

3. **Filter Interaction**:

   - [ ] All filters work (Type, Congress, Status, Categories)
   - [ ] Selecting filter closes drawer and updates results
   - [ ] Clear filters button works
   - [ ] Back button on browser works correctly

4. **Close Behavior**:
   - [ ] Tap backdrop closes drawer
   - [ ] X button closes drawer
   - [ ] ESC key closes drawer
   - [ ] Filter selection auto-closes drawer

### Desktop Testing (≥ 1024px)

1. **Layout Unchanged**:

   - [ ] Filter button hidden
   - [ ] Sidebar visible
   - [ ] Sidebar sticky on scroll
   - [ ] Two-column layout maintained

2. **Functionality**:
   - [ ] All existing filter behavior works
   - [ ] No regression in desktop UX

### Cross-Browser

- [ ] Chrome/Edge (Chromium)
- [ ] Safari (WebKit)
- [ ] Firefox (Gecko)
- [ ] Mobile Safari (iOS)
- [ ] Chrome Mobile (Android)

## Before vs After

### Mobile (< 1024px)

**Before:**

```
┌─────────────────────────┐
│ Header                  │
│ Search Bar              │
├─────────────────────────┤
│ Filters                 │ ← Takes up ~40-50%
│ • Type                  │    of viewport
│ • Congress              │
│ • Status                │
│ • Categories (15 items) │
│   - Agriculture         │
│   - Civil Rights        │
│   - Defense             │
│   - Economy             │
│   ... (scrolling)       │
├─────────────────────────┤
│ Bill 1                  │ ← Finally content!
│ Bill 2                  │
└─────────────────────────┘
```

**After:**

```
┌─────────────────────────┐
│ Header                  │
│ Search Bar              │
│ [🔍 Filters & Categories]│ ← Compact button
├─────────────────────────┤
│ Bill 1                  │ ← Content starts here!
│ Bill 2                  │
│ Bill 3                  │
│ Bill 4                  │
│ ...                     │
└─────────────────────────┘

Tap button → Drawer slides in:
┌────────┬────────────────┐
│Filters │                │
│        │ Bill content   │
│• Type  │ (dimmed)       │
│• Congr │                │
│• Status│                │
│• Categ │                │
│  ...   │                │
└────────┴────────────────┘
```

### Desktop (≥ 1024px)

No changes - traditional sidebar layout maintained.

## Future Enhancements

1. **Active Filter Indicators**: Show count badge on mobile button (e.g., "Filters (3)")
2. **Quick Filters**: Add common filter chips above bill list
3. **Saved Filters**: Allow users to save favorite filter combinations
4. **Filter Presets**: "New Bills", "Recently Updated", "Popular Bills"
5. **Swipe Gestures**: Swipe from left edge to open drawer
6. **Bottom Sheet Option**: Consider bottom sheet on very small screens

## Related Files

- `src/components/ui/sheet.tsx` - Slide-out drawer component
- `src/components/search/MobileFilterDrawer.tsx` - Mobile filter wrapper
- `src/components/search/FilterPanel.tsx` - Shared filter logic (unchanged)
- `src/app/bills/page.tsx` - Bills list page layout

## Related Documentation

- [Mobile Responsive Fixes](./MOBILE_RESPONSIVE_FIXES.md) - General mobile improvements
- [Content Availability Badges](./CONTENT_AVAILABILITY_BADGES.md) - Mobile-friendly badges
