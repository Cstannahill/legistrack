// Bills List Page
import { Suspense } from 'react'
import { db } from '@/lib/db'
// import { BillList } from '@/components/bills/BillList'
import { ImprovedBillList } from '@/components/bills/ImprovedBillList'
import { SearchBar } from '@/components/search/SearchBar'
import { FilterPanel } from '@/components/search/FilterPanel'
import { MobileFilterDrawer } from '@/components/search/MobileFilterDrawer'
import { CURRENT_CONGRESS, CACHE_DURATIONS } from '@/lib/constants'
import { cachedCount } from '@/lib/countCache'
import { getAllCategories, getCategoryBySlug, type CategorySlug } from '@/lib/utils/category-helper'

interface PageProps {
    searchParams: Promise<{
        page?: string
        type?: string
        status?: string
        category?: string
        congress?: string
        search?: string
        showIncomplete?: string // 'true' to show bills without fullText
    }>
}

export default async function BillsPage({ searchParams }: PageProps) {
    const params = await searchParams
    const page = parseInt(params.page || '1', 10)
    const limit = 20
    const skip = (page - 1) * limit
    const legislationType = params.type || 'ALL' // 'ALL', 'BILLS', 'EXECUTIVE_ORDERS'
    const showIncomplete = params.showIncomplete === 'true' // Default: false (only show complete bills)
    const searchQuery = params.search?.trim()
    const hasSearchQuery = !!searchQuery

    // Determine what to fetch based on type filter
    // If status filter is applied, only fetch bills (EOs don't have status)
    const hasCongressFilter = !!params.congress
    const shouldFetchBills = legislationType === 'ALL' || legislationType === 'BILLS'
    const shouldFetchEOs =
        legislationType === 'EXECUTIVE_ORDERS' ||
        (legislationType === 'ALL' && !params.status && !hasCongressFilter)

    // Build where clause for bills
    const billWhere: Record<string, unknown> = {}

    // By default, only show bills with full text (better UX - complete content)
    // Users can toggle to see incomplete bills
    const requireCompleteBills = shouldFetchBills && !showIncomplete && !hasSearchQuery

    if (requireCompleteBills) {
        billWhere.fullText = { not: null }
    }

    if (params.status) billWhere.currentStatus = params.status
    if (params.congress) billWhere.congress = parseInt(params.congress, 10)
    else if (shouldFetchBills) billWhere.congress = CURRENT_CONGRESS

    if (params.category && shouldFetchBills) {
        billWhere.categories = {
            some: { slug: params.category },
        }
    }

    if (hasSearchQuery && shouldFetchBills && searchQuery) {
        // Check if query is wrapped in quotes for exact word matching
        const quotedMatch = searchQuery.match(/^["'](.+)["']$/);
        const isExactWordMatch = !!quotedMatch;
        const searchTerm = quotedMatch ? quotedMatch[1] : searchQuery;

        // Remove periods from search term for better matching (e.g., "HR. 5374" -> "HR 5374")
        const cleanedSearchTerm = searchTerm.replace(/\./g, '').trim();

        // Parse potential bill number from query (e.g., "HR 4398", "HR. 5374", "S 2309", "hr 537")
        // Now supports partial matches - just the number, or type + partial number
        const billNumberMatch = cleanedSearchTerm.match(/^([A-Z]+)?\s*(\d+)$/i);

        if (billNumberMatch) {
            const billType = billNumberMatch[1]?.toUpperCase();
            const billNumberStr = billNumberMatch[2];
            const billNumber = parseInt(billNumberStr, 10);

            // Build OR conditions for bill number matching ONLY
            // Don't include title search when user is clearly searching for a bill number
            const orConditions: Array<Record<string, unknown>> = [];

            // If we have a bill type (e.g., "HR"), match bills of that type
            if (billType) {
                // Exact match: HR 5374
                orConditions.push({
                    AND: [
                        { billType: { equals: billType, mode: 'insensitive' } },
                        { billNumber: billNumber },
                    ],
                });

                // Partial match: HR 537 should match HR 5371, HR 5374, etc.
                // Convert search string to start and end of range
                // "537" (3 digits) -> 5370 to 5379
                // "53" (2 digits) -> 5300 to 5399
                const numDigits = billNumberStr.length;
                const rangeStart = billNumber * Math.pow(10, Math.max(0, 4 - numDigits));
                const rangeEnd = rangeStart + Math.pow(10, Math.max(0, 4 - numDigits));

                orConditions.push({
                    AND: [
                        { billType: { equals: billType, mode: 'insensitive' } },
                        { billNumber: { gte: rangeStart, lt: rangeEnd } },
                    ],
                });
            } else {
                // No bill type specified, search by number across all types
                // Exact match
                orConditions.push({ billNumber: billNumber });

                // Partial match for the number
                const numDigits = billNumberStr.length;
                const rangeStart = billNumber * Math.pow(10, Math.max(0, 4 - numDigits));
                const rangeEnd = rangeStart + Math.pow(10, Math.max(0, 4 - numDigits));

                orConditions.push({
                    billNumber: { gte: rangeStart, lt: rangeEnd }
                });
            }

            billWhere.OR = orConditions;
        } else if (isExactWordMatch) {
            // For exact word matching, search for word with spaces/punctuation boundaries
            billWhere.OR = [
                { title: { contains: ` ${searchTerm} `, mode: 'insensitive' } },
                { title: { startsWith: `${searchTerm} `, mode: 'insensitive' } },
                { title: { endsWith: ` ${searchTerm}`, mode: 'insensitive' } },
                { officialTitle: { contains: ` ${searchTerm} `, mode: 'insensitive' } },
                { officialTitle: { startsWith: `${searchTerm} `, mode: 'insensitive' } },
                { officialTitle: { endsWith: ` ${searchTerm}`, mode: 'insensitive' } },
            ];
        } else {
            billWhere.OR = [
                { title: { contains: searchTerm, mode: 'insensitive' } },
                { officialTitle: { contains: searchTerm, mode: 'insensitive' } },
            ];
        }
    }

    // Build where clause for executive orders
    const eoWhere: Record<string, unknown> = {}

    if (params.category && shouldFetchEOs) {
        eoWhere.categories = {
            some: { slug: params.category },
        }
    }

    if (hasSearchQuery && shouldFetchEOs && searchQuery) {
        const quotedMatch = searchQuery.match(/^["'](.+)["']$/);
        const isExactWordMatch = !!quotedMatch;
        const searchTerm = quotedMatch ? quotedMatch[1] : searchQuery;

        // Remove periods and clean search term (e.g., "EO. 1" -> "EO 1")
        const cleanedSearchTerm = searchTerm.replace(/\./g, '').trim();

        // Parse potential EO number from query (e.g., "EO 1", "EO. 14111", "14111")
        const eoNumberMatch = cleanedSearchTerm.match(/^(?:EO)?\s*(\d+)$/i);

        if (eoNumberMatch) {
            // User is searching for an EO number
            const orderNumber = parseInt(eoNumberMatch[1], 10);

            // Search by order number only (exact match or partial match)
            const orderNumberStr = eoNumberMatch[1];
            const numDigits = orderNumberStr.length;

            if (numDigits < 5) {
                // For shorter numbers, support partial matching
                // "1" should match 1, 10, 11, 12, ... 19, 100, etc.
                const rangeStart = orderNumber * Math.pow(10, Math.max(0, 5 - numDigits));
                const rangeEnd = rangeStart + Math.pow(10, Math.max(0, 5 - numDigits));

                eoWhere.OR = [
                    { orderNumber: orderNumber }, // Exact match
                    { orderNumber: { gte: rangeStart, lt: rangeEnd } }, // Partial match
                ];
            } else {
                // For full numbers, exact match only
                eoWhere.orderNumber = orderNumber;
            }
        } else if (isExactWordMatch) {
            // Exact word matching in title
            eoWhere.OR = [
                { title: { contains: ` ${searchTerm} `, mode: 'insensitive' } },
                { title: { startsWith: `${searchTerm} `, mode: 'insensitive' } },
                { title: { endsWith: ` ${searchTerm}`, mode: 'insensitive' } },
            ];
        } else {
            // Regular title search
            eoWhere.title = { contains: searchTerm, mode: 'insensitive' };
        }
    }

    // Fetch data based on type
    // Robust unified pagination strategy
    // For single-type views we retain simple skip/take.
    // For ALL view we fetch the required window size from each collection (skip + limit)
    // then perform an in-memory stable merge with deterministic ordering (date DESC, type, id) and slice.
    // This guarantees no duplicate items across pages and consistent ranges.

    // First get counts & categories (cheap) in parallel
    const fallbackCategories = getAllCategories().map(cat => ({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        color: cat.color,
    }))

    const [billCount, eoCount, dbCategories] = await Promise.all([
        shouldFetchBills
            ? cachedCount(
                `billCount:${JSON.stringify(billWhere)}`,
                CACHE_DURATIONS.BILLS_LIST * 1000,
                () => db.bill.count({ where: billWhere })
            )
            : Promise.resolve(0),
        shouldFetchEOs
            ? cachedCount(
                `eoCount:${JSON.stringify(eoWhere)}`,
                CACHE_DURATIONS.BILLS_LIST * 1000,
                () => db.executiveOrder.count({ where: eoWhere })
            )
            : Promise.resolve(0),
        db.category.findMany({
            orderBy: { name: 'asc' },
            select: { id: true, name: true, slug: true, color: true },
        }).catch(error => {
            console.error('Failed to load categories from DB, using fallback list', error)
            return fallbackCategories
        }),
    ])

    // Enrich categories with colors from category helper (frontend source of truth)
    const categories = dbCategories.map(cat => {
        const helperData = getCategoryBySlug(cat.slug as CategorySlug)
        return {
            ...cat,
            color: helperData?.color || cat.color // Use helper color if available, fallback to DB
        }
    })

    // Helper for selecting projection (shared)
    const billSelect = {
        id: true,
        billType: true,
        billNumber: true,
        congress: true,
        title: true,
        currentStatus: true,
        introducedDate: true,
        fullText: true,
        sponsor: { select: { fullName: true, party: true, state: true } },
        categories: { select: { id: true, name: true, slug: true, color: true } },
        summaries: { where: { summaryType: 'BRIEF' }, take: 1 },
    } as const
    // Removed eoSelect (Prisma projection) after migrating EO list path fully to SQL function.

    // Fetch data sets
    interface RawBill {
        id: string
        billType: string
        billNumber: number
        congress: number
        title: string
        currentStatus: string
        introducedDate: Date
        fullText: string | null
        sponsor: { fullName: string; party: string; state: string } | null
        categories: { id: string; name: string; slug: string; color: string | null }[]
        summaries: { content: string }[]
    }
    interface RawEO {
        id: string
        orderNumber: number
        executiveOrderType: 'EXECUTIVE_ORDER' | 'PRESIDENTIAL_MEMORANDUM' | 'PROCLAMATION' | 'DETERMINATION'
        title: string
        signingDate: Date
        presidentName: string
        fullText: string | null
        categories: { id: string; name: string; slug: string; color: string | null }[]
        summaries: { content: string }[]
    }
    let rawBills: RawBill[] = []
    let rawEOs: RawEO[] = []


    const useUnified = legislationType === 'ALL' && !params.status && !params.congress

    if (useUnified) {
        interface UnifiedRow { id: string; kind: 'bill' | 'executiveOrder'; billType: string | null; billNumber: string | null; congress: number | null; title: string; currentStatus: string | null; sort_date: string; categories: { id: string; name: string; slug: string }[] | null; sponsor: { fullName: string; party: string; state: string } | null; presidentName?: string | null; total_count: bigint | number }
        const billStatus = params.status || null
        const billCategory = params.category || null
        const billCongress = params.congress ? parseInt(params.congress, 10) : CURRENT_CONGRESS
        const billSearch = hasSearchQuery ? searchQuery : null
        const eoCategory = params.category || null
        const eoPresident = null
        const eoSearch = hasSearchQuery ? searchQuery : null
        const eoSigningStart = null
        const eoSigningEnd = null
        const sortField = 'introducedDate'
        const sortDir = 'desc'
        if (!showIncomplete) {
            const unified = await db.$queryRaw<UnifiedRow[]>`
                SELECT * FROM get_bills_and_orders(
                    ${skip}::int,
                    ${limit}::int,
                    ${billStatus}::public."BillStatus",
                    ${billCategory}::text,
                    ${billCongress}::int,
                    ${billSearch}::text,
                    ${eoCategory}::text,
                    ${eoPresident}::text,
                    ${eoSearch}::text,
                    ${eoSigningStart}::date,
                    ${eoSigningEnd}::date,
                    ${sortField}::text,
                    ${sortDir}::text
                )`
            const totalCount = unified[0]?.total_count ? Number(unified[0].total_count) : 0
            const unifiedItems: Array<BillListBill | BillListEO> = unified.map(r => {
                if (r.kind === 'bill') {
                    return {
                        type: 'bill' as const,
                        id: r.id,
                        billType: r.billType || '',
                        billNumber: r.billNumber ? parseInt(r.billNumber, 10) : 0,
                        congress: r.congress || 0,
                        title: r.title,
                        currentStatus: r.currentStatus || '',
                        introducedDate: new Date(r.sort_date),
                        categories: Array.isArray(r.categories) ? r.categories : [],
                        sponsor: r.sponsor ? {
                            fullName: r.sponsor.fullName,
                            party: r.sponsor.party,
                            state: r.sponsor.state,
                        } : null,
                    }
                } else {
                    return {
                        type: 'executiveOrder' as const,
                        id: r.id,
                        orderNumber: r.billNumber ? parseInt(r.billNumber, 10) : 0,
                        executiveOrderType: 'EXECUTIVE_ORDER',
                        title: r.title,
                        signingDate: new Date(r.sort_date),
                        presidentName: r.presidentName || '',
                        categories: Array.isArray(r.categories) ? r.categories : [],
                    }
                }
            })
            const total = totalCount
            const totalPages = Math.ceil(total / limit)
            return (
                <div className="container py-8">
                    <div className="mb-8">
                        <h1 className="mb-2 text-4xl font-bold tracking-tight">Federal Legislation</h1>
                        <p className="text-lg text-muted-foreground">
                            Browse and search all federal legislation
                        </p>
                    </div>
                    <div className="mb-6"><SearchBar /></div>
                    <div className="mb-4 lg:hidden"><MobileFilterDrawer categories={categories} /></div>
                    <div className="flex flex-col gap-8 lg:flex-row">
                        <aside className="hidden w-full lg:block lg:w-64 lg:shrink-0">
                            <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto sidebar-scroll">
                                <FilterPanel categories={categories} />
                            </div>
                        </aside>
                        <main className="flex-1">
                            <div className="mb-4 flex items-center justify-between">
                                <p className="text-sm text-muted-foreground">Showing {skip + 1}-{Math.min(skip + limit, total)} of {total} items</p>
                            </div>
                            {totalPages > 1 && (
                                <div className="mb-6 flex items-center justify-center gap-2">
                                    {page > 1 && <a href={`?${new URLSearchParams({ ...params, page: String(page - 1) }).toString()}`} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">Previous</a>}
                                    <span className="px-4 py-2 text-sm">Page {page} of {totalPages}</span>
                                    {page < totalPages && <a href={`?${new URLSearchParams({ ...params, page: String(page + 1) }).toString()}`} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">Next</a>}
                                </div>
                            )}
                            <Suspense fallback={<ImprovedBillList items={[]} loading />}> <ImprovedBillList items={unifiedItems} /> </Suspense>
                            {totalPages > 1 && (
                                <div className="mt-8 flex items-center justify-center gap-2">
                                    {page > 1 && <a href={`?${new URLSearchParams({ ...params, page: String(page - 1) }).toString()}`} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">Previous</a>}
                                    <span className="px-4 py-2 text-sm">Page {page} of {totalPages}</span>
                                    {page < totalPages && <a href={`?${new URLSearchParams({ ...params, page: String(page + 1) }).toString()}`} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">Next</a>}
                                </div>
                            )}
                        </main>
                    </div>
                </div>
            )
        }
    } else if ((legislationType === 'BILLS' || legislationType === 'ALL') && shouldFetchBills) {
        const simpleBills = !params.status && !params.search && !params.category && !showIncomplete
        if (simpleBills) {
            interface BillRow { id: string; billType: string | null; billNumber: string | null; congress: number | null; title: string; currentStatus: string | null; sort_date: string; categories: { id: string; name: string; slug: string }[] | null; sponsor: { fullName: string; party: string; state: string } | null; total_count: bigint | number }
            const billRows = await db.$queryRaw<BillRow[]>`
                SELECT * FROM get_bills(
                    ${skip}::int,
                    ${limit}::int,
                    NULL::public."BillStatus",
                    NULL::text,
                    NULL::int,
                    NULL::text,
                    ${'introducedDate'}::text,
                    ${'desc'}::text
                )`
            rawBills = billRows.map(r => ({
                id: r.id,
                billType: r.billType || '',
                billNumber: r.billNumber ? parseInt(r.billNumber, 10) : 0,
                congress: r.congress || 0,
                title: r.title,
                currentStatus: r.currentStatus || '',
                introducedDate: new Date(r.sort_date),
                fullText: null,
                sponsor: r.sponsor ? {
                    fullName: r.sponsor.fullName,
                    party: r.sponsor.party,
                    state: r.sponsor.state,
                } : null,
                categories: Array.isArray(r.categories) ? r.categories.map(c => ({ ...c, color: null })) : [],
                summaries: [],
            }))
            if (billRows[0]?.total_count) {
            }
        } else {
            rawBills = await db.bill.findMany({
                where: billWhere,
                skip,
                take: limit,
                orderBy: [{ introducedDate: 'desc' }, { id: 'desc' }],
                select: billSelect,
            }).then((rows: RawBill[]) => rows.map(b => ({ ...b, summaries: b.summaries?.map((s) => ({ content: s.content })) ?? [] })))
        }
    } else if (legislationType === 'EXECUTIVE_ORDERS' && shouldFetchEOs) {
        interface EORow { id: string; billNumber: string | null; title: string; sort_date: string; presidentName: string | null; categories: { id: string; name: string; slug: string }[] | null; total_count: bigint | number }
        const presidentFilter: string | null = null
        const signingStart: string | null = null
        const signingEnd: string | null = null
        const searchTerm = hasSearchQuery ? searchQuery : null
        const categorySlug = params.category || null
        const eoRows = await db.$queryRaw<EORow[]>`
            SELECT * FROM get_executive_orders(
                ${skip}::int,
                ${limit}::int,
                ${categorySlug}::text,
                ${presidentFilter}::text,
                ${searchTerm}::text,
                ${signingStart}::date,
                ${signingEnd}::date,
                ${'signingDate'}::text,
                ${'desc'}::text
            )`
        rawEOs = eoRows.map(r => ({
            id: r.id,
            orderNumber: r.billNumber ? parseInt(r.billNumber, 10) : 0,
            executiveOrderType: 'EXECUTIVE_ORDER',
            title: r.title,
            signingDate: new Date(r.sort_date),
            presidentName: r.presidentName || '',
            fullText: null,
            categories: Array.isArray(r.categories) ? r.categories.map(c => ({ ...c, color: null })) : [],
            summaries: [],
        }))
    }

    type BillListBill = {
        type: 'bill'
        id: string
        billType: string
        billNumber: number
        congress: number
        title: string
        currentStatus: string
        introducedDate: Date
        fullText?: string | null
        sponsor?: { fullName: string; party: string; state: string } | null
        categories: Array<{ id: string; name: string; slug: string; color?: string | null }>
        summaries?: Array<{ content: string }>
    }
    type BillListEO = {
        type: 'executiveOrder'
        id: string
        orderNumber: number
        executiveOrderType: 'EXECUTIVE_ORDER' | 'PRESIDENTIAL_MEMORANDUM' | 'PROCLAMATION' | 'DETERMINATION'
        title: string
        signingDate: Date
        presidentName: string
        fullText?: string | null
        categories: Array<{ id: string; name: string; slug: string; color?: string | null }>
        summaries?: Array<{ content: string }>
    }
    let items: Array<BillListBill | BillListEO> = []

    if (legislationType === 'BILLS' || (legislationType === 'ALL' && !shouldFetchEOs)) {
        items = rawBills.map((b) => ({ type: 'bill' as const, ...b }))
    } else if (legislationType === 'EXECUTIVE_ORDERS') {
        items = rawEOs.map((e) => ({ type: 'executiveOrder' as const, ...e }))
    } else if (legislationType === 'ALL' && shouldFetchEOs) {
        items = []
    }

    let total = 0
    if (legislationType === 'BILLS' || (legislationType === 'ALL' && !shouldFetchEOs)) {
        total = billCount
    } else if (legislationType === 'EXECUTIVE_ORDERS') {
        total = eoCount
    } else if (legislationType === 'ALL' && shouldFetchEOs) {
        total = billCount + eoCount
    }

    const totalPages = Math.ceil(total / limit)

    return (
        <div className="container py-8">
            <div className="mb-8">
                <h1 className="mb-2 text-4xl font-bold tracking-tight">Federal Legislation</h1>
                <p className="text-lg text-muted-foreground">
                    Browse and search {legislationType === 'EXECUTIVE_ORDERS' ? 'executive orders' : legislationType === 'BILLS' ? `bills from the ${params.congress || CURRENT_CONGRESS}th U.S. Congress` : 'all federal legislation'}
                </p>
            </div>

            <div className="mb-6">
                <SearchBar />
            </div>

            {/* Mobile Filter Button */}
            <div className="mb-4 lg:hidden">
                <MobileFilterDrawer categories={categories} />
            </div>

            <div className="flex flex-col gap-8 lg:flex-row">
                {/* Sidebar Filters - Desktop Only */}
                <aside className="hidden w-full lg:block lg:w-64 lg:shrink-0">
                    <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto sidebar-scroll">
                        <FilterPanel categories={categories} />
                    </div>
                </aside>

                {/* Main Content */}
                <main className="flex-1">
                    <div className="mb-4 flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">
                            Showing {skip + 1}-{Math.min(skip + limit, total)} of {total} items
                        </p>
                    </div>

                    {/* Pagination - Top */}
                    {totalPages > 1 && (
                        <div className="mb-6 flex items-center justify-center gap-2">
                            {page > 1 && (
                                <a
                                    href={`?${new URLSearchParams({ ...params, page: String(page - 1) }).toString()}`}
                                    className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
                                >
                                    Previous
                                </a>
                            )}
                            <span className="px-4 py-2 text-sm">
                                Page {page} of {totalPages}
                            </span>
                            {page < totalPages && (
                                <a
                                    href={`?${new URLSearchParams({ ...params, page: String(page + 1) }).toString()}`}
                                    className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
                                >
                                    Next
                                </a>
                            )}
                        </div>
                    )}

                    <Suspense fallback={<ImprovedBillList items={[]} loading />}>
                        <ImprovedBillList items={items} />
                    </Suspense>

                    {/* Pagination - Bottom */}
                    {totalPages > 1 && (
                        <div className="mt-8 flex items-center justify-center gap-2">
                            {page > 1 && (
                                <a
                                    href={`?${new URLSearchParams({ ...params, page: String(page - 1) }).toString()}`}
                                    className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
                                >
                                    Previous
                                </a>
                            )}
                            <span className="px-4 py-2 text-sm">
                                Page {page} of {totalPages}
                            </span>
                            {page < totalPages && (
                                <a
                                    href={`?${new URLSearchParams({ ...params, page: String(page + 1) }).toString()}`}
                                    className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
                                >
                                    Next
                                </a>
                            )}
                        </div>
                    )}
                </main>
            </div>
        </div>
    )
}
