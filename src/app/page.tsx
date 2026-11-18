import Link from "next/link"
// Revalidate this page every 60 seconds in production so counts and recent items stay fresh
export const revalidate = 60

import {
  ArrowRight,
  BookOpen,
  FileSearch,
  Landmark,
  Layers,
  Search,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/bills/StatusBadge"
import { CategoryBadge } from "@/components/bills/CategoryBadge"
import { db } from "@/lib/db"
import { CURRENT_CONGRESS } from "@/lib/constants"
import { get_count_complete_legislation } from "@/lib/stats"
import { fetchSummaryPreviews } from "@/lib/queries/legislation-summaries"
import { getAllCategories } from "@/lib/utils/category-helper"
import { formatDate } from "@/lib/utils/date"
import { formatCount, formatSponsorLabel, truncate } from "@/lib/utils/formatting"

interface UnifiedHomeRow {
  id: string
  kind: "bill" | "executiveOrder"
  billType: string | null
  billNumber: string | null
  congress: number | null
  title: string
  currentStatus: string | null
  sort_date: string
  presidentName: string | null
  categories: Array<{ id: string; name: string; slug: string }> | null
  sponsor: { fullName: string; party: string; state: string } | null
}

async function getHomeData() {
  const [completeCount, eoCount, enactedCount, recentRows] = await Promise.all([
    get_count_complete_legislation().catch(() => 0),
    db.executiveOrder
      .count({
        where: {
          fullText: { not: null },
          summaries: { some: {} },
        },
      })
      .catch(() => 0),
    db.bill
      .count({
        where: {
          currentStatus: "BECAME_LAW",
          fullText: { not: null },
        },
      })
      .catch(() => 0),
    db.$queryRaw<UnifiedHomeRow[]>`
      SELECT * FROM get_bills_and_orders(
        0::int,
        4::int,
        NULL::public."BillStatus",
        NULL::text,
        ${CURRENT_CONGRESS}::int,
        NULL::text,
        NULL::text,
        NULL::text,
        NULL::text,
        NULL::date,
        NULL::date,
        'introducedDate'::text,
        'desc'::text
      )
    `.catch(() => [] as UnifiedHomeRow[]),
  ])

  const billIds = recentRows.filter((r) => r.kind === "bill").map((r) => r.id)
  const eoIds = recentRows
    .filter((r) => r.kind === "executiveOrder")
    .map((r) => r.id)

  const { billSummaries, eoSummaries } = await fetchSummaryPreviews(billIds, eoIds)

  const recentItems = recentRows.map((row) => {
    const summary =
      row.kind === "bill"
        ? billSummaries.get(row.id)
        : eoSummaries.get(row.id)
    return {
      ...row,
      categories: Array.isArray(row.categories) ? row.categories : [],
      summary,
    }
  })

  return {
    completeCount,
    eoCount,
    enactedCount,
    recentItems,
  }
}

export default async function HomePage() {
  const { completeCount, eoCount, enactedCount, recentItems } = await getHomeData()
  const featured = recentItems[0]
  const showcaseItems = recentItems.slice(0, 3)
  const categories = getAllCategories()

  return (
    <div className="flex flex-col">
      {/* Split Hero Section */}
      <section className="relative overflow-hidden border-b border-border/60 bg-gradient-to-b from-card via-background to-background py-14 md:py-20 lg:py-24">
        <div className="container">
          <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-12">
            {/* Hero Copy & Quick Search */}
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-xs font-medium text-primary">
                <Landmark className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{CURRENT_CONGRESS}th U.S. Congress &amp; Executive Actions</span>
              </div>

              <h1 className="font-serif text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-[3.5rem] lg:leading-[1.08]">
                Federal legislation, translated into plain English.
              </h1>

              <p className="max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                Read clear, structured AI summaries alongside full legislative text from Congress.gov and the Federal Register — always free and open to everyone.
              </p>

              {/* Inline quick search */}
              <form
                action="/bills"
                method="get"
                className="flex flex-col gap-2.5 sm:flex-row sm:max-w-xl"
                role="search"
                aria-label="Quick legislation search"
              >
                <div className="relative flex-1">
                  <Search
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    name="search"
                    placeholder='Search by topic, bill # (HR 4398), or "exact phrase"...'
                    aria-label="Search legislation"
                    className="h-11 w-full rounded-lg border border-input bg-card pl-10 pr-4 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none"
                  />
                </div>
                <Button type="submit" size="lg" className="h-11 px-6">
                  Search
                </Button>
              </form>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button asChild size="lg" variant="default">
                  <Link href="/bills">
                    Browse all legislation
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/bills?type=EXECUTIVE_ORDERS">
                    Executive orders
                  </Link>
                </Button>
              </div>
            </div>

            {/* Live Featured Summary Preview */}
            <div className="lg:col-span-5">
              {featured ? (
                <Link
                  href={
                    featured.kind === "executiveOrder"
                      ? `/bills/eo/${featured.id}`
                      : `/bills/${featured.id}`
                  }
                  className="group block"
                >
                  <article className="rounded-xl border border-border bg-card p-6 shadow-sm transition-all duration-150 group-hover:border-primary/40 group-hover:shadow-md">
                    <div className="mb-4 flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-primary">
                        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                        Latest AI Brief
                      </span>
                      {featured.kind === "bill" && featured.currentStatus ? (
                        <StatusBadge status={featured.currentStatus} />
                      ) : (
                        <Badge variant="outline" className="font-mono text-xs">
                          Executive Order
                        </Badge>
                      )}
                    </div>

                    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded border border-border bg-muted/60 px-2 py-0.5 font-mono font-medium text-foreground">
                        {featured.kind === "executiveOrder"
                          ? `EO ${featured.billNumber ?? ""}`
                          : `${featured.billType?.toUpperCase() ?? ""} ${featured.billNumber ?? ""}`}
                      </span>
                      <span>&middot;</span>
                      <span>{formatDate(featured.sort_date)}</span>
                    </div>

                    <h2 className="font-serif text-xl font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
                      {truncate(featured.title, 115)}
                    </h2>

                    {featured.summary?.content && (
                      <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-muted-foreground">
                        {featured.summary.content}
                      </p>
                    )}

                    {featured.summary?.keyPoints && featured.summary.keyPoints.length > 0 && (
                      <div className="mt-4 rounded-lg border border-border/70 bg-muted/40 p-3.5">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Key Takeaways
                        </div>
                        <ul className="space-y-1.5 text-xs leading-relaxed text-foreground/85">
                          {featured.summary.keyPoints.slice(0, 2).map((point, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                              <span className="line-clamp-2">{point}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-between border-t border-border/70 pt-3 text-xs text-muted-foreground">
                      <span className="truncate">
                        {featured.kind === "executiveOrder"
                          ? featured.presidentName
                          : formatSponsorLabel(featured.sponsor) || "U.S. Congress"}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 font-medium text-primary">
                        Read brief
                        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                      </span>
                    </div>
                  </article>
                </Link>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-card/60 p-8 text-center">
                  <BookOpen className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground">
                    Browse thousands of summarized federal bills and executive orders.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Real Stats Strip */}
          <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
            <div className="bg-card px-6 py-5">
              <div className="font-serif text-3xl font-semibold tracking-tight text-foreground tabular-nums sm:text-4xl">
                {formatCount(completeCount)}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Pieces of legislation summarized with full text
              </div>
            </div>
            <div className="bg-card px-6 py-5">
              <div className="font-serif text-3xl font-semibold tracking-tight text-foreground tabular-nums sm:text-4xl">
                {formatCount(enactedCount)}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Bills enacted into federal law tracked
              </div>
            </div>
            <div className="bg-card px-6 py-5">
              <div className="font-serif text-3xl font-semibold tracking-tight text-foreground tabular-nums sm:text-4xl">
                {formatCount(eoCount)}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Presidential actions &amp; executive orders indexed
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Recently Summarized Strip */}
      {showcaseItems.length > 0 && (
        <section className="py-14 md:py-16">
          <div className="container">
            <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  Recently Summarized
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  The latest bills and executive actions with plain-English briefs.
                </p>
              </div>
              <Link
                href="/bills"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                View all legislation
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              {showcaseItems.map((item) => {
                const href =
                  item.kind === "executiveOrder"
                    ? `/bills/eo/${item.id}`
                    : `/bills/${item.id}`
                const idLabel =
                  item.kind === "executiveOrder"
                    ? `EO ${item.billNumber ?? ""}`
                    : `${item.billType?.toUpperCase() ?? ""} ${item.billNumber ?? ""}`

                return (
                  <Link key={item.id} href={href} className="group block h-full">
                    <article className="lt-card p-5">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <Badge variant="outline" className="font-mono text-xs">
                          {idLabel}
                        </Badge>
                        {item.kind === "bill" && item.currentStatus ? (
                          <StatusBadge status={item.currentStatus} />
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            Executive Order
                          </Badge>
                        )}
                      </div>

                      <h3 className="font-serif text-lg font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
                        {truncate(item.title, 100)}
                      </h3>

                      {item.summary?.content && (
                        <p className="mt-2.5 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                          {item.summary.content}
                        </p>
                      )}

                      {item.categories.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-1.5">
                          {item.categories.slice(0, 2).map((cat) => (
                            <CategoryBadge key={cat.id} category={cat} />
                          ))}
                        </div>
                      )}

                      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/70 pt-3 mt-4 text-xs text-muted-foreground">
                        <span className="truncate">
                          {item.kind === "executiveOrder"
                            ? item.presidentName
                            : formatSponsorLabel(item.sponsor) || `${item.congress ?? CURRENT_CONGRESS}th Congress`}
                        </span>
                        <span className="shrink-0 font-mono tabular-nums">
                          {formatDate(item.sort_date)}
                        </span>
                      </div>
                    </article>
                  </Link>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* 3-Step How It Works */}
      <section className="border-y border-border/60 bg-muted/40 py-14 md:py-16">
        <div className="container">
          <div className="mb-10 max-w-2xl">
            <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              How LegisTrack works
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Turning dense legislative filings into structured, scannable civic briefs in three automated steps.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="mb-4 flex items-center justify-between">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FileSearch className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="font-mono text-xs font-semibold text-muted-foreground">
                  01
                </span>
              </div>
              <h3 className="text-base font-semibold text-foreground">
                Ingest Official Texts
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                We sync federal bills, actions, sponsors, and executive orders directly from Congress.gov and the Federal Register.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-6">
              <div className="mb-4 flex items-center justify-between">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <BookOpen className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="font-mono text-xs font-semibold text-muted-foreground">
                  02
                </span>
              </div>
              <h3 className="text-base font-semibold text-foreground">
                Generate Plain-English Briefs
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Each bill is distilled into Brief, Standard, and Detailed summaries with key points and impact areas alongside the source text.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-6">
              <div className="mb-4 flex items-center justify-between">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Layers className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="font-mono text-xs font-semibold text-muted-foreground">
                  03
                </span>
              </div>
              <h3 className="text-base font-semibold text-foreground">
                Filter by Topic &amp; Status
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Search by bill number, exact phrase, or policy category and follow legislative progress from introduction to law.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Browse by Policy Area */}
      <section className="py-14 md:py-16">
        <div className="container">
          <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                Browse by policy area
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Jump straight into bills and executive orders tagged under a topic.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {categories.map((cat) => (
              <CategoryBadge
                key={cat.id}
                category={cat}
                linked
                className="px-3.5 py-1.5 text-sm"
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
