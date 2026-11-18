// Bills List Page
import { Suspense } from "react"
import { db } from "@/lib/db"
import { ImprovedBillList } from "@/components/bills/ImprovedBillList"
import { Pagination } from "@/components/bills/Pagination"
import { SearchBar } from "@/components/search/SearchBar"
import { FilterPanel } from "@/components/search/FilterPanel"
import { MobileFilterDrawer } from "@/components/search/MobileFilterDrawer"
import { ActiveFiltersBar } from "@/components/search/ActiveFiltersBar"
import { CURRENT_CONGRESS, CACHE_DURATIONS } from "@/lib/constants"
import { cachedCount } from "@/lib/countCache"
import { fetchSummaryPreviews } from "@/lib/queries/legislation-summaries"
import { getAllCategories, getCategoryBySlug, type CategorySlug } from "@/lib/utils/category-helper"
import type { BillListItem, ExecutiveOrderListItem, LegislationListItem } from "@/types/legislation"

interface PageProps {
    searchParams: Promise<{
        page?: string
        type?: string
        status?: string
        category?: string
        congress?: string
        search?: string
        showIncomplete?: string
        sort?: string
        view?: string
    }>
}

function buildBillSearchWhere(searchQuery: string): Record<string, unknown> {
    const quotedMatch = searchQuery.match(/^["'](.+)["']$/)
    const isExactWordMatch = Boolean(quotedMatch)
    const searchTerm = quotedMatch ? quotedMatch[1] : searchQuery
    const cleanedSearchTerm = searchTerm.replace(/\./g, "").trim()
    const billNumberMatch = cleanedSearchTerm.match(/^([A-Z]+)?\s*(\d+)$/i)

    if (billNumberMatch) {
        const billType = billNumberMatch[1]?.toUpperCase()
        const billNumberStr = billNumberMatch[2]
        const billNumber = parseInt(billNumberStr, 10)
        const numDigits = billNumberStr.length
        const rangeStart = billNumber * Math.pow(10, Math.max(0, 4 - numDigits))
        const rangeEnd = rangeStart + Math.pow(10, Math.max(0, 4 - numDigits))

        if (billType) {
            return {
                OR: [
                    {
                        AND: [
                            { billType: { equals: billType, mode: "insensitive" } },
                            { billNumber },
                        ],
                    },
                    {
                        AND: [
                            { billType: { equals: billType, mode: "insensitive" } },
                            { billNumber: { gte: rangeStart, lt: rangeEnd } },
                        ],
                    },
                ],
            }
        }
        return {
            OR: [
                { billNumber },
                { billNumber: { gte: rangeStart, lt: rangeEnd } },
            ],
        }
    }

    if (isExactWordMatch) {
        return {
            OR: [
                { title: { contains: ` ${searchTerm} `, mode: "insensitive" } },
                { title: { startsWith: `${searchTerm} `, mode: "insensitive" } },
                { title: { endsWith: ` ${searchTerm}`, mode: "insensitive" } },
                { officialTitle: { contains: ` ${searchTerm} `, mode: "insensitive" } },
                { officialTitle: { startsWith: `${searchTerm} `, mode: "insensitive" } },
                { officialTitle: { endsWith: ` ${searchTerm}`, mode: "insensitive" } },
            ],
        }
    }

    return {
        OR: [
            { title: { contains: searchTerm, mode: "insensitive" } },
            { officialTitle: { contains: searchTerm, mode: "insensitive" } },
        ],
    }
}

function buildEoSearchWhere(searchQuery: string): Record<string, unknown> {
    const quotedMatch = searchQuery.match(/^["'](.+)["']$/)
    const isExactWordMatch = Boolean(quotedMatch)
    const searchTerm = quotedMatch ? quotedMatch[1] : searchQuery
    const cleanedSearchTerm = searchTerm.replace(/\./g, "").trim()
    const eoNumberMatch = cleanedSearchTerm.match(/^(?:EO)?\s*(\d+)$/i)

    if (eoNumberMatch) {
        const orderNumber = parseInt(eoNumberMatch[1], 10)
        const numDigits = eoNumberMatch[1].length
        if (numDigits < 5) {
            const rangeStart = orderNumber * Math.pow(10, Math.max(0, 5 - numDigits))
            const rangeEnd = rangeStart + Math.pow(10, Math.max(0, 5 - numDigits))
            return {
                OR: [
                    { orderNumber },
                    { orderNumber: { gte: rangeStart, lt: rangeEnd } },
                ],
            }
        }
        return { orderNumber }
    }

    if (isExactWordMatch) {
        return {
            OR: [
                { title: { contains: ` ${searchTerm} `, mode: "insensitive" } },
                { title: { startsWith: `${searchTerm} `, mode: "insensitive" } },
                { title: { endsWith: ` ${searchTerm}`, mode: "insensitive" } },
            ],
        }
    }

    return { title: { contains: searchTerm, mode: "insensitive" } }
}

export default async function BillsPage({ searchParams }: PageProps) {
    const params = await searchParams
    const parsedPage = parseInt(params.page || "1", 10)
    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1
    const limit = 20
    const skip = (page - 1) * limit
    const legislationType = params.type || "ALL"
    const showIncomplete = params.showIncomplete === "true"
    const searchQuery = params.search?.trim()
    const hasSearchQuery = Boolean(searchQuery)
    const sortParam =
        params.sort === "oldest" || params.sort === "updated" ? params.sort : "newest"
    const viewMode: "list" | "grid" = params.view === "grid" ? "grid" : "list"

    const hasCongressFilter = Boolean(params.congress)
    const shouldFetchBills = legislationType === "ALL" || legislationType === "BILLS"
    const shouldFetchEOs =
        legislationType === "EXECUTIVE_ORDERS" ||
        (legislationType === "ALL" && !params.status && !hasCongressFilter)

    const billWhere: Record<string, unknown> = {}
    const requireCompleteBills = shouldFetchBills && !showIncomplete && !hasSearchQuery
    if (requireCompleteBills) {
        billWhere.fullText = { not: null }
    }
    if (params.status) billWhere.currentStatus = params.status
    if (params.congress) billWhere.congress = parseInt(params.congress, 10)
    else if (shouldFetchBills) billWhere.congress = CURRENT_CONGRESS
    if (params.category && shouldFetchBills) {
        billWhere.categories = { some: { slug: params.category } }
    }
    if (hasSearchQuery && shouldFetchBills && searchQuery) {
        Object.assign(billWhere, buildBillSearchWhere(searchQuery))
    }

    const eoWhere: Record<string, unknown> = {}
    if (!showIncomplete && !hasSearchQuery) {
        eoWhere.fullText = { not: null }
    }
    if (params.category && shouldFetchEOs) {
        eoWhere.categories = { some: { slug: params.category } }
    }
    if (hasSearchQuery && shouldFetchEOs && searchQuery) {
        Object.assign(eoWhere, buildEoSearchWhere(searchQuery))
    }

    const fallbackCategories = getAllCategories().map((cat) => ({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        color: cat.color,
    }))

    const useUnifiedSql =
        legislationType === "ALL" && !params.status && !params.congress && !showIncomplete

    const [billCount, eoCount, dbCategories] = await Promise.all([
        !useUnifiedSql && shouldFetchBills
            ? cachedCount(
                  `billCount:${JSON.stringify(billWhere)}`,
                  CACHE_DURATIONS.BILLS_LIST * 1000,
                  () => db.bill.count({ where: billWhere })
              )
            : Promise.resolve(0),
        !useUnifiedSql && shouldFetchEOs
            ? cachedCount(
                  `eoCount:${JSON.stringify(eoWhere)}`,
                  CACHE_DURATIONS.BILLS_LIST * 1000,
                  () => db.executiveOrder.count({ where: eoWhere })
              )
            : Promise.resolve(0),
        db.category
            .findMany({
                orderBy: { name: "asc" },
                select: { id: true, name: true, slug: true, color: true },
            })
            .catch((error) => {
                console.error("Failed to load categories from DB, using fallback list", error)
                return fallbackCategories
            }),
    ])

    const categories = dbCategories.map((cat) => {
        const helperData = getCategoryBySlug(cat.slug as CategorySlug)
        return {
            ...cat,
            color: helperData?.color || cat.color,
        }
    })

    const billSelect = {
        id: true,
        billType: true,
        billNumber: true,
        congress: true,
        title: true,
        currentStatus: true,
        introducedDate: true,
        updatedAt: true,
        fullText: true,
        sponsor: { select: { fullName: true, party: true, state: true } },
        categories: { select: { id: true, name: true, slug: true, color: true } },
        summaries: { where: { summaryType: "BRIEF" as const }, take: 1, select: { summaryType: true, content: true } },
    } as const

    const eoSelect = {
        id: true,
        orderNumber: true,
        executiveOrderType: true,
        title: true,
        signingDate: true,
        updatedAt: true,
        presidentName: true,
        fullText: true,
        categories: { select: { id: true, name: true, slug: true, color: true } },
        summaries: { where: { summaryType: "BRIEF" as const }, take: 1, select: { summaryType: true, content: true } },
    } as const

    let items: LegislationListItem[] = []
    let total = 0

    const sqlSortField = sortParam === "updated" ? "updatedAt" : "introducedDate"
    const sqlSortDir = sortParam === "oldest" ? "asc" : "desc"

    if (useUnifiedSql) {
        interface UnifiedRow {
            id: string
            kind: "bill" | "executiveOrder"
            billType: string | null
            billNumber: string | null
            congress: number | null
            title: string
            currentStatus: string | null
            sort_date: string
            categories: { id: string; name: string; slug: string }[] | null
            sponsor: { fullName: string; party: string; state: string } | null
            presidentName?: string | null
            total_count: bigint | number
        }

        const billCongress = params.congress ? parseInt(params.congress, 10) : CURRENT_CONGRESS
        const unified = await db.$queryRaw<UnifiedRow[]>`
            SELECT * FROM get_bills_and_orders(
                ${skip}::int,
                ${limit}::int,
                ${params.status || null}::public."BillStatus",
                ${params.category || null}::text,
                ${billCongress}::int,
                ${hasSearchQuery && searchQuery ? searchQuery : null}::text,
                ${params.category || null}::text,
                ${null}::text,
                ${hasSearchQuery && searchQuery ? searchQuery : null}::text,
                ${null}::date,
                ${null}::date,
                ${sqlSortField}::text,
                ${sqlSortDir}::text
            )`

        total = unified[0]?.total_count ? Number(unified[0].total_count) : 0

        const billIds = unified.filter((r) => r.kind === "bill").map((r) => r.id)
        const eoIds = unified.filter((r) => r.kind === "executiveOrder").map((r) => r.id)
        const { billSummaries, eoSummaries } = await fetchSummaryPreviews(billIds, eoIds)

        items = unified.map((r): LegislationListItem => {
            if (r.kind === "bill") {
                const summary = billSummaries.get(r.id)
                return {
                    type: "bill",
                    id: r.id,
                    billType: r.billType || "",
                    billNumber: r.billNumber ? parseInt(r.billNumber, 10) : 0,
                    congress: r.congress || 0,
                    title: r.title,
                    currentStatus: r.currentStatus || "",
                    introducedDate: new Date(r.sort_date),
                    fullText: "present",
                    categories: Array.isArray(r.categories) ? r.categories : [],
                    sponsor: r.sponsor
                        ? {
                              fullName: r.sponsor.fullName,
                              party: r.sponsor.party,
                              state: r.sponsor.state,
                          }
                        : null,
                    summaries: summary ? [summary] : [],
                }
            }

            const summary = eoSummaries.get(r.id)
            return {
                type: "executiveOrder",
                id: r.id,
                orderNumber: r.billNumber ? parseInt(r.billNumber, 10) : 0,
                executiveOrderType: "EXECUTIVE_ORDER",
                title: r.title,
                signingDate: new Date(r.sort_date),
                presidentName: r.presidentName || "",
                fullText: "present",
                categories: Array.isArray(r.categories) ? r.categories : [],
                summaries: summary ? [summary] : [],
            }
        })
    } else if (legislationType === "EXECUTIVE_ORDERS") {
        if (!showIncomplete) {
            interface EORow {
                id: string
                billNumber: string | null
                title: string
                sort_date: string
                presidentName: string | null
                categories: { id: string; name: string; slug: string }[] | null
                total_count: bigint | number
            }
            const eoSortField = sortParam === "updated" ? "updatedAt" : "signingDate"
            const eoRows = await db.$queryRaw<EORow[]>`
                SELECT * FROM get_executive_orders(
                    ${skip}::int,
                    ${limit}::int,
                    ${params.category || null}::text,
                    ${null}::text,
                    ${hasSearchQuery && searchQuery ? searchQuery : null}::text,
                    ${null}::date,
                    ${null}::date,
                    ${eoSortField}::text,
                    ${sqlSortDir}::text
                )`

            total = eoRows[0]?.total_count ? Number(eoRows[0].total_count) : eoCount
            const eoIds = eoRows.map((r) => r.id)
            const { eoSummaries } = await fetchSummaryPreviews([], eoIds)

            items = eoRows.map((r): ExecutiveOrderListItem => {
                const summary = eoSummaries.get(r.id)
                return {
                    type: "executiveOrder",
                    id: r.id,
                    orderNumber: r.billNumber ? parseInt(r.billNumber, 10) : 0,
                    executiveOrderType: "EXECUTIVE_ORDER",
                    title: r.title,
                    signingDate: new Date(r.sort_date),
                    presidentName: r.presidentName || "",
                    fullText: "present",
                    categories: Array.isArray(r.categories) ? r.categories : [],
                    summaries: summary ? [summary] : [],
                }
            })
        } else {
            const eoOrderBy =
                sortParam === "updated"
                    ? [{ updatedAt: "desc" as const }, { id: "desc" as const }]
                    : sortParam === "oldest"
                        ? [{ signingDate: "asc" as const }, { id: "asc" as const }]
                        : [{ signingDate: "desc" as const }, { id: "desc" as const }]
            const rows = await db.executiveOrder.findMany({
                where: eoWhere,
                skip,
                take: limit,
                orderBy: eoOrderBy,
                select: eoSelect,
            })
            total = eoCount
            items = rows.map((e) => ({ type: "executiveOrder", ...e }))
        }
    } else if (legislationType === "BILLS" || !shouldFetchEOs) {
        const simpleBills =
            !params.status &&
            !params.search &&
            !params.category &&
            !params.congress &&
            !showIncomplete &&
            sortParam === "newest"

        if (simpleBills) {
            interface BillRow {
                id: string
                billType: string | null
                billNumber: string | null
                congress: number | null
                title: string
                currentStatus: string | null
                sort_date: string
                categories: { id: string; name: string; slug: string }[] | null
                sponsor: { fullName: string; party: string; state: string } | null
                total_count: bigint | number
            }
            const billRows = await db.$queryRaw<BillRow[]>`
                SELECT * FROM get_bills(
                    ${skip}::int,
                    ${limit}::int,
                    NULL::public."BillStatus",
                    NULL::text,
                    NULL::int,
                    NULL::text,
                    ${"introducedDate"}::text,
                    ${"desc"}::text
                )`

            total = billRows[0]?.total_count ? Number(billRows[0].total_count) : billCount
            const billIds = billRows.map((r) => r.id)
            const { billSummaries } = await fetchSummaryPreviews(billIds, [])

            items = billRows.map((r): BillListItem => {
                const summary = billSummaries.get(r.id)
                return {
                    type: "bill",
                    id: r.id,
                    billType: r.billType || "",
                    billNumber: r.billNumber ? parseInt(r.billNumber, 10) : 0,
                    congress: r.congress || 0,
                    title: r.title,
                    currentStatus: r.currentStatus || "",
                    introducedDate: new Date(r.sort_date),
                    fullText: "present",
                    sponsor: r.sponsor
                        ? {
                              fullName: r.sponsor.fullName,
                              party: r.sponsor.party,
                              state: r.sponsor.state,
                          }
                        : null,
                    categories: Array.isArray(r.categories) ? r.categories : [],
                    summaries: summary ? [summary] : [],
                }
            })
        } else {
            const billOrderBy =
                sortParam === "updated"
                    ? [{ updatedAt: "desc" as const }, { id: "desc" as const }]
                    : sortParam === "oldest"
                        ? [{ introducedDate: "asc" as const }, { id: "asc" as const }]
                        : [{ introducedDate: "desc" as const }, { id: "desc" as const }]

            const rows = await db.bill.findMany({
                where: billWhere,
                skip,
                take: limit,
                orderBy: billOrderBy,
                select: billSelect,
            })
            total = billCount
            items = rows.map((b) => ({ type: "bill", ...b }))
        }
    } else {
        // Unified fallback when showIncomplete=true
        const windowSize = skip + limit
        const billOrderBy =
            sortParam === "updated"
                ? [{ updatedAt: "desc" as const }, { id: "desc" as const }]
                : sortParam === "oldest"
                    ? [{ introducedDate: "asc" as const }, { id: "asc" as const }]
                    : [{ introducedDate: "desc" as const }, { id: "desc" as const }]
        const eoOrderBy =
            sortParam === "updated"
                ? [{ updatedAt: "desc" as const }, { id: "desc" as const }]
                : sortParam === "oldest"
                    ? [{ signingDate: "asc" as const }, { id: "asc" as const }]
                    : [{ signingDate: "desc" as const }, { id: "desc" as const }]

        const [bills, eos] = await Promise.all([
            db.bill.findMany({ where: billWhere, take: windowSize, orderBy: billOrderBy, select: billSelect }),
            db.executiveOrder.findMany({ where: eoWhere, take: windowSize, orderBy: eoOrderBy, select: eoSelect }),
        ])

        const merged = [
            ...bills.map((b) => ({
                item: { type: "bill" as const, ...b } satisfies BillListItem,
                sortTime: (sortParam === "updated" ? b.updatedAt : b.introducedDate).getTime(),
            })),
            ...eos.map((e) => ({
                item: { type: "executiveOrder" as const, ...e } satisfies ExecutiveOrderListItem,
                sortTime: (sortParam === "updated" ? e.updatedAt : e.signingDate).getTime(),
            })),
        ].sort((a, b) =>
            sortParam === "oldest" ? a.sortTime - b.sortTime : b.sortTime - a.sortTime
        )

        items = merged.slice(skip, skip + limit).map((x) => x.item)
        total = billCount + eoCount
    }

    const totalPages = Math.ceil(total / limit)
    const startIndex = total === 0 ? 0 : skip + 1
    const endIndex = Math.min(skip + limit, total)

    return (
        <div className="container py-8 md:py-10">
            <header className="mb-6 space-y-1.5">
                <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                    Federal Legislation
                </h1>
                <p className="text-base text-muted-foreground">
                    Browse and search{" "}
                    {legislationType === "EXECUTIVE_ORDERS"
                        ? "presidential executive orders and actions"
                        : legislationType === "BILLS"
                            ? `bills from the ${params.congress || CURRENT_CONGRESS}th U.S. Congress`
                            : "federal bills and executive orders"}
                </p>
            </header>

            <div className="mb-6">
                <SearchBar />
            </div>

            <div className="mb-5 lg:hidden">
                <MobileFilterDrawer categories={categories} />
            </div>

            <div className="flex flex-col gap-8 lg:flex-row">
                <aside className="hidden w-full lg:block lg:w-64 lg:shrink-0">
                    <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2 sidebar-scroll">
                        <FilterPanel categories={categories} />
                    </div>
                </aside>

                <section aria-label="Legislation results" className="min-w-0 flex-1 space-y-5">
                    <ActiveFiltersBar
                        total={total}
                        startIndex={startIndex}
                        endIndex={endIndex}
                        categories={categories}
                        currentSort={sortParam}
                        currentView={viewMode}
                    />

                    <Suspense fallback={<ImprovedBillList items={[]} loading view={viewMode} />}>
                        <ImprovedBillList items={items} view={viewMode} />
                    </Suspense>

                    <Pagination
                        currentPage={page}
                        totalPages={totalPages}
                        searchParams={params}
                        className="pt-4"
                    />
                </section>
            </div>
        </div>
    )
}
