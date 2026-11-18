import Link from "next/link"
import { SearchX } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { ImprovedBillCard } from "./ImprovedBillCard"
import { ExecutiveOrderCard } from "./ExecutiveOrderCard"
import type { LegislationListItem } from "@/types/legislation"
import { cn } from "@/lib/utils"

interface ImprovedBillListProps {
    items: LegislationListItem[]
    loading?: boolean
    view?: "list" | "grid"
}

export function ImprovedBillList({
    items,
    loading = false,
    view = "list",
}: ImprovedBillListProps) {
    if (loading) {
        return (
            <div className={cn(view === "grid" ? "lt-grid" : "space-y-4")}>
                {Array.from({ length: 6 }).map((_, i) => (
                    <div
                        key={i}
                        className="rounded-xl border border-border bg-card p-5 space-y-3"
                    >
                        <div className="flex items-center justify-between">
                            <Skeleton className="h-5 w-24" />
                            <Skeleton className="h-5 w-24 rounded-full" />
                        </div>
                        <Skeleton className="h-6 w-4/5" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-2/3" />
                        <div className="flex items-center justify-between pt-2">
                            <Skeleton className="h-4 w-40" />
                            <Skeleton className="h-4 w-24" />
                        </div>
                    </div>
                ))}
            </div>
        )
    }

    if (!items || items.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <SearchX className="h-6 w-6" aria-hidden="true" />
                </div>
                <h2 className="font-serif text-xl font-semibold text-foreground">
                    No legislation matches your filters
                </h2>
                <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
                    Try broadening your search keywords, switching legislative types, or clearing active filters.
                </p>
                <Button asChild variant="outline" size="sm" className="mt-5">
                    <Link href="/bills">Reset all filters</Link>
                </Button>
            </div>
        )
    }

    return (
        <div className={cn(view === "grid" ? "lt-grid" : "space-y-4")}>
            {items.map((item) => {
                if (item.type === "executiveOrder") {
                    return (
                        <ExecutiveOrderCard
                            key={`eo-${item.id}`}
                            executiveOrder={item}
                            view={view}
                        />
                    )
                }
                return (
                    <ImprovedBillCard
                        key={`bill-${item.id}`}
                        bill={item}
                        view={view}
                    />
                )
            })}
        </div>
    )
}
