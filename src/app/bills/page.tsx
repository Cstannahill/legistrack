// Bills List Page
import { Suspense } from 'react'
import { db } from '@/lib/db'
import { BillList } from '@/components/bills/BillList'
import { SearchBar } from '@/components/search/SearchBar'
import { FilterPanel } from '@/components/search/FilterPanel'
import { CURRENT_CONGRESS } from '@/lib/constants'

interface PageProps {
    searchParams: Promise<{
        page?: string
        type?: string
        status?: string
        category?: string
        congress?: string
        search?: string
    }>
}

export default async function BillsPage({ searchParams }: PageProps) {
    const params = await searchParams
    const page = parseInt(params.page || '1', 10)
    const limit = 20
    const skip = (page - 1) * limit
    const legislationType = params.type || 'ALL' // 'ALL', 'BILLS', 'EXECUTIVE_ORDERS'

    // Determine what to fetch based on type filter
    // If status filter is applied, only fetch bills (EOs don't have status)
    const shouldFetchBills = legislationType === 'ALL' || legislationType === 'BILLS'
    const shouldFetchEOs = (legislationType === 'ALL' || legislationType === 'EXECUTIVE_ORDERS') && !params.status

    // Build where clause for bills
    const billWhere: Record<string, unknown> = {}

    if (params.status) billWhere.currentStatus = params.status
    if (params.congress) billWhere.congress = parseInt(params.congress, 10)
    else if (shouldFetchBills) billWhere.congress = CURRENT_CONGRESS

    if (params.category && shouldFetchBills) {
        billWhere.categories = {
            some: { slug: params.category },
        }
    }

    if (params.search && shouldFetchBills) {
        // Check if query is wrapped in quotes for exact word matching
        const quotedMatch = params.search.match(/^["'](.+)["']$/);
        const isExactWordMatch = !!quotedMatch;
        const searchTerm = quotedMatch ? quotedMatch[1] : params.search;

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

    if (params.search && shouldFetchEOs) {
        const quotedMatch = params.search.match(/^["'](.+)["']$/);
        const searchTerm = quotedMatch ? quotedMatch[1] : params.search;

        eoWhere.title = { contains: searchTerm, mode: 'insensitive' }
    }

    // Fetch data based on type
    const [allBills, billCount, allEOs, eoCount, categories] = await Promise.all([
        shouldFetchBills ? db.bill.findMany({
            where: billWhere,
            skip: legislationType === 'BILLS' ? skip : 0,
            take: legislationType === 'BILLS' ? limit : legislationType === 'ALL' ? Math.ceil(limit / 2) : 0,
            orderBy: { introducedDate: 'desc' },
            select: {
                id: true,
                billType: true,
                billNumber: true,
                congress: true,
                title: true,
                currentStatus: true,
                introducedDate: true,
                fullText: true,
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
                    where: { summaryType: 'BRIEF' },
                    take: 1,
                },
            },
        }) : Promise.resolve([]),
        shouldFetchBills ? db.bill.count({ where: billWhere }) : Promise.resolve(0),
        shouldFetchEOs ? db.executiveOrder.findMany({
            where: eoWhere,
            skip: legislationType === 'EXECUTIVE_ORDERS' ? skip : 0,
            take: legislationType === 'EXECUTIVE_ORDERS' ? limit : legislationType === 'ALL' ? Math.ceil(limit / 2) : 0,
            orderBy: { signingDate: 'desc' },
            select: {
                id: true,
                orderNumber: true,
                executiveOrderType: true,
                title: true,
                signingDate: true,
                presidentName: true,
                fullText: true,
                categories: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        color: true,
                    },
                },
                summaries: {
                    where: { summaryType: 'BRIEF' },
                    take: 1,
                },
            },
        }) : Promise.resolve([]),
        shouldFetchEOs ? db.executiveOrder.count({ where: eoWhere }) : Promise.resolve(0),
        db.category.findMany({
            orderBy: { name: 'asc' },
            select: {
                id: true,
                name: true,
                slug: true,
                color: true,
            },
        }),
    ])

    // Since we removed companion bill loading from list view for performance,
    // we can now directly use allBills without filtering
    const bills = allBills

    // Merge and sort bills and executive orders
    const items = [
        ...bills.map((bill) => ({ type: 'bill' as const, ...bill })),
        ...allEOs.map((eo) => ({ type: 'executiveOrder' as const, ...eo })),
    ]

    // Sort by date (introducedDate for bills, signingDate for EOs)
    items.sort((a, b) => {
        const dateA = a.type === 'bill' ? new Date(a.introducedDate) : new Date(a.signingDate)
        const dateB = b.type === 'bill' ? new Date(b.introducedDate) : new Date(b.signingDate)
        return dateB.getTime() - dateA.getTime()
    })

    const total = billCount + eoCount
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

            <div className="flex flex-col gap-8 lg:flex-row">
                {/* Sidebar Filters */}
                <aside className="w-full lg:w-64 lg:shrink-0">
                    <div className="sticky top-4">
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

                    <Suspense fallback={<BillList items={[]} loading />}>
                        <BillList items={items} />
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
