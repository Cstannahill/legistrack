# Legislative Tracker

A robust, scalable web application that automatically tracks, categorizes, and summarizes U.S. federal legislation in plain, understandable language.

## 🌟 Features

- **Automated Data Collection**: Continuously fetches legislative data from Congress.gov and Federal Register
- **AI-Powered Summaries**: Transforms complex legal text into digestible summaries using Claude AI
- **Smart Categorization**: Automatically classifies legislation by topic and impact area
- **Real-time Updates**: Background jobs keep data fresh with the latest government activity
- **Advanced Search & Filtering**: Find relevant legislation quickly with powerful search and filters
- **Clean, Modern UI**: Built with Next.js 15, shadcn/ui, and Tailwind CSS

## 🏗️ Architecture

### Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Database**: PostgreSQL with Prisma ORM
- **Background Jobs**: Inngest for reliable, scheduled data fetching
- **AI**: Anthropic Claude for summarization and categorization
- **UI**: shadcn/ui components with Tailwind CSS
- **TypeScript**: End-to-end type safety

### Project Structure

```
legislation-tracker/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── api/               # API route handlers
│   │   │   ├── bills/        # Bills endpoints
│   │   │   ├── search/       # Search endpoint
│   │   │   ├── categories/   # Categories endpoint
│   │   │   └── inngest/      # Inngest webhook
│   │   ├── bills/            # Bills list page
│   │   ├── layout.tsx        # Root layout with header/footer
│   │   └── page.tsx          # Home page
│   ├── components/            # React components
│   │   ├── ui/               # shadcn/ui components
│   │   ├── bills/            # Bill-specific components
│   │   ├── layout/           # Layout components (Header)
│   │   └── search/           # Search & filter components
│   ├── lib/                   # Core utilities
│   │   ├── api/              # External API clients
│   │   │   ├── congress.ts   # Congress.gov API
│   │   │   └── federal-register.ts
│   │   ├── ai/               # AI integration
│   │   │   ├── summarizer.ts # Claude summarization
│   │   │   ├── categorizer.ts
│   │   │   └── prompts.ts    # AI prompt templates
│   │   ├── utils/            # Helper functions
│   │   ├── db.ts             # Prisma client
│   │   └── constants.ts      # App constants
│   ├── jobs/                  # Background job definitions
│   │   ├── fetch/            # Data fetching jobs
│   │   └── process/          # Processing jobs
│   ├── inngest/               # Inngest configuration
│   │   ├── client.ts
│   │   └── functions.ts      # Job registry
│   └── types/                 # TypeScript types
├── prisma/
│   ├── schema.prisma         # Database schema
│   └── seed.ts               # Seed data
├── architecture.md           # Detailed architecture doc
└── README.md                 # This file
```

## 📊 Database Schema

Comprehensive schema with support for:

- **Bills**: Congress bills with full metadata
- **Executive Orders**: Presidential actions
- **Summaries**: AI-generated summaries (multiple types)
- **Categories**: Hierarchical categorization
- **Members**: Congress members and sponsors
- **Votes**: Roll call votes and member positions
- **Amendments**: Bill amendments
- **Actions**: Bill action history
- **Users & Subscriptions**: User management (future)

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL database
- API Keys:
  - Congress.gov API key (free from Library of Congress)
  - Anthropic API key (for Claude)
  - Inngest account (free tier available)

### Installation

1. **Clone and install dependencies**

```bash
cd legislation-tracker
npm install
```

2. **Set up environment variables**

Create a `.env` file based on `.env.example`:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/legislation_tracker"

CONGRESS_API_KEY="your_congress_gov_api_key"
ANTHROPIC_API_KEY="your_anthropic_api_key"

INNGEST_EVENT_KEY="your_inngest_event_key"
INNGEST_SIGNING_KEY="your_inngest_signing_key"
```

3. **Set up the database**

```bash
# Generate Prisma client
npm run db:generate

# Push schema to database (for development)
npm run db:push

# Or run migrations (for production)
npm run db:migrate

# Seed initial categories
npm run db:seed
```

4. **Run the development server**

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

5. **Configure Inngest**

The Inngest webhook endpoint is at `/api/inngest`. Configure this in your Inngest dashboard to enable background jobs.

## 📝 Background Jobs

The application includes several scheduled jobs:

| Job Name                 | Schedule       | Purpose                                       |
| ------------------------ | -------------- | --------------------------------------------- |
| `fetch-bills`            | Every 6 hours  | Fetch new and updated bills from Congress.gov |
| `fetch-executive-orders` | Every 12 hours | Fetch executive orders from Federal Register  |
| `batch-summarize-bills`  | Daily at 2 AM  | Fan-out job to queue bill summarizations      |
| `summarize-bill`         | On demand      | Generate AI summaries for individual bills    |
| `categorize-bill`        | On demand      | Auto-categorize bills using AI                |

Jobs are defined in `src/jobs/` and registered in `src/inngest/functions.ts`.

### Manual Data Management

For testing and initial setup, use these scripts:

```bash
# Fetch bills from Congress.gov
npm run fetch-bills              # Fetch 100 bills (configurable)
npm run fetch-bills-recent       # Fetch last 30 days only (for testing)

# Generate AI summaries
npm run summarize-bills          # Summarize 3 bills (configurable)

# Examples with custom limits
LIMIT=250 npm run fetch-bills    # Fetch 250 bills
BATCH_SIZE=5 npm run summarize-bills  # Summarize 5 bills
```

See [`scripts/README.md`](scripts/README.md) for detailed documentation.

### Typical Testing Workflow

```bash
# 1. Set up database
npm run db:push && npm run db:seed

# 2. Fetch recent bills
npm run fetch-bills-recent

# 3. Generate summaries for testing
npm run summarize-bills

# 4. Start dev server
npm run dev
```

## 🎯 API Routes

### Bills

- `GET /api/bills` - List bills with pagination and filtering
  - Query params: `page`, `limit`, `status`, `category`, `congress`, `search`
- `GET /api/bills/[id]` - Get bill details with full relationships

### Search

- `GET /api/search?q=query` - Search across bills and executive orders
  - Query params: `q` (query), `type` (bills|executive-orders|all)

### Categories

- `GET /api/categories` - List all categories with bill counts

## 🎨 UI Components

Reusable components built with shadcn/ui:

- **BillCard**: Displays bill summary with status, categories, and sponsor
- **BillList**: Grid of bill cards with loading states
- **StatusBadge**: Colored badge showing bill status
- **SearchBar**: Live search with debouncing
- **FilterPanel**: Sidebar filters for status, category, and congress

## 🔧 Development Scripts

### Core Development

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
```

### Database Management

```bash
npm run db:generate  # Generate Prisma client
npm run db:push      # Push schema to database (dev)
npm run db:migrate   # Run migrations (prod)
npm run db:studio    # Open Prisma Studio
npm run db:seed      # Seed initial data
```

### Data Collection & AI Processing

````bash
### Data Collection & AI Processing
```bash
# Fetch bills from Congress.gov
npm run fetch-bills              # Fetch 100 bills (default)
npm run fetch-bills-recent       # Last 30 days only

# Generate AI summaries (compares Claude vs GPT-5-nano)
npm run summarize-bills          # Summarize 3 bills (default)

# With custom parameters
LIMIT=250 npm run fetch-bills           # Fetch 250 bills
BATCH_SIZE=10 npm run summarize-bills   # Summarize 10 bills
````

**Note**: The summarize script generates summaries with **both** Claude 3.5 Sonnet and GPT-5-nano for cost/quality comparison. See [`docs/AI_MODEL_COMPARISON.md`](docs/AI_MODEL_COMPARISON.md) for details.

See [`scripts/README.md`](scripts/README.md) for detailed usage.

````

See [`scripts/README.md`](scripts/README.md) for detailed usage.

## 🚢 Deployment

### Recommended Stack

- **Frontend/API**: Vercel
- **Database**: Neon, Supabase, or Railway
- **Background Jobs**: Inngest Cloud
- **Caching**: Vercel KV (optional)

### Environment Variables for Production

Ensure all environment variables from `.env.example` are configured in your deployment platform.

### Database Migrations

Run migrations before deploying:

```bash
npx prisma migrate deploy
````

## 📚 Additional Documentation

See `architecture.md` for comprehensive technical documentation including:

- Detailed system architecture
- Data source integration details
- AI summarization pipeline
- Background job processing
- Performance optimization strategies
- Security considerations
- Future enhancement roadmap

## 🤝 Contributing

This is a reference implementation based on the architecture document. To extend:

1. Add new background jobs in `src/jobs/`
2. Create new API routes in `src/app/api/`
3. Build additional UI components
4. Extend the database schema in `prisma/schema.prisma`

## 📄 License

MIT License - See LICENSE file for details

## 🙏 Acknowledgments

- Data from [Congress.gov](https://www.congress.gov/)
- Executive orders from [Federal Register](https://www.federalregister.gov/)
- Built with [Next.js](https://nextjs.org/), [Prisma](https://www.prisma.io/), and [shadcn/ui](https://ui.shadcn.com/)
- AI powered by [Anthropic Claude](https://www.anthropic.com/)

## 📞 Support

For questions or issues, please refer to the architecture document or create an issue in the repository.

---

**Built following the comprehensive architecture specification in `architecture.md`**
