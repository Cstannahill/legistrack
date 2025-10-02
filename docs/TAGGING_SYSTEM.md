# Legislative Tagging System

## Overview

The tagging system automatically categorizes bills and executive orders using AI analysis, making it easier to browse, filter, and understand legislation by topic area.

## Features

- ✅ **AI-Powered Classification**: Uses GPT-5-nano to analyze content and assign relevant categories
- ✅ **20 Predefined Categories**: Comprehensive coverage of policy areas
- ✅ **Multi-Category Support**: Each item can have 1-4 categories
- ✅ **Confidence Scoring**: AI provides confidence levels for each categorization
- ✅ **Batch Processing**: Process multiple items efficiently
- ✅ **Fallback Logic**: Handles errors gracefully with default categorization

## Available Categories

| Category                            | Description                                                                  | Color   |
| ----------------------------------- | ---------------------------------------------------------------------------- | ------- |
| **Healthcare**                      | Healthcare policy, medical services, insurance, and public health            | Red     |
| **Education**                       | Schools, colleges, student aid, and educational policy                       | Amber   |
| **Defense & National Security**     | Military, homeland security, intelligence, and defense policy                | Purple  |
| **Economy & Jobs**                  | Employment, labor policy, economic development, and workforce                | Green   |
| **Environment & Energy**            | Climate change, renewable energy, conservation, and environmental protection | Teal    |
| **Immigration**                     | Border security, visa policy, citizenship, and immigration reform            | Indigo  |
| **Tax & Budget**                    | Taxation, federal budget, appropriations, and fiscal policy                  | Pink    |
| **Transportation & Infrastructure** | Roads, bridges, public transit, and infrastructure development               | Blue    |
| **Criminal Justice**                | Law enforcement, criminal law, corrections, and justice reform               | Red     |
| **Civil Rights & Liberties**        | Constitutional rights, voting rights, discrimination, and civil liberties    | Purple  |
| **Technology & Telecommunications** | Internet policy, data privacy, telecom regulation, and tech innovation       | Cyan    |
| **Agriculture & Food**              | Farming, food safety, agricultural policy, and rural development             | Lime    |
| **Housing & Urban Development**     | Affordable housing, urban planning, and community development                | Orange  |
| **Trade & Commerce**                | International trade, tariffs, trade agreements, and business regulation      | Sky     |
| **Veterans Affairs**                | VA benefits, military veterans, and veteran services                         | Red     |
| **Social Services & Welfare**       | Social security, welfare programs, and social safety net                     | Purple  |
| **Foreign Policy & Diplomacy**      | International relations, diplomacy, and foreign affairs                      | Indigo  |
| **Financial Services**              | Banking, securities, financial regulation, and consumer finance              | Emerald |
| **Science & Research**              | Scientific research, R&D funding, and innovation policy                      | Purple  |
| **Government Operations**           | Federal operations, civil service, and government reform                     | Gray    |

## Usage

### Tag Both Bills and Executive Orders (Default)

```bash
npm run tag-legislation
```

### Tag Only Bills

```bash
npm run tag-bills
```

### Tag Only Executive Orders

```bash
npm run tag-executive-orders
```

### Custom Batch Size

```bash
# Process 20 items at a time
BATCH_SIZE=20 npm run tag-legislation

# Process 50 bills
BATCH_SIZE=50 npm run tag-bills
```

### Switch AI Provider

```bash
# Use Claude instead of GPT-5-nano
AI_PROVIDER=claude npm run tag-legislation
```

## How It Works

### 1. Category Setup

The script first ensures all predefined categories exist in the database. If they don't exist, they're automatically created with:

- Name and slug (URL-friendly identifier)
- Description (for AI context)
- Color (for UI display)
- Icon (for visual representation)

### 2. Item Selection

The script queries the database for:

- Bills or Executive Orders **without any categories**
- Ordered by date (most recent first)
- Limited by `BATCH_SIZE` (default: 10)

### 3. AI Analysis

For each item, the AI analyzes:

- **Title**: Primary source of categorization
- **Full Text**: If available, provides deeper context (first 5000 characters)
- **Available Categories**: All predefined categories with descriptions

The AI returns:

```json
{
  "categories": ["healthcare", "social-services-welfare"],
  "reasoning": "This bill addresses Medicare benefits and social security, making healthcare and social services the most relevant categories.",
  "confidence": 0.85
}
```

### 4. Category Assignment

The script:

1. Validates that returned categories exist
2. Fetches category IDs from the database
3. Creates relationships between the item and categories
4. Logs the results with confidence scores

### 5. Rate Limiting

To avoid API rate limits:

- 500ms delay between each item
- Configurable batch sizes
- Error handling with fallback

## Example Output

```
🏷️  Legislative Tagging System
📦 Batch Size: 10 items
🧠 AI Provider: GPT-5-nano
📋 Item Type: both

============================================================

📚 Ensuring predefined categories exist...

   ✅ Created category: Healthcare
   ✅ Created category: Education
   ... (all categories)

✓ All categories ready

🏛️  Tagging Bills

   ✓ Found 10 bills to tag

📄 Processing: HR 4398
   Title: Veterans Comprehensive Opioid Treatment Act of 2025...
   🤖 Analyzing with AI...
   📊 Confidence: 92%
   🏷️  Categories: veterans-affairs, healthcare
   💭 Reasoning: Focuses on VA opioid treatment programs, combining veteran services and healthcare
   ✅ Tagged successfully

📄 Processing: S 2309
   Title: Clean Energy Innovation Act...
   🤖 Analyzing with AI...
   📊 Confidence: 88%
   🏷️  Categories: environment-energy, science-research
   💭 Reasoning: Addresses renewable energy research and development
   ✅ Tagged successfully

... (more bills)

============================================================
📊 SUMMARY
============================================================
✅ Successfully tagged: 10
❌ Failed: 0
📝 Total processed: 10

✅ Tagging complete!
```

## Database Schema

The tagging system uses the existing schema:

```prisma
model Category {
  id          String   @id @default(cuid())
  name        String   @unique
  slug        String   @unique
  description String?  @db.Text
  color       String?
  icon        String?

  bills             Bill[]           @relation("BillCategories")
  executiveOrders   ExecutiveOrder[] @relation("ExecutiveOrderCategories")

  // Optional hierarchy support
  parentId    String?
  parent      Category?  @relation("CategoryHierarchy", fields: [parentId], references: [id])
  children    Category[] @relation("CategoryHierarchy")
}
```

## Frontend Integration

### Display Categories on Bill/EO Cards

```tsx
// In BillCard.tsx or ExecutiveOrderCard.tsx
<div className="flex flex-wrap gap-2">
  {bill.categories.map((category) => (
    <Badge key={category.id} style={{ backgroundColor: category.color }}>
      {category.name}
    </Badge>
  ))}
</div>
```

### Filter by Category

```tsx
// In FilterPanel.tsx
<Select onValueChange={handleCategoryFilter}>
  <SelectTrigger>
    <SelectValue placeholder="Filter by category" />
  </SelectTrigger>
  <SelectContent>
    {categories.map((category) => (
      <SelectItem key={category.slug} value={category.slug}>
        {category.name}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

### Update API Endpoint

```typescript
// In app/api/bills/route.ts
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const categorySlug = searchParams.get("category");

  const bills = await db.bill.findMany({
    where: categorySlug
      ? {
          categories: {
            some: {
              slug: categorySlug,
            },
          },
        }
      : undefined,
    include: {
      categories: true, // Include categories in response
    },
  });

  return Response.json(bills);
}
```

## Best Practices

### When to Run Tagging

1. **After Fetching New Bills/EOs**: Automatically tag new legislation
2. **During Database Seeding**: Tag existing untagged items
3. **Periodic Updates**: Re-tag items if categories change
4. **Manual Corrections**: Run specific batches for quality control

### Optimal Batch Sizes

- **Small batches (5-10)**: For testing or quick updates
- **Medium batches (20-30)**: Standard processing
- **Large batches (50+)**: Bulk processing (watch API limits)

### Cost Optimization

- Tag items with full text for better accuracy
- Start with small batches to test quality
- Monitor AI costs per item
- Consider caching frequently categorized patterns

## Troubleshooting

### Categories Not Appearing

**Symptom**: Script runs but categories aren't assigned

**Solution**:

1. Check that categories exist: `npx prisma studio`
2. Verify relationships in schema
3. Check console output for error messages

### AI Returns Invalid Categories

**Symptom**: Script fails with "Category not found"

**Solution**:

1. Review AI prompt in `tag-legislation.ts`
2. Ensure category slugs match exactly
3. Check for typos in category names

### Rate Limiting Errors

**Symptom**: "Too many requests" errors

**Solution**:

```bash
# Reduce batch size
BATCH_SIZE=5 npm run tag-legislation

# Or increase delay in script (line with setTimeout)
```

### Low Confidence Scores

**Symptom**: AI assigns categories with <50% confidence

**Solution**:

1. Ensure items have full text populated
2. Review category descriptions for clarity
3. Consider adding more specific categories

## Future Enhancements

- [ ] **Hierarchical Categories**: Parent/child category relationships
- [ ] **User Feedback**: Allow users to suggest category changes
- [ ] **Machine Learning**: Train on user corrections
- [ ] **Custom Categories**: Allow organizations to add their own
- [ ] **Multi-Language**: Support for international legislation
- [ ] **Category Analytics**: Track which categories are most common
- [ ] **Auto-Retagging**: Automatically retag when full text is added

## API Costs

### GPT-5-nano (Default)

- **Cost per item**: ~$0.001-0.003
- **Batch of 100**: ~$0.10-0.30
- **1000 items**: ~$1-3

### Claude (Alternative)

- **Cost per item**: ~$0.003-0.005
- **Batch of 100**: ~$0.30-0.50
- **1000 items**: ~$3-5

## Related Documentation

- [AI Summarization](./SINGLE_BILL_GENERATION.md)
- [Executive Orders Setup](./EXECUTIVE_ORDERS_IMPLEMENTATION.md)
- [Database Schema](../prisma/schema.prisma)
- [Bill Fetching](./PAGINATION_GUIDE.md)
