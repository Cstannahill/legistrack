# Quick Start Guide - Legislation Tracker

## 🚀 Getting Started in 5 Minutes

### Step 1: Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Edit .env and add your API keys:
# - DATABASE_URL (PostgreSQL connection)
# - CONGRESS_API_KEY (from api.congress.gov)
# - ANTHROPIC_API_KEY (from console.anthropic.com)
# - INNGEST_EVENT_KEY & INNGEST_SIGNING_KEY (from inngest.com)
```

### Step 2: Database Setup

```bash
# Initialize database
npm run db:push

# Seed with categories
npm run db:seed
```

### Step 3: Fetch Test Data

```bash
# Fetch bills from last 30 days
npm run fetch-bills-recent

# Generate AI summaries for 3 bills
npm run summarize-bills
```

### Step 4: Start Development Server

```bash
npm run dev
```

Visit **http://localhost:3000** 🎉

---

## 📋 Script Reference

### Bill Fetching

| Script                          | What It Does              | Use Case                 |
| ------------------------------- | ------------------------- | ------------------------ |
| `npm run fetch-bills`           | Fetch 100 bills (default) | Initial data load        |
| `npm run fetch-bills-recent`    | Last 30 days only         | Testing without overload |
| `LIMIT=250 npm run fetch-bills` | Fetch 250 bills           | Full data load           |

### AI Summarization

| Script                                  | What It Does       | Use Case            |
| --------------------------------------- | ------------------ | ------------------- |
| `npm run summarize-bills`               | Summarize 3 bills  | Testing AI pipeline |
| `BATCH_SIZE=10 npm run summarize-bills` | Summarize 10 bills | Larger test batch   |

### Database

| Script               | What It Does       | Use Case        |
| -------------------- | ------------------ | --------------- |
| `npm run db:push`    | Sync schema to DB  | Development     |
| `npm run db:migrate` | Create migration   | Production      |
| `npm run db:seed`    | Add categories     | Initial setup   |
| `npm run db:studio`  | Open Prisma Studio | Data inspection |

---

## 🔄 Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUTOMATED PIPELINE                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [Congress.gov]                                                  │
│       ↓                                                          │
│  fetch-bills (every 6h)                                         │
│       ↓                                                          │
│  [PostgreSQL Database]                                          │
│       ↓                                                          │
│  batch-summarize-bills (daily 2am)  ← Fan-out Pattern          │
│       ↓                                                          │
│  summarize-bill (parallel) → [Claude API]                      │
│       ↓                                                          │
│  categorize-bill (parallel) → [Claude API]                     │
│       ↓                                                          │
│  [Database with Summaries]                                      │
│       ↓                                                          │
│  [Next.js App - User Interface]                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Manual Override (Testing)

```
[You] → npm run fetch-bills-recent → [Database]
                                         ↓
[You] → npm run summarize-bills → [Claude API] → [Database]
                                         ↓
                                   [Next.js App]
```

---

## 🎯 Common Workflows

### First Time Setup

```bash
npm install
npm run db:push
npm run db:seed
npm run fetch-bills-recent    # Get ~10-20 bills
npm run summarize-bills        # Summarize 3 bills
npm run dev                    # View at localhost:3000
```

### Testing New Features

```bash
# Fetch fresh data
npm run fetch-bills-recent

# Test AI with small batch
BATCH_SIZE=5 npm run summarize-bills

# View results
npm run dev
```

### Full Data Load (Production-like)

```bash
# Fetch 250 bills
LIMIT=250 npm run fetch-bills

# Let automated job handle summarization
# Or process manually in batches:
BATCH_SIZE=25 npm run summarize-bills
```

### Reset Everything

```bash
# WARNING: Deletes all data!
npm run db:push --force-reset
npm run db:seed
npm run fetch-bills-recent
npm run summarize-bills
```

---

## 💡 Pro Tips

### 1. Start Small

- Use `fetch-bills-recent` for testing
- Only summarize 3-5 bills at a time during development
- Scale up once everything works

### 2. Monitor Costs

- Each bill summary costs ~$0.015 (3 summaries @ $0.005 each)
- 100 bills ≈ $5
- Use `BATCH_SIZE` to control AI costs

### 3. Use Prisma Studio

```bash
npm run db:studio
```

- Visual database browser
- Great for debugging
- See all data relationships

### 4. Check Logs

- Scripts have detailed console output
- Watch for API rate limits
- Monitor Inngest dashboard for job status

### 5. Development Flow

1. **Morning**: Fetch recent bills
2. **Test**: Summarize a few
3. **Develop**: Build features with real data
4. **Deploy**: Let automated jobs handle ongoing sync

---

## 🐛 Troubleshooting

### No bills fetched?

- ✅ Check `CONGRESS_API_KEY` in `.env`
- ✅ Congress may not be in session (try older congress number)
- ✅ Check API rate limits

### Summarization fails?

- ✅ Check `ANTHROPIC_API_KEY` in `.env`
- ✅ Reduce `BATCH_SIZE` (rate limits)
- ✅ Some bills lack full text (normal, script handles it)

### Database errors?

- ✅ Run `npm run db:push`
- ✅ Check `DATABASE_URL` in `.env`
- ✅ Ensure PostgreSQL is running

### Page shows "No bills found"?

- ✅ Run `npm run fetch-bills-recent` first
- ✅ Check database has data: `npm run db:studio`
- ✅ Try different filters on the page

---

## 📚 Next Steps

1. ✅ **Complete Setup** - Follow steps above
2. 📖 **Read Architecture** - See `architecture.md` for system design
3. 🔧 **Customize** - Modify AI prompts, add features
4. 🚀 **Deploy** - See deployment section in main README
5. 📊 **Monitor** - Set up Inngest for production jobs

---

## 🆘 Need Help?

- 📖 **Detailed Scripts**: See `scripts/README.md`
- 🏗️ **Architecture**: See `architecture.md`
- 🔧 **Main README**: See `README.md`
- 🐛 **Issues**: Check terminal logs and Prisma Studio

---

**Happy Coding! 🎉**
