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

        // Parse potential bill number from query (e.g., "HR 4398", "S 2309")
        const billNumberMatch = searchTerm.match(/^([A-Z]+)\s*(\d+)$/i);

        if (billNumberMatch) {
            const billType = billNumberMatch[1].toUpperCase();
            const billNumber = parseInt(billNumberMatch[2], 10);

            billWhere.OR = [
                { title: { contains: searchTerm, mode: 'insensitive' } },
                { officialTitle: { contains: searchTerm, mode: 'insensitive' } },
                {
                    AND: [
                        { billType: { equals: billType, mode: 'insensitive' } },
                        { billNumber: billNumber },
                    ],
                },
            ];
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
                        color: true,
                    },
                },
                summaries: {
                    where: { summaryType: 'BRIEF' },
                    take: 1,
                },
                companionBills: {
                    include: {
                        companionBill: {
                            select: {
                                id: true,
                                billType: true,
                                billNumber: true,
                                congress: true,
                                title: true,
                                currentStatus: true,
                                introducedDate: true,
                            },
                        },
                    },
                },
                companionOf: {
                    include: {
                        sourceBill: {
                            select: {
                                id: true,
                                billType: true,
                                billNumber: true,
                                congress: true,
                            },
                        },
                    },
                },
            },
        }) : Promise.resolve([]),
        shouldFetchBills ? db.bill.count({ where: billWhere }) : Promise.resolve(0),
        shouldFetchEOs ? db.executiveOrder.findMany({
            where: eoWhere,
            skip: legislationType === 'EXECUTIVE_ORDERS' ? skip : 0,
            take: legislationType === 'EXECUTIVE_ORDERS' ? limit : legislationType === 'ALL' ? Math.ceil(limit / 2) : 0,
            orderBy: { signingDate: 'desc' },
            include: {
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

    // Group companion bills to avoid showing duplicates
    const seenBillIds = new Set<string>()
    const bills = allBills.filter((bill) => {
        // If this bill is a companion OF another bill, skip it
        if (bill.companionOf.length > 0) {
            // Check if the source bill is already in our list
            const sourceBillId = bill.companionOf[0].sourceBill.id
            if (allBills.some(b => b.id === sourceBillId)) {
                seenBillIds.add(bill.id)
                return false // Skip this one, show the source instead
            }
        }
        return true
    })

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

                    <Suspense fallback={<BillList items={[]} loading />}>
                        <BillList items={items} />
                    </Suspense>

                    {/* Pagination */}
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
