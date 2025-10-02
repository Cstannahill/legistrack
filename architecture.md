# Legislative Tracker Application - Technical Specification

## Table of Contents

1. [Project Overview](#project-overview)
2. [System Architecture](#system-architecture)
3. [Technology Stack](#technology-stack)
4. [Data Sources](#data-sources)
5. [Database Schema](#database-schema)
6. [Application Structure](#application-structure)
7. [Core Features & Implementation](#core-features--implementation)
8. [API Design](#api-design)
9. [Background Job Processing](#background-job-processing)
10. [AI Summarization Pipeline](#ai-summarization-pipeline)
11. [Deployment Strategy](#deployment-strategy)
12. [Development Roadmap](#development-roadmap)

---

## Project Overview

### Purpose

A web application that automatically tracks, categorizes, and summarizes U.S. federal legislation across all branches of government in plain, understandable language. The system monitors bills, resolutions, executive orders, and regulatory actions, providing citizens with accessible insights into government activity.

### Key Objectives

- **Automated Data Collection**: Continuously fetch legislative data from official government sources
- **Intelligent Categorization**: Automatically classify legislation by topic, impact area, and urgency
- **Plain Language Summaries**: Transform complex legalese into digestible summaries using AI
- **Real-time Updates**: Notify users of status changes and new legislation
- **Search & Filter**: Enable users to find relevant legislation quickly
- **Historical Tracking**: Maintain complete legislative history and voting records

### Target Users

- Citizens wanting to stay informed about government activity
- Advocacy groups tracking specific policy areas
- Journalists researching legislative trends
- Educators teaching civics and government
- Policy analysts conducting research

---

## System Architecture

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                          │
│                      (Next.js Frontend)                         │
│  - Bill Browse/Search  - Category Filters  - User Dashboard     │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                    NEXT.JS API ROUTES                           │
│  - /api/bills       - /api/search      - /api/webhooks          │
│  - /api/categories  - /api/subscriptions                        │
└─────────┬───────────────────────────────┬───────────────────────┘
          │                               │
          │                               │ Trigger Jobs
┌─────────▼───────────┐         ┌────────▼──────────────────────┐
│   PostgreSQL DB     │         │  BACKGROUND JOB PROCESSOR     │
│   (Prisma ORM)      │         │  (Inngest/Trigger.dev/BullMQ) │
│                     │         │                               │
│ - Bills             │◄────────┤ - Legislative Data Fetcher    │
│ - Votes             │         │ - AI Summarization Pipeline   │
│ - Amendments        │         │ - Category Assignment         │
│ - Categories        │         │ - Change Detection            │
│ - Summaries         │         │ - Notification Dispatcher     │
│ - User Subscriptions│         │                               │
└─────────┬───────────┘         └────────┬──────────────────────┘
          │                              │
          │                              │
┌─────────▼─────────────────────────────▼────────────────────────┐
│                    EXTERNAL SERVICES                           │
│                                                                │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Congress.gov│  │ WhiteHouse   │  │  Federal Register API  │ │
│  │     API     │  │  .gov API    │  │                        │ │
│  └─────────────┘  └──────────────┘  └────────────────────────┘ │

│                                                                │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │   OpenAI/   │  │    Redis/    │  │   Email Service        │ │
│  │Claude API   │  │  Vercel KV   │  │   (Resend/SendGrid)    │ │
│  └─────────────┘  └──────────────┘  └────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### Architecture Principles

**Separation of Concerns**

- Frontend: User interface and interaction
- API Layer: Business logic and data validation
- Background Jobs: Heavy processing and external API calls
- Database: Single source of truth for all legislative data

**Scalability**

- Horizontal scaling of Next.js instances
- Independent scaling of background job workers
- Database connection pooling
- Caching layer for frequently accessed data

**Reliability**

- Retry mechanisms for failed API calls
- Dead letter queues for failed jobs
- Data validation at every layer
- Graceful degradation when external services are unavailable

---

## Technology Stack

### Frontend & API Layer

**Next.js 14+ (App Router)**

- **Why**: Full-stack framework with excellent DX, built-in API routes, SSR/ISR capabilities
- **Features Used**:
  - App Router for file-based routing
  - Server Components for optimized initial loads
  - Route Handlers for API endpoints
  - Server Actions for form submissions
  - Built-in caching with `revalidate`

**React 18+**

- **UI Libraries**:
  - Tailwind CSS for styling
  - shadcn/ui for component library
  - Radix UI for accessible primitives
  - Recharts for data visualization

**TypeScript**

- End-to-end type safety
- Better developer experience
- Reduced runtime errors

### Database Layer

**PostgreSQL**

- Relational data with complex relationships
- Full-text search capabilities
- JSON column support for flexible metadata
- Excellent performance at scale

**Prisma ORM**

- Type-safe database queries
- Schema migrations
- Powerful query API
- Built-in connection pooling

**Alternative: Drizzle ORM**

- Lighter weight than Prisma
- More SQL-like syntax
- Better performance for complex queries

### Background Job Processing

**Option 1: Inngest (Recommended for Serverless)**

```typescript
// Pros:
// - Serverless-native
// - Built-in retries, delays, and scheduling
// - Excellent DX with TypeScript
// - Built-in UI for monitoring
// - Free tier available

// Example job definition:
export const fetchNewBills = inngest.createFunction(
  { id: "fetch-new-bills" },
  { cron: "0 */6 * * *" }, // Every 6 hours
  async ({ event, step }) => {
    // Job logic here
  }
);
```

**Option 2: Trigger.dev (Best for Complex Workflows)**

```typescript
// Pros:
// - Long-running tasks (hours)
// - Complex multi-step workflows
// - Built-in error handling
// - Visual workflow builder
// - Generous free tier

// Example workflow:
client.defineJob({
  id: "process-new-legislation",
  name: "Process New Legislation",
  version: "1.0.0",
  trigger: scheduleEvent({ cron: "0 */6 * * *" }),
  run: async (payload, io, ctx) => {
    // Multi-step workflow
  },
});
```

**Option 3: BullMQ + Redis (Self-Hosted)**

```typescript
// Pros:
// - Full control
// - Mature ecosystem
// - Excellent performance
// - Advanced queue features (priority, delayed, repeat)

// Cons:
// - Requires Redis infrastructure
// - More setup/maintenance

// Example queue:
const billQueue = new Queue("bills", { connection: redis });
await billQueue.add("fetch", { source: "congress.gov" });
```

### AI Integration

**Anthropic Claude API (Recommended)**

- Superior at understanding legal text
- Longer context windows (200K tokens)
- More accurate summaries
- Better instruction following

**OpenAI GPT-4**

- Alternative option
- Good at summarization
- Wider adoption
- Function calling capabilities

### Caching & Rate Limiting

**Redis / Vercel KV**

- Cache API responses
- Rate limiting for external APIs
- Session storage
- Real-time features (pub/sub)

### Additional Services

**Email Service**: Resend or SendGrid

- User notifications
- Subscription updates
- Weekly digests

**File Storage**: Vercel Blob or AWS S3

- Store PDF versions of bills
- Archive historical documents

**Monitoring**: Sentry + Vercel Analytics

- Error tracking
- Performance monitoring
- User analytics

---

## Data Sources

### Congress.gov API

**Endpoint**: `https://api.congress.gov/v3/`
**API Key**: Required (free from Library of Congress)

**Available Data**:

- Bills and resolutions
- Bill text and summaries
- Amendments
- Committee information
- Member information
- Votes and roll calls
- Congressional Record

**Example Request**:

```bash
GET https://api.congress.gov/v3/bill/118?api_key=YOUR_KEY
```

**Rate Limits**: 5,000 requests per hour

### Federal Register API

**Endpoint**: `https://www.federalregister.gov/api/v1/`
**API Key**: Not required

**Available Data**:

- Presidential documents (Executive Orders, Proclamations)
- Rules and regulations
- Proposed rules
- Public notices
- Agency information

**Example Request**:

```bash
GET https://www.federalregister.gov/api/v1/documents.json?
    conditions[type][]=PRESDOCU&
    conditions[presidential_document_type][]=executive_order
```

**Rate Limits**: No official limit, but be respectful

### WhiteHouse.gov

**Endpoint**: Web scraping or RSS feeds
**Note**: No official API, requires careful scraping

**Available Data**:

- Presidential statements
- Press briefings
- Executive actions
- Nominations

**Implementation**: Use Cheerio or Puppeteer for scraping

### Supreme Court API (Future Enhancement)

**Endpoint**: `https://api.oyez.org/`
**Available Data**:

- Cases and opinions
- Oral arguments
- Justice information

---

## Database Schema

### Core Tables

```prisma
// schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================
// BILLS & LEGISLATION
// ============================================

model Bill {
  id                String   @id @default(cuid())

  // Official identifiers
  billType          String   // "hr", "s", "hjres", "sjres", etc.
  billNumber        Int
  congress          Int      // e.g., 118

  // Core information
  title             String   @db.Text
  officialTitle     String?  @db.Text
  shortTitle        String?  @db.Text
  introducedDate    DateTime

  // Status tracking
  currentStatus     BillStatus
  statusDate        DateTime
  lawNumber         String?  // e.g., "Public Law 118-1"

  // Content
  fullText          String?  @db.Text
  fullTextUrl       String?

  // Sponsor & cosponsors
  sponsorId         String?
  sponsor           Member?  @relation("Sponsored", fields: [sponsorId], references: [id])
  cosponsors        Member[] @relation("Cosponsored")

  // Relationships
  summaries         Summary[]
  amendments        Amendment[]
  votes             Vote[]
  actions           Action[]
  categories        Category[] @relation("BillCategories")

  // Metadata
  sourceUrl         String?
  lastFetchedAt     DateTime @default(now())
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  // Search optimization
  searchVector      Unsupported("tsvector")?

  @@unique([congress, billType, billNumber])
  @@index([currentStatus])
  @@index([introducedDate])
  @@index([congress])
}

enum BillStatus {
  INTRODUCED
  REFERRED_TO_COMMITTEE
  REPORTED_BY_COMMITTEE
  PASSED_HOUSE
  PASSED_SENATE
  RESOLVING_DIFFERENCES
  PRESENTED_TO_PRESIDENT
  BECAME_LAW
  VETOED
  FAILED
}

// ============================================
// EXECUTIVE ACTIONS
// ============================================

model ExecutiveOrder {
  id                String   @id @default(cuid())

  // Official identifiers
  orderNumber       Int
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
  categories        Category[] @relation("ExecutiveOrderCategories")

  // Metadata
  presidentName     String
  sourceUrl         String?
  lastFetchedAt     DateTime @default(now())
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([orderNumber])
  @@index([signingDate])
}

enum ExecutiveOrderType {
  EXECUTIVE_ORDER
  PRESIDENTIAL_MEMORANDUM
  PROCLAMATION
  DETERMINATION
}

// ============================================
// SUMMARIES (AI-GENERATED)
// ============================================

model Summary {
  id                String   @id @default(cuid())

  // Relations (polymorphic through separate fields)
  billId            String?
  bill              Bill?    @relation(fields: [billId], references: [id])

  executiveOrderId  String?
  executiveOrder    ExecutiveOrder? @relation(fields: [executiveOrderId], references: [id])

  // Summary content
  summaryType       SummaryType
  content           String   @db.Text
  keyPoints         String[] // Array of bullet points
  impactAreas       String[] // Who/what this affects

  // Metadata
  aiModel           String   // "claude-3-opus", "gpt-4", etc.
  confidence        Float?   // 0-1 score
  generatedAt       DateTime @default(now())

  // Quality control
  reviewed          Boolean  @default(false)
  reviewedBy        String?
  reviewedAt        DateTime?

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([billId])
  @@index([executiveOrderId])
}

enum SummaryType {
  BRIEF           // 2-3 sentences
  STANDARD        // 1-2 paragraphs
  DETAILED        // Full analysis
  ELI5            // Explain like I'm 5
  KEY_CHANGES     // What changed from previous version
}

// ============================================
// CATEGORIES & TAGGING
// ============================================

model Category {
  id                String   @id @default(cuid())

  name              String   @unique
  slug              String   @unique
  description       String?  @db.Text

  // Hierarchy
  parentId          String?
  parent            Category?  @relation("CategoryHierarchy", fields: [parentId], references: [id])
  children          Category[] @relation("CategoryHierarchy")

  // Relationships
  bills             Bill[]     @relation("BillCategories")
  executiveOrders   ExecutiveOrder[] @relation("ExecutiveOrderCategories")

  // Metadata
  color             String?    // For UI
  icon              String?    // Icon identifier

  createdAt         DateTime   @default(now())
  updatedAt         DateTime   @updatedAt
}

// ============================================
// MEMBERS OF CONGRESS
// ============================================

model Member {
  id                String   @id @default(cuid())

  // Official identifiers
  bioguideId        String   @unique

  // Personal information
  firstName         String
  lastName          String
  fullName          String

  // Current position
  chamber           Chamber
  state             String   // Two-letter code
  district          Int?     // For House members
  party             String

  // Service dates
  termStart         DateTime
  termEnd           DateTime?

  // Contact & profile
  imageUrl          String?
  websiteUrl        String?

  // Relationships
  sponsoredBills    Bill[]   @relation("Sponsored")
  cosponsoredBills  Bill[]   @relation("Cosponsored")
  votes             Vote[]

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([bioguideId])
}

enum Chamber {
  HOUSE
  SENATE
}

// ============================================
// VOTES
// ============================================

model Vote {
  id                String   @id @default(cuid())

  // Official identifiers
  rollCallNumber    Int
  chamber           Chamber
  congress          Int
  session           Int

  // Vote information
  voteDate          DateTime
  voteQuestion      String   @db.Text
  voteResult        String   // "Passed", "Failed", etc.

  // Vote counts
  yesVotes          Int
  noVotes           Int
  presentVotes      Int
  notVotingCount    Int

  // Relationships
  billId            String?
  bill              Bill?    @relation(fields: [billId], references: [id])

  individualVotes   MemberVote[]

  // Metadata
  sourceUrl         String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([congress, chamber, rollCallNumber])
}

model MemberVote {
  id                String   @id @default(cuid())

  voteId            String
  vote              Vote     @relation(fields: [voteId], references: [id])

  memberId          String
  member            Member   @relation(fields: [memberId], references: [id])

  position          VotePosition

  @@unique([voteId, memberId])
}

enum VotePosition {
  YEA
  NAY
  PRESENT
  NOT_VOTING
}

// ============================================
// AMENDMENTS
// ============================================

model Amendment {
  id                String   @id @default(cuid())

  // Official identifiers
  amendmentNumber   String
  amendmentType     String
  congress          Int

  // Core information
  purpose           String?  @db.Text
  description       String?  @db.Text

  // Status
  status            String
  statusDate        DateTime?

  // Relationships
  billId            String
  bill              Bill     @relation(fields: [billId], references: [id])

  // Sponsor
  sponsorId         String?

  // Metadata
  proposedDate      DateTime
  sourceUrl         String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([congress, amendmentType, amendmentNumber])
}

// ============================================
// ACTIONS & HISTORY
// ============================================

model Action {
  id                String   @id @default(cuid())

  billId            String
  bill              Bill     @relation(fields: [billId], references: [id])

  actionDate        DateTime
  actionCode        String?
  actionType        String
  text              String   @db.Text

  createdAt         DateTime @default(now())

  @@index([billId, actionDate])
}

// ============================================
// USER MANAGEMENT & SUBSCRIPTIONS
// ============================================

model User {
  id                String   @id @default(cuid())

  email             String   @unique
  name              String?

  // Preferences
  emailVerified     Boolean  @default(false)
  notificationPreferences Json?

  // Subscriptions
  subscriptions     Subscription[]

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model Subscription {
  id                String   @id @default(cuid())

  userId            String
  user              User     @relation(fields: [userId], references: [id])

  // What to subscribe to
  subscriptionType  SubscriptionType

  // Specific filters
  categoryIds       String[] // Subscribe to specific categories
  keywords          String[] // Subscribe to bills with keywords
  memberIds         String[] // Follow specific members

  // Notification settings
  frequency         NotificationFrequency
  active            Boolean  @default(true)

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([userId])
}

enum SubscriptionType {
  ALL_BILLS
  SPECIFIC_CATEGORIES
  KEYWORD_MATCH
  MEMBER_ACTIVITY
  EXECUTIVE_ORDERS
}

enum NotificationFrequency {
  INSTANT
  DAILY_DIGEST
  WEEKLY_DIGEST
}

// ============================================
// JOB TRACKING
// ============================================

model JobRun {
  id                String   @id @default(cuid())

  jobName           String
  status            JobStatus

  startedAt         DateTime @default(now())
  completedAt       DateTime?

  itemsProcessed    Int      @default(0)
  itemsFailed       Int      @default(0)

  error             String?  @db.Text
  metadata          Json?

  @@index([jobName, startedAt])
}

enum JobStatus {
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}
```

### Database Indexes Strategy

```sql
-- Full-text search on bills
CREATE INDEX bill_search_idx ON "Bill"
  USING gin(to_tsvector('english', title || ' ' || COALESCE(full_text, '')));

-- Composite indexes for common queries
CREATE INDEX bill_status_date_idx ON "Bill" (current_status, introduced_date DESC);
CREATE INDEX bill_congress_type_idx ON "Bill" (congress, bill_type, bill_number);

-- Category lookups
CREATE INDEX category_slug_idx ON "Category" (slug);

-- User subscriptions
CREATE INDEX subscription_user_active_idx ON "Subscription" (user_id, active);
```

---

## Application Structure

### Project Directory Layout

```
legislation-tracker/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Auth-related routes
│   │   ├── login/
│   │   └── signup/
│   ├── (dashboard)/              # Protected routes
│   │   ├── dashboard/
│   │   ├── subscriptions/
│   │   └── layout.tsx
│   ├── bills/
│   │   ├── [id]/
│   │   │   ├── page.tsx          # Bill detail page
│   │   │   └── loading.tsx
│   │   ├── page.tsx              # Bills list
│   │   └── layout.tsx
│   ├── executive-orders/
│   │   ├── [id]/
│   │   └── page.tsx
│   ├── categories/
│   │   └── [slug]/
│   │       └── page.tsx
│   ├── api/                      # API Route Handlers
│   │   ├── bills/
│   │   │   ├── route.ts          # GET /api/bills
│   │   │   └── [id]/
│   │   │       └── route.ts      # GET /api/bills/:id
│   │   ├── search/
│   │   │   └── route.ts
│   │   ├── webhooks/
│   │   │   └── inngest/
│   │   │       └── route.ts      # Inngest webhook endpoint
│   │   └── subscriptions/
│   │       └── route.ts
│   ├── layout.tsx                # Root layout
│   ├── page.tsx                  # Home page
│   └── globals.css
│
├── components/                   # React components
│   ├── ui/                       # shadcn/ui components
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   └── ...
│   ├── bills/
│   │   ├── BillCard.tsx
│   │   ├── BillList.tsx
│   │   ├── BillDetail.tsx
│   │   ├── BillTimeline.tsx
│   │   └── StatusBadge.tsx
│   ├── search/
│   │   ├── SearchBar.tsx
│   │   ├── FilterPanel.tsx
│   │   └── SearchResults.tsx
│   ├── layout/
│   │   ├── Header.tsx
│   │   ├── Footer.tsx
│   │   ├── Sidebar.tsx
│   │   └── Navigation.tsx
│   └── shared/
│       ├── Loading.tsx
│       ├── ErrorBoundary.tsx
│       └── Pagination.tsx
│
├── lib/                          # Utility functions & configs
│   ├── db.ts                     # Prisma client singleton
│   ├── api/                      # External API clients
│   │   ├── congress.ts           # Congress.gov API wrapper
│   │   ├── federal-register.ts  # Federal Register API
│   │   └── whitehouse.ts         # WhiteHouse scraper
│   ├── ai/                       # AI integration
│   │   ├── summarizer.ts         # Main summarization logic
│   │   ├── categorizer.ts        # Auto-categorization
│   │   ├── prompts.ts            # Prompt templates
│   │   └── models.ts             # Model configurations
│   ├── cache/                    # Caching utilities
│   │   ├── redis.ts
│   │   └── strategies.ts
│   ├── email/                    # Email service
│   │   ├── client.ts
│   │   └── templates.tsx
│   ├── utils/
│   │   ├── date.ts
│   │   ├── formatting.ts
│   │   └── validation.ts
│   └── constants.ts
│
├── jobs/                         # Background job definitions
│   ├── fetch/
│   │   ├── fetch-bills.ts
│   │   ├── fetch-executive-orders.ts
│   │   └── fetch-votes.ts
│   ├── process/
│   │   ├── summarize-legislation.ts
│   │   ├── categorize-bills.ts
│   │   └── detect-changes.ts
│   ├── notify/
│   │   ├── send-digest.ts
│   │   └── send-instant-notification.ts
│   └── index.ts                  # Job registry
│
├── inngest/                      # Inngest configuration
│   ├── client.ts                 # Inngest client setup
│   └── functions.ts              # Function definitions
│
├── prisma/
│   ├── schema.prisma             # Database schema
│   ├── migrations/               # Migration files
│   └── seed.ts                   # Seed data
│
├── types/                        # TypeScript type definitions
│   ├── bill.ts
│   ├── executive-order.ts
│   ├── api.ts
│   └── index.ts
│
├── hooks/                        # Custom React hooks
│   ├── useBills.ts
│   ├── useSearch.ts
│   └── useSubscription.ts
│
├── public/                       # Static assets
│   ├── images/
│   └── icons/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── .env.example
├── .env.local
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

---

## Core Features & Implementation

### Feature 1: Automated Data Fetching

#### Implementation Overview

Background jobs run on a schedule to fetch new and updated legislation from all sources.

#### Congress.gov Bill Fetcher

```typescript
// jobs/fetch/fetch-bills.ts
import { inngest } from "@/inngest/client";
import { fetchLatestBills } from "@/lib/api/congress";
import { db } from "@/lib/db";

export const fetchBillsJob = inngest.createFunction(
  { id: "fetch-bills", retries: 3 },
  { cron: "0 */6 * * *" }, // Every 6 hours
  async ({ step }) => {
    // Step 1: Fetch latest bills from Congress.gov
    const bills = await step.run("fetch-bills", async () => {
      return await fetchLatestBills({
        congress: 118,
        limit: 250,
        offset: 0,
      });
    });

    // Step 2: Process each bill
    const results = await step.run("process-bills", async () => {
      const processed = [];

      for (const billData of bills) {
        // Check if bill exists
        const existing = await db.bill.findUnique({
          where: {
            congress_billType_billNumber: {
              congress: billData.congress,
              billType: billData.type,
              billNumber: billData.number,
            },
          },
        });

        if (existing) {
          // Update if status changed
          if (existing.currentStatus !== billData.latestAction.status) {
            await db.bill.update({
              where: { id: existing.id },
              data: {
                currentStatus: billData.latestAction.status,
                statusDate: billData.latestAction.actionDate,
              },
            });
            processed.push({ id: existing.id, action: "updated" });
          }
        } else {
          // Create new bill
          const newBill = await db.bill.create({
            data: {
              billType: billData.type,
              billNumber: billData.number,
              congress: billData.congress,
              title: billData.title,
              introducedDate: billData.introducedDate,
              currentStatus: billData.latestAction.status,
              statusDate: billData.latestAction.actionDate,
              sourceUrl: billData.url,
            },
          });
          processed.push({ id: newBill.id, action: "created" });
        }
      }

      return processed;
    });

    // Step 3: Trigger summarization for new bills
    await step.run("trigger-summarization", async () => {
      const newBills = results.filter((r) => r.action === "created");

      for (const { id } of newBills) {
        await inngest.send({
          name: "bill/summarize",
          data: { billId: id },
        });
      }
    });

    // Step 4: Log results
    await step.run("log-results", async () => {
      await db.jobRun.create({
        data: {
          jobName: "fetch-bills",
          status: "COMPLETED",
          itemsProcessed: results.length,
          completedAt: new Date(),
          metadata: {
            created: results.filter((r) => r.action === "created").length,
            updated: results.filter((r) => r.action === "updated").length,
          },
        },
      });
    });

    return {
      success: true,
      billsProcessed: results.length,
    };
  }
);
```

#### Congress.gov API Client

```typescript
// lib/api/congress.ts
import { z } from "zod";

const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY!;
const BASE_URL = "https://api.congress.gov/v3";

interface FetchBillsParams {
  congress: number;
  limit?: number;
  offset?: number;
  fromDateTime?: string;
  toDateTime?: string;
}

export async function fetchLatestBills(params: FetchBillsParams) {
  const {
    congress,
    limit = 250,
    offset = 0,
    fromDateTime,
    toDateTime,
  } = params;

  const url = new URL(`${BASE_URL}/bill/${congress}`);
  url.searchParams.set("api_key", CONGRESS_API_KEY);
  url.searchParams.set("limit", limit.toString());
  url.searchParams.set("offset", offset.toString());
  url.searchParams.set("format", "json");

  if (fromDateTime) url.searchParams.set("fromDateTime", fromDateTime);
  if (toDateTime) url.searchParams.set("toDateTime", toDateTime);

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    next: { revalidate: 3600 }, // Cache for 1 hour
  });

  if (!response.ok) {
    throw new Error(`Congress API error: ${response.status}`);
  }

  const data = await response.json();
  return data.bills || [];
}

export async function fetchBillDetails(
  congress: number,
  billType: string,
  billNumber: number
) {
  const url = `${BASE_URL}/bill/${congress}/${billType}/${billNumber}`;

  const response = await fetch(
    `${url}?api_key=${CONGRESS_API_KEY}&format=json`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch bill details: ${response.status}`);
  }

  const data = await response.json();
  return data.bill;
}

export async function fetchBillText(
  congress: number,
  billType: string,
  billNumber: number
) {
  const url = `${BASE_URL}/bill/${congress}/${billType}/${billNumber}/text`;

  const response = await fetch(
    `${url}?api_key=${CONGRESS_API_KEY}&format=json`
  );

  if (!response.ok) {
    return null; // Bill text may not be available yet
  }

  const data = await response.json();
  return data.textVersions?.[0]?.formats?.find(
    (f: any) => f.type === "Formatted Text"
  );
}

export async function fetchBillActions(
  congress: number,
  billType: string,
  billNumber: number
) {
  const url = `${BASE_URL}/bill/${congress}/${billType}/${billNumber}/actions`;

  const response = await fetch(
    `${url}?api_key=${CONGRESS_API_KEY}&format=json`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch bill actions: ${response.status}`);
  }

  const data = await response.json();
  return data.actions || [];
}

export async function fetchVotes(
  congress: number,
  chamber: "house" | "senate"
) {
  const url = `${BASE_URL}/vote/${congress}/${chamber}`;

  const response = await fetch(
    `${url}?api_key=${CONGRESS_API_KEY}&format=json`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch votes: ${response.status}`);
  }

  const data = await response.json();
  return data.votes || [];
}
```

#### Federal Register API Client

```typescript
// lib/api/federal-register.ts

const BASE_URL = "https://www.federalregister.gov/api/v1";

interface FetchExecutiveOrdersParams {
  page?: number;
  perPage?: number;
  conditions?: {
    publicationDate?: {
      gte?: string;
      lte?: string;
    };
    type?: string[];
    presidentialDocumentType?: string[];
  };
}

export async function fetchExecutiveOrders(
  params: FetchExecutiveOrdersParams = {}
) {
  const { page = 1, perPage = 100, conditions = {} } = params;

  const url = new URL(`${BASE_URL}/documents.json`);
  url.searchParams.set("page", page.toString());
  url.searchParams.set("per_page", perPage.toString());
  url.searchParams.set("order", "newest");

  // Filter for presidential documents
  url.searchParams.set("conditions[type][]", "PRESDOCU");

  if (conditions.presidentialDocumentType) {
    conditions.presidentialDocumentType.forEach((type) => {
      url.searchParams.append("conditions[presidential_document_type][]", type);
    });
  } else {
    // Default to executive orders
    url.searchParams.set(
      "conditions[presidential_document_type][]",
      "executive_order"
    );
  }

  if (conditions.publicationDate?.gte) {
    url.searchParams.set(
      "conditions[publication_date][gte]",
      conditions.publicationDate.gte
    );
  }

  if (conditions.publicationDate?.lte) {
    url.searchParams.set(
      "conditions[publication_date][lte]",
      conditions.publicationDate.lte
    );
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    throw new Error(`Federal Register API error: ${response.status}`);
  }

  const data = await response.json();
  return data.results || [];
}

export async function fetchExecutiveOrderDetails(documentNumber: string) {
  const url = `${BASE_URL}/documents/${documentNumber}.json`;

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch executive order: ${response.status}`);
  }

  return await response.json();
}

export async function fetchExecutiveOrderFullText(documentNumber: string) {
  const url = `${BASE_URL}/documents/${documentNumber}.json?fields[]=full_text_xml_url&fields[]=body_html_url`;

  const response = await fetch(url);

  if (!response.ok) {
    return null;
  }

  const data = await response.json();

  // Fetch the actual text
  if (data.body_html_url) {
    const textResponse = await fetch(data.body_html_url);
    return await textResponse.text();
  }

  return null;
}
```

### Feature 2: AI-Powered Summarization

#### Summarization Pipeline

```typescript
// jobs/process/summarize-legislation.ts
import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";
import { generateSummary, SummaryType } from "@/lib/ai/summarizer";

export const summarizeBillJob = inngest.createFunction(
  {
    id: "summarize-bill",
    retries: 2,
    concurrency: { limit: 5 }, // Limit concurrent AI calls
  },
  { event: "bill/summarize" },
  async ({ event, step }) => {
    const { billId } = event.data;

    // Step 1: Fetch bill details
    const bill = await step.run("fetch-bill", async () => {
      return await db.bill.findUnique({
        where: { id: billId },
        include: {
          sponsor: true,
          actions: {
            orderBy: { actionDate: "desc" },
            take: 10,
          },
        },
      });
    });

    if (!bill) {
      throw new Error(`Bill not found: ${billId}`);
    }

    // Step 2: Fetch full text if available
    const fullText = await step.run("fetch-full-text", async () => {
      if (bill.fullText) return bill.fullText;

      // Fetch from Congress.gov API
      const textData = await fetchBillText(
        bill.congress,
        bill.billType,
        bill.billNumber
      );

      if (textData?.url) {
        const response = await fetch(textData.url);
        return await response.text();
      }

      return null;
    });

    // Step 3: Generate different summary types
    const summaries = await step.run("generate-summaries", async () => {
      const summaryTypes: SummaryType[] = ["BRIEF", "STANDARD", "ELI5"];
      const results = [];

      for (const type of summaryTypes) {
        try {
          const summary = await generateSummary({
            title: bill.title,
            fullText: fullText || bill.title,
            billType: bill.billType,
            sponsor: bill.sponsor?.fullName,
            status: bill.currentStatus,
            summaryType: type,
          });

          const created = await db.summary.create({
            data: {
              billId: bill.id,
              summaryType: type,
              content: summary.content,
              keyPoints: summary.keyPoints,
              impactAreas: summary.impactAreas,
              aiModel: summary.model,
              confidence: summary.confidence,
            },
          });

          results.push(created);
        } catch (error) {
          console.error(`Failed to generate ${type} summary:`, error);
        }
      }

      return results;
    });

    // Step 4: Auto-categorize the bill
    await step.run("categorize-bill", async () => {
      await inngest.send({
        name: "bill/categorize",
        data: { billId: bill.id },
      });
    });

    return {
      success: true,
      summariesCreated: summaries.length,
    };
  }
);
```

#### AI Summarizer Implementation

```typescript
// lib/ai/summarizer.ts
import Anthropic from "@anthropic-ai/sdk";
import { SUMMARIZATION_PROMPTS } from "./prompts";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export type SummaryType =
  | "BRIEF"
  | "STANDARD"
  | "DETAILED"
  | "ELI5"
  | "KEY_CHANGES";

interface GenerateSummaryParams {
  title: string;
  fullText: string;
  billType?: string;
  sponsor?: string;
  status?: string;
  summaryType: SummaryType;
}

interface SummaryResult {
  content: string;
  keyPoints: string[];
  impactAreas: string[];
  model: string;
  confidence: number;
}

export async function generateSummary(
  params: GenerateSummaryParams
): Promise<SummaryResult> {
  const { title, fullText, billType, sponsor, status, summaryType } = params;

  const prompt = SUMMARIZATION_PROMPTS[summaryType]
    .replace("{{TITLE}}", title)
    .replace("{{FULL_TEXT}}", fullText.slice(0, 50000)) // Limit context
    .replace("{{BILL_TYPE}}", billType || "bill")
    .replace("{{SPONSOR}}", sponsor || "Unknown")
    .replace("{{STATUS}}", status || "Introduced");

  const message = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 2000,
    temperature: 0.3, // Lower temperature for consistency
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const response =
    message.content[0].type === "text" ? message.content[0].text : "";

  // Parse structured response
  const parsed = parseAIResponse(response);

  return {
    content: parsed.summary,
    keyPoints: parsed.keyPoints,
    impactAreas: parsed.impactAreas,
    model: "claude-3-5-sonnet-20241022",
    confidence: calculateConfidence(fullText, response),
  };
}

function parseAIResponse(response: string) {
  // Extract sections from structured response
  const summaryMatch = response.match(/## Summary\n([\s\S]*?)(?=\n##|$)/);
  const keyPointsMatch = response.match(/## Key Points\n([\s\S]*?)(?=\n##|$)/);
  const impactMatch = response.match(/## Impact Areas\n([\s\S]*?)(?=\n##|$)/);

  const summary = summaryMatch?.[1]?.trim() || response.split("\n\n")[0];

  const keyPoints =
    keyPointsMatch?.[1]
      ?.split("\n")
      .filter((line) => line.trim().startsWith("-"))
      .map((line) => line.replace(/^-\s*/, "").trim()) || [];

  const impactAreas =
    impactMatch?.[1]
      ?.split("\n")
      .filter((line) => line.trim().startsWith("-"))
      .map((line) => line.replace(/^-\s*/, "").trim()) || [];

  return { summary, keyPoints, impactAreas };
}

function calculateConfidence(fullText: string, summary: string): number {
  // Simple heuristic: more source text = higher confidence
  if (fullText.length > 10000) return 0.9;
  if (fullText.length > 5000) return 0.8;
  if (fullText.length > 1000) return 0.7;
  return 0.6;
}

// Batch summarization for efficiency
export async function batchSummarize(
  bills: Array<{ id: string; title: string; fullText: string }>
) {
  const results = [];

  for (const bill of bills) {
    try {
      const summary = await generateSummary({
        title: bill.title,
        fullText: bill.fullText,
        summaryType: "STANDARD",
      });
      results.push({ billId: bill.id, summary });
    } catch (error) {
      console.error(`Failed to summarize bill ${bill.id}:`, error);
      results.push({ billId: bill.id, error });
    }
  }

  return results;
}
```

#### Prompt Templates

```typescript
// lib/ai/prompts.ts

export const SUMMARIZATION_PROMPTS = {
  BRIEF: `You are a legislative analyst. Summarize the following bill in 2-3 clear sentences that a general audience can understand.

Title: {{TITLE}}
Bill Type: {{BILL_TYPE}}
Sponsor: {{SPONSOR}}
Status: {{STATUS}}

Full Text:
{{FULL_TEXT}}

Provide your response in this format:
## Summary
[2-3 sentence summary]

## Key Points
- [First key point]
- [Second key point]
- [Third key point]

## Impact Areas
- [Who or what this affects]
- [Another impact area]

Focus on what the bill does, who it affects, and why it matters. Avoid jargon.`,

  STANDARD: `You are a legislative analyst. Provide a comprehensive but accessible summary of the following bill.

Title: {{TITLE}}
Bill Type: {{BILL_TYPE}}
Sponsor: {{SPONSOR}}
Status: {{STATUS}}

Full Text:
{{FULL_TEXT}}

Provide your response in this format:
## Summary
[1-2 paragraph summary explaining what the bill does, its purpose, and potential impact]

## Key Points
- [Important provision 1]
- [Important provision 2]
- [Important provision 3]
- [Important provision 4]
- [Important provision 5]

## Impact Areas
- [Primary group/area affected]
- [Secondary group/area affected]
- [Additional impacts]

Use clear, plain language. Explain technical terms when necessary.`,

  ELI5: `You are explaining legislation to someone with no legal background. Summarize this bill as if explaining to a curious 12-year-old.

Title: {{TITLE}}
Full Text:
{{FULL_TEXT}}

Provide your response in this format:
## Summary
[Simple explanation using everyday language and relatable examples]

## Key Points
- [Simple point 1]
- [Simple point 2]
- [Simple point 3]

## Impact Areas
- [Who this affects in simple terms]

Use analogies, avoid all jargon, and focus on real-world effects.`,

  DETAILED: `You are a senior legislative analyst. Provide a detailed analysis of the following bill.

Title: {{TITLE}}
Bill Type: {{BILL_TYPE}}
Sponsor: {{SPONSOR}}
Status: {{STATUS}}

Full Text:
{{FULL_TEXT}}

Provide your response in this format:
## Executive Summary
[Comprehensive overview]

## Key Provisions
- [Detailed provision 1]
- [Detailed provision 2]
- [Detailed provision 3]
[Continue as needed]

## Stakeholder Impact
- [Affected group 1 and how]
- [Affected group 2 and how]
- [Affected group 3 and how]

## Fiscal Implications
[Budget impact if mentioned]

## Implementation Timeline
[Key dates and deadlines if specified]

## Related Legislation
[Connections to other bills if evident]

Be thorough but clear.`,

  KEY_CHANGES: `You are comparing versions of legislation. Identify the key changes in this bill.

Title: {{TITLE}}
Full Text:
{{FULL_TEXT}}

Provide your response in this format:
## Summary of Changes
[Overview of what changed]

## Major Changes
- [Change 1]
- [Change 2]
- [Change 3]

## Impact of Changes
- [How change 1 affects things]
- [How change 2 affects things]

Focus on substantive changes, not formatting.`,
};

export const CATEGORIZATION_PROMPT = `You are a legislative categorization system. Analyze the following bill and assign it to the most relevant categories.

Title: {{TITLE}}
Summary: {{SUMMARY}}

Available Categories:
{{CATEGORIES}}

Instructions:
1. Assign 1-3 primary categories that best describe this bill
2. Consider the bill's main focus and impacts
3. Return only category slugs, comma-separated

Response format:
category-slug-1, category-slug-2, category-slug-3`;
```

### Feature 3: Automatic Categorization

```typescript
// jobs/process/categorize-bills.ts
import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";
import { categorizeBill } from "@/lib/ai/categorizer";

export const categorizeBillJob = inngest.createFunction(
  { id: "categorize-bill" },
  { event: "bill/categorize" },
  async ({ event, step }) => {
    const { billId } = event.data;

    // Fetch bill with summary
    const bill = await step.run("fetch-bill", async () => {
      return await db.bill.findUnique({
        where: { id: billId },
        include: {
          summaries: {
            where: { summaryType: "STANDARD" },
            take: 1,
          },
        },
      });
    });

    if (!bill) {
      throw new Error(`Bill not found: ${billId}`);
    }

    // Get all available categories
    const categories = await step.run("fetch-categories", async () => {
      return await db.category.findMany({
        select: { id: true, slug: true, name: true, description: true },
      });
    });

    // Use AI to categorize
    const assignedCategories = await step.run("assign-categories", async () => {
      const summary = bill.summaries[0]?.content || bill.title;

      const categorySlugs = await categorizeBill({
        title: bill.title,
        summary,
        availableCategories: categories,
      });

      const categoryIds = categories
        .filter((cat) => categorySlugs.includes(cat.slug))
        .map((cat) => ({ id: cat.id }));

      await db.bill.update({
        where: { id: billId },
        data: {
          categories: {
            connect: categoryIds,
          },
        },
      });

      return categorySlugs;
    });

    return {
      success: true,
      categories: assignedCategories,
    };
  }
);
```

```typescript
// lib/ai/categorizer.ts
import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIZATION_PROMPT } from "./prompts";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

interface CategorizeBillParams {
  title: string;
  summary: string;
  availableCategories: Array<{
    slug: string;
    name: string;
    description?: string;
  }>;
}

export async function categorizeBill(
  params: CategorizeBillParams
): Promise<string[]> {
  const { title, summary, availableCategories } = params;

  const categoriesList = availableCategories
    .map(
      (cat) =>
        `- ${cat.slug}: ${cat.name}${
          cat.description ? ` - ${cat.description}` : ""
        }`
    )
    .join("\n");

  const prompt = CATEGORIZATION_PROMPT.replace("{{TITLE}}", title)
    .replace("{{SUMMARY}}", summary)
    .replace("{{CATEGORIES}}", categoriesList);

  const message = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 200,
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const response =
    message.content[0].type === "text" ? message.content[0].text : "";

  // Parse comma-separated slugs
  const slugs = response
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => availableCategories.some((cat) => cat.slug === s))
    .slice(0, 3); // Max 3 categories

  return slugs;
}
```

### Feature 4: Change Detection & Notifications

```typescript
// jobs/process/detect-changes.ts
import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";

export const detectChangesJob = inngest.createFunction(
  { id: "detect-changes", retries: 2 },
  { cron: "*/30 * * * *" }, // Every 30 minutes
  async ({ step }) => {
    // Find bills updated in the last hour
    const recentlyUpdated = await step.run("find-updated-bills", async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      return await db.bill.findMany({
        where: {
          updatedAt: {
            gte: oneHourAgo,
          },
        },
        include: {
          categories: true,
          summaries: {
            where: { summaryType: "BRIEF" },
            take: 1,
          },
        },
      });
    });

    // Find users subscribed to these bills
    const notifications = await step.run("match-subscriptions", async () => {
      const toNotify = [];

      for (const bill of recentlyUpdated) {
        // Find users subscribed to this bill's categories
        const subscribers = await db.subscription.findMany({
          where: {
            active: true,
            frequency: "INSTANT",
            OR: [
              {
                subscriptionType: "ALL_BILLS",
              },
              {
                subscriptionType: "SPECIFIC_CATEGORIES",
                categoryIds: {
                  hasSome: bill.categories.map((c) => c.id),
                },
              },
            ],
          },
          include: {
            user: true,
          },
        });

        for (const sub of subscribers) {
          toNotify.push({
            userId: sub.user.id,
            userEmail: sub.user.email,
            billId: bill.id,
            billTitle: bill.title,
            status: bill.currentStatus,
            summary: bill.summaries[0]?.content,
          });
        }
      }

      return toNotify;
    });

    // Send notifications
    await step.run("send-notifications", async () => {
      for (const notification of notifications) {
        await inngest.send({
          name: "notification/send",
          data: notification,
        });
      }
    });

    return {
      billsChecked: recentlyUpdated.length,
      notificationsSent: notifications.length,
    };
  }
);
```

---

## API Design

### REST API Endpoints

#### Bills API

```typescript
// app/api/bills/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.string().optional(),
  category: z.string().optional(),
  congress: z.coerce.number().optional(),
  search: z.string().optional(),
  sortBy: z.enum(["date", "relevance", "status"]).default("date"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = querySchema.parse(Object.fromEntries(searchParams));

    const {
      page,
      limit,
      status,
      category,
      congress,
      search,
      sortBy,
      sortOrder,
    } = params;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {};

    if (status) where.currentStatus = status;
    if (congress) where.congress = congress;
    if (category) {
      where.categories = {
        some: { slug: category },
      };
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { officialTitle: { contains: search, mode: "insensitive" } },
      ];
    }

    // Execute query
    const [bills, total] = await Promise.all([
      db.bill.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          [sortBy === "date" ? "introducedDate" : "updatedAt"]: sortOrder,
        },
        include: {
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
            },
          },
          summaries: {
            where: { summaryType: "BRIEF" },
            take: 1,
          },
          _count: {
            select: {
              votes: true,
              amendments: true,
            },
          },
        },
      }),
      db.bill.count({ where }),
    ]);

    return NextResponse.json({
      data: bills,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: error.errors },
        { status: 400 }
      );
    }

    console.error("Error fetching bills:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

#### Bill Detail API

```typescript
// app/api/bills/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const bill = await db.bill.findUnique({
      where: { id: params.id },
      include: {
        sponsor: true,
        cosponsors: {
          take: 10,
        },
        summaries: {
          orderBy: { createdAt: "desc" },
        },
        categories: true,
        votes: {
          orderBy: { voteDate: "desc" },
          include: {
            individualVotes: {
              include: {
                member: true,
              },
            },
          },
        },
        amendments: {
          orderBy: { proposedDate: "desc" },
        },
        actions: {
          orderBy: { actionDate: "desc" },
          take: 50,
        },
      },
    });

    if (!bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    return NextResponse.json({ data: bill });
  } catch (error) {
    console.error("Error fetching bill:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

#### Search API

```typescript
// app/api/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");
  const type = searchParams.get("type") || "all"; // 'bills', 'executive-orders', 'all'

  if (!query || query.length < 2) {
    return NextResponse.json(
      { error: "Query must be at least 2 characters" },
      { status: 400 }
    );
  }

  try {
    const results: any = {
      bills: [],
      executiveOrders: [],
    };

    if (type === "bills" || type === "all") {
      results.bills = await db.bill.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { officialTitle: { contains: query, mode: "insensitive" } },
            { shortTitle: { contains: query, mode: "insensitive" } },
          ],
        },
        take: 10,
        include: {
          sponsor: true,
          categories: true,
          summaries: {
            where: { summaryType: "BRIEF" },
            take: 1,
          },
        },
        orderBy: { introducedDate: "desc" },
      });
    }

    if (type === "executive-orders" || type === "all") {
      results.executiveOrders = await db.executiveOrder.findMany({
        where: {
          title: { contains: query, mode: "insensitive" },
        },
        take: 10,
        include: {
          categories: true,
          summaries: {
            where: { summaryType: "BRIEF" },
            take: 1,
          },
        },
        orderBy: { signingDate: "desc" },
      });
    }

    return NextResponse.json({
      query,
      results,
      totalResults: results.bills.length + results.executiveOrders.length,
    });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
```

#### Subscriptions API

```typescript
// app/api/subscriptions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth"; // Your auth implementation

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { subscriptionType, categoryIds, keywords, frequency } = body;

    const subscription = await db.subscription.create({
      data: {
        userId: session.user.id,
        subscriptionType,
        categoryIds: categoryIds || [],
        keywords: keywords || [],
        frequency: frequency || "DAILY_DIGEST",
        active: true,
      },
    });

    return NextResponse.json({ data: subscription }, { status: 201 });
  } catch (error) {
    console.error("Subscription error:", error);
    return NextResponse.json(
      { error: "Failed to create subscription" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const subscriptions = await db.subscription.findMany({
      where: { userId: session.user.id },
      include: {
        user: {
          select: { email: true, name: true },
        },
      },
    });

    return NextResponse.json({ data: subscriptions });
  } catch (error) {
    console.error("Fetch subscriptions error:", error);
    return NextResponse.json(
      { error: "Failed to fetch subscriptions" },
      { status: 500 }
    );
  }
}
```

---

## Background Job Processing

### Inngest Setup

```typescript
// inngest/client.ts
import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "legislation-tracker",
  name: "Legislative Tracker",
});
```

```typescript
// inngest/functions.ts
import { inngest } from "./client";
import { fetchBillsJob } from "@/jobs/fetch/fetch-bills";
import { fetchExecutiveOrdersJob } from "@/jobs/fetch/fetch-executive-orders";
import { summarizeBillJob } from "@/jobs/process/summarize-legislation";
import { categorizeBillJob } from "@/jobs/process/categorize-bills";
import { detectChangesJob } from "@/jobs/process/detect-changes";
import { sendDigestJob } from "@/jobs/notify/send-digest";

export const functions = [
  fetchBillsJob,
  fetchExecutiveOrdersJob,
  summarizeBillJob,
  categorizeBillJob,
  detectChangesJob,
  sendDigestJob,
];
```

```typescript
// app/api/inngest/route.ts
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
```

### Job Schedules

| Job Name                 | Schedule         | Purpose                                                 |
| ------------------------ | ---------------- | ------------------------------------------------------- |
| `fetch-bills`            | Every 6 hours    | Fetch new and updated bills from Congress.gov           |
| `fetch-executive-orders` | Every 12 hours   | Fetch new executive orders from Federal Register        |
| `fetch-votes`            | Every 6 hours    | Fetch recent votes from Congress.gov                    |
| `detect-changes`         | Every 30 minutes | Check for bill status changes and trigger notifications |
| `send-daily-digest`      | 8:00 AM daily    | Send daily digest emails to subscribed users            |
| `send-weekly-digest`     | Monday 8:00 AM   | Send weekly digest emails                               |
| `cleanup-old-jobs`       | Daily at 2:00 AM | Clean up old job run records                            |

---

## AI Summarization Pipeline

### Processing Flow

```
New Bill Created
       ↓
Fetch Full Text (if available)
       ↓
Generate Multiple Summaries:
  - Brief (2-3 sentences)
  - Standard (1-2 paragraphs)
  - ELI5 (Simple explanation)
       ↓
Extract Key Points
       ↓
Identify Impact Areas
       ↓
Auto-Categorize
       ↓
Store in Database
       ↓
Trigger Notifications (if subscribed)
```

### Quality Control

```typescript
// lib/ai/quality-control.ts

interface QualityMetrics {
  lengthAppropriate: boolean;
  containsKeyInfo: boolean;
  readabilityScore: number;
  overallQuality: "high" | "medium" | "low";
}

export function assessSummaryQuality(
  summary: string,
  originalText: string,
  summaryType: string
): QualityMetrics {
  const wordCount = summary.split(/\s+/).length;

  // Check length appropriateness
  const lengthRanges = {
    BRIEF: [20, 60],
    STANDARD: [100, 300],
    DETAILED: [300, 800],
    ELI5: [50, 150],
  };

  const [min, max] = lengthRanges[summaryType as keyof typeof lengthRanges] || [
    0,
    Infinity,
  ];
  const lengthAppropriate = wordCount >= min && wordCount <= max;

  // Check for key information preservation
  const keyTerms = extractKeyTerms(originalText);
  const termsInSummary = keyTerms.filter((term) =>
    summary.toLowerCase().includes(term.toLowerCase())
  ).length;
  const containsKeyInfo = termsInSummary >= keyTerms.length * 0.5;

  // Simple readability (Flesch-Kincaid approximation)
  const readabilityScore = calculateReadability(summary);

  // Overall quality assessment
  let overallQuality: "high" | "medium" | "low";
  if (lengthAppropriate && containsKeyInfo && readabilityScore > 60) {
    overallQuality = "high";
  } else if (!lengthAppropriate || !containsKeyInfo) {
    overallQuality = "low";
  } else {
    overallQuality = "medium";
  }

  return {
    lengthAppropriate,
    containsKeyInfo,
    readabilityScore,
    overallQuality,
  };
}

function extractKeyTerms(text: string): string[] {
  // Simple keyword extraction (in production, use NLP library)
  const words = text.toLowerCase().split(/\W+/);
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
  ]);

  const wordFreq = new Map<string, number>();
  words.forEach((word) => {
    if (word.length > 4 && !stopWords.has(word)) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }
  });

  return Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

function calculateReadability(text: string): number {
  const sentences = text.split(/[.!?]+/).length;
  const words = text.split(/\s+/).length;
  const syllables = text.split(/[aeiouy]+/gi).length - 1;

  if (sentences === 0 || words === 0) return 0;

  const avgWordsPerSentence = words / sentences;
  const avgSyllablesPerWord = syllables / words;

  // Flesch Reading Ease (0-100, higher is easier)
  const score =
    206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord;
  return Math.max(0, Math.min(100, score));
}
```

---

## Deployment Strategy

### Infrastructure Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Vercel (Primary Hosting)                 │
│  - Next.js Application                                      │
│  - Serverless Functions                                     │
│  - Static Assets (CDN)                                      │
│  - Vercel KV (Redis)                                        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              Neon/Supabase (PostgreSQL Database)            │
│  - Primary data storage                                     │
│  - Automatic backups                                        │
│  - Connection pooling                                       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              Inngest (Background Job Processing)            │
│  - Scheduled jobs                                           │
│  - Event-driven workflows                                   │
│  - Retry handling                                           │
└─────────────────────────────────────────────────────────────┘
```

### Environment Variables

```bash
# .env.example

# Database
DATABASE_URL="postgresql://user:password@host:5432/legislation_tracker"
DIRECT_URL="postgresql://user:password@host:5432/legislation_tracker" # For migrations

# External APIs
CONGRESS_API_KEY="your_congress_gov_api_key"
ANTHROPIC_API_KEY="your_anthropic_api_key"
OPENAI_API_KEY="your_openai_api_key" # Optional alternative

# Background Jobs
INNGEST_EVENT_KEY="your_inngest_event_key"
INNGEST_SIGNING_KEY="your_inngest_signing_key"

# Caching
REDIS_URL="redis://default:password@host:6379"
# OR for Vercel KV:
KV_URL="your_vercel_kv_url"
KV_REST_API_URL="your_vercel_kv_rest_api_url"
KV_REST_API_TOKEN="your_vercel_kv_token"

# Email
RESEND_API_KEY="your_resend_api_key"
EMAIL_FROM="notifications@yourapp.com"

# Authentication (NextAuth.js)
NEXTAUTH_URL="https://yourapp.com"
NEXTAUTH_SECRET="your_nextauth_secret"

# Monitoring
SENTRY_DSN="your_sentry_dsn"
SENTRY_AUTH_TOKEN="your_sentry_token"

# Application
NEXT_PUBLIC_APP_URL="https://yourapp.com"
NODE_ENV="production"
```

### Deployment Steps

#### 1. Database Setup (Neon)

```bash
# Install Prisma CLI
npm install -g prisma

# Generate Prisma Client
npx prisma generate

# Run migrations
npx prisma migrate deploy

# Seed initial data (categories, etc.)
npx prisma db seed
```

#### 2. Vercel Deployment

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Deploy to production
vercel --prod

# Set environment variables
vercel env add DATABASE_URL
vercel env add ANTHROPIC_API_KEY
vercel env add CONGRESS_API_KEY
# ... add all other environment variables
```

#### 3. Inngest Setup

```bash
# Sign up at inngest.com
# Add Inngest environment variables to Vercel
# Deploy will automatically register functions

# Verify functions are registered
curl https://yourapp.com/api/inngest
```

#### 4. DNS Configuration

```
Add CNAME record:
  Host: www
  Value: cname.vercel-dns.com

Add A records for root domain:
  76.76.21.21
```

### Monitoring & Logging

```typescript
// lib/monitoring.ts
import * as Sentry from "@sentry/nextjs";

export function initMonitoring() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    beforeSend(event, hint) {
      // Filter out expected errors
      if (event.exception?.values?.[0]?.value?.includes("NotFound")) {
        return null;
      }
      return event;
    },
  });
}

export function logError(error: Error, context?: Record<string, any>) {
  console.error(error);
  Sentry.captureException(error, { extra: context });
}

export function logInfo(message: string, data?: Record<string, any>) {
  console.log(message, data);
  // Could send to analytics service
}
```

### Performance Optimization

```typescript
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable SWC minification
  swcMinify: true,

  // Image optimization
  images: {
    domains: ["www.congress.gov", "bioguide.congress.gov"],
    formats: ["image/avif", "image/webp"],
  },

  // Compression
  compress: true,

  // React strict mode
  reactStrictMode: true,

  // Experimental features
  experimental: {
    serverActions: true,
  },

  // Headers for security
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "origin-when-cross-origin",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
```

### Caching Strategy

```typescript
// lib/cache/strategies.ts
import { kv } from "@vercel/kv";

export async function getCachedBills(
  cacheKey: string,
  fetchFn: () => Promise<any>,
  ttl: number = 3600
) {
  // Try cache first
  const cached = await kv.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Fetch fresh data
  const data = await fetchFn();

  // Cache the result
  await kv.set(cacheKey, data, { ex: ttl });

  return data;
}

export async function invalidateCache(pattern: string) {
  // Invalidate cache entries matching pattern
  const keys = await kv.keys(pattern);
  if (keys.length > 0) {
    await kv.del(...keys);
  }
}

// Example usage in API route:
export async function GET(request: NextRequest) {
  const bills = await getCachedBills(
    "bills:latest",
    async () => {
      return await db.bill.findMany({
        take: 20,
        orderBy: { introducedDate: "desc" },
      });
    },
    1800 // 30 minutes
  );

  return NextResponse.json({ data: bills });
}
```

---

## Development Roadmap

### Phase 1: MVP (Weeks 1-6)

**Week 1-2: Foundation**

- [ ] Set up Next.js project with TypeScript
- [ ] Configure Prisma with PostgreSQL
- [ ] Create database schema and run migrations
- [ ] Set up basic authentication
- [ ] Create basic UI components (shadcn/ui)

**Week 3-4: Data Fetching**

- [ ] Implement Congress.gov API client
- [ ] Implement Federal Register API client
- [ ] Create background job infrastructure (Inngest)
- [ ] Build bill fetching job
- [ ] Build executive order fetching job
- [ ] Test data ingestion pipeline

**Week 5-6: AI Integration**

- [ ] Set up Anthropic Claude API
- [ ] Implement summarization pipeline
- [ ] Create multiple summary types
- [ ] Build auto-categorization
- [ ] Test AI quality and accuracy

### Phase 2: Core Features (Weeks 7-12)

**Week 7-8: User Interface**

- [ ] Build home page with featured legislation
- [ ] Create bills list page with filters
- [ ] Build bill detail page
- [ ] Add executive orders section
- [ ] Implement search functionality

**Week 9-10: User Features**

- [ ] User registration and authentication
- [ ] Create user dashboard
- [ ] Build subscription management
- [ ] Implement notification system
- [ ] Create email digest templates

**Week 11-12: Testing & Refinement**

- [ ] Write unit tests for critical functions
- [ ] Integration testing for API endpoints
- [ ] Load testing for database queries
- [ ] Performance optimization
- [ ] Bug fixes and polish

### Phase 3: Enhancement (Weeks 13-16)

**Week 13-14: Advanced Features**

- [ ] Vote tracking and visualization
- [ ] Member of Congress profiles
- [ ] Amendment tracking
- [ ] Bill comparison tool
- [ ] Advanced search with filters

**Week 15: Polish & Documentation**

- [ ] User onboarding flow
- [ ] Help documentation
- [ ] Admin dashboard for monitoring
- [ ] Analytics integration
- [ ] SEO optimization

**Week 16: Launch Preparation**

- [ ] Security audit
- [ ] Performance testing at scale
- [ ] Set up monitoring and alerts
- [ ] Create launch marketing materials
- [ ] Soft launch with beta users

### Phase 4: Post-Launch (Ongoing)

**Immediate Post-Launch**

- Monitor system performance and errors
- Gather user feedback
- Fix critical bugs
- Optimize slow queries

**Future Enhancements**

- Supreme Court case tracking
- State legislation tracking (major states)
- Regulatory changes tracking
- Legislative impact analysis
- Social sharing features
- Mobile apps (iOS/Android)
- API for third-party developers
- Integration with civic engagement platforms

---

## Success Metrics

### Technical Metrics

- **Data Freshness**: Legislation updated within 6 hours of official publication
- **Summary Quality**: 90%+ user satisfaction rating
- **API Response Time**: < 200ms for cached requests, < 1s for database queries
- **Job Success Rate**: 99%+ success rate for background jobs
- **Uptime**: 99.9% application availability

### User Engagement Metrics

- **Daily Active Users (DAU)**
- **Weekly Active Users (WAU)**
- **Average session duration**
- **Bills viewed per session**
- **Subscription conversion rate**
- **Email open rates**
- **User retention (30-day, 90-day)**

### Content Metrics

- **Total bills tracked**
- **Total executive orders tracked**
- **Summaries generated**
- **Categories assigned**
- **Search queries performed**

---

## Security Considerations

### Authentication & Authorization

- Use NextAuth.js for authentication
- Implement role-based access control (RBAC)
- Secure API routes with middleware
- Rate limiting on public endpoints
- CSRF protection on forms

### Data Protection

- Encrypt sensitive data at rest
- Use HTTPS everywhere
- Sanitize user inputs
- Implement SQL injection protection (Prisma handles this)
- Regular security audits

### API Security

```typescript
// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

export async function middleware(request: NextRequest) {
  // Rate limiting
  const ip = request.ip ?? "127.0.0.1";
  const { success } = await rateLimit.check(ip);

  if (!success) {
    return new NextResponse("Too Many Requests", { status: 429 });
  }

  // CORS headers
  const response = NextResponse.next();
  response.headers.set(
    "Access-Control-Allow-Origin",
    process.env.NEXT_PUBLIC_APP_URL!
  );
  response.headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );

  return response;
}

export const config = {
  matcher: "/api/:path*",
};
```

---

## Appendix

### Useful Resources

**Government Data Sources**

- Congress.gov API: https://api.congress.gov/
- Federal Register API: https://www.federalregister.gov/developers/api/v1
- GovInfo API: https://api.govinfo.gov/docs/
- WhiteHouse.gov: https://www.whitehouse.gov/

**Documentation**

- Next.js: https://nextjs.org/docs
- Prisma: https://www.prisma.io/docs
- Inngest: https://www.inngest.com/docs
- Anthropic Claude: https://docs.anthropic.com/
- shadcn/ui: https://ui.shadcn.com/

**Community**

- Congress.gov API Forum: https://github.com/LibraryOfCongress/api.congress.gov
- Open States Project: https://openstates.org/
- Civic Tech Community: https://codeforamerica.org/

### Sample Data Seeds

```typescript
// prisma/seed.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Seed categories
  const categories = [
    {
      name: "Healthcare",
      slug: "healthcare",
      description:
        "Bills related to healthcare, insurance, and medical services",
      color: "#3B82F6",
    },
    {
      name: "Education",
      slug: "education",
      description: "Education funding, policy, and reform",
      color: "#8B5CF6",
    },
    {
      name: "Environment & Climate",
      slug: "environment-climate",
      description: "Environmental protection and climate change legislation",
      color: "#10B981",
    },
    {
      name: "Economy & Taxes",
      slug: "economy-taxes",
      description: "Economic policy, taxation, and fiscal matters",
      color: "#F59E0B",
    },
    {
      name: "Defense & National Security",
      slug: "defense-security",
      description: "Military, defense, and national security",
      color: "#EF4444",
    },
    {
      name: "Immigration",
      slug: "immigration",
      description: "Immigration policy and border security",
      color: "#6366F1",
    },
    {
      name: "Technology & Innovation",
      slug: "technology",
      description: "Technology policy, cybersecurity, and innovation",
      color: "#06B6D4",
    },
    {
      name: "Civil Rights & Justice",
      slug: "civil-rights",
      description: "Civil rights, criminal justice, and voting rights",
      color: "#EC4899",
    },
  ];

  for (const category of categories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: category,
      create: category,
    });
  }

  console.log("Seeded categories");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
```

---

## Conclusion

This Legislative Tracker application provides a comprehensive solution for making U.S. federal legislation accessible to everyone. By combining modern web technologies, AI-powered summarization, and automated data collection, the platform bridges the gap between complex legal language and public understanding.

The architecture is designed to be scalable, maintainable, and cost-effective, leveraging serverless technologies where appropriate while maintaining full control over critical data processing pipelines.

**Key Strengths:**

- ✅ Automated data collection from official sources
- ✅ AI-powered plain language summaries
- ✅ Real-time updates and notifications
- ✅ Scalable serverless architecture
- ✅ User-friendly interface
- ✅ Open and transparent

**Next Steps:**

1. Set up development environment
2. Initialize database and seed data
3. Implement core data fetching pipeline
4. Build AI summarization system
5. Create user interface
6. Deploy to production
7. Launch and iterate based on feedback

This documentation serves as a complete technical blueprint for building the application. Adjust timelines and features based on your team size, budget, and priorities.
