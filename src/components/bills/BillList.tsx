// BillList Component - Grid of bill and executive order cards with loading states
import { BillCard } from './BillCard'
import { ExecutiveOrderCard } from './ExecutiveOrderCard'
import { Skeleton } from '@/components/ui/skeleton'

type BillItem = {
    type: 'bill'
    id: string
    billType: string
    billNumber: number
    congress: number
    title: string
    currentStatus: string
    introducedDate: Date | string
    sponsor?: {
        fullName: string
        party: string
        state: string
    } | null
    categories: Array<{
        id: string
        name: string
        slug: string
        color?: string | null
    }>
    summaries?: Array<{
        content: string
    }>
    companionBills?: Array<{
        companionBill: {
            id: string
            billType: string
            billNumber: number
            congress: number
        }
    }>
}

type ExecutiveOrderItem = {
    type: 'executiveOrder'
    id: string
    orderNumber: number
    executiveOrderType: 'EXECUTIVE_ORDER' | 'PRESIDENTIAL_MEMORANDUM' | 'PROCLAMATION' | 'DETERMINATION'
    title: string
    signingDate: Date | string
    presidentName: string
    categories: Array<{
        id: string
        name: string
        slug: string
        color?: string | null
    }>
    summaries?: Array<{
        content: string
    }>
}

interface BillListProps {
    items: Array<BillItem | ExecutiveOrderItem>
    loading?: boolean
}

export function BillList({ items, loading }: BillListProps) {
    if (loading) {
        return (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                    <BillCardSkeleton key={i} />
                ))}
            </div>
        )
    }

    if (items.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
                <h3 className="text-lg font-semibold">No legislation found</h3>
                <p className="text-sm text-muted-foreground">
                    Try adjusting your filters or search criteria
                </p>
            </div>
        )
    }

    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => {
                if (item.type === 'executiveOrder') {
                    return <ExecutiveOrderCard key={item.id} executiveOrder={item} />
                } else {
                    return <BillCard key={item.id} bill={item} />
                }
            })}
        </div>
    )
}

function BillCardSkeleton() {
    return (
        <div className="rounded-lg border p-6 space-y-4">
            <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-3/4" />
            </div>
            <Skeleton className="h-16 w-full" />
            <div className="flex gap-2">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-20" />
            </div>
            <Skeleton className="h-4 w-full" />
        </div>
    )
}
