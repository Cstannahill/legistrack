import Link from "next/link"
import { Calendar, FileText, Sparkles, User } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { CategoryBadge } from "./CategoryBadge"
import { formatDate } from "@/lib/utils/date"
import { truncate } from "@/lib/utils/formatting"
import {
    EXECUTIVE_ORDER_TYPE_COLORS,
    EXECUTIVE_ORDER_TYPE_LABELS,
} from "@/lib/constants"
import type { ExecutiveOrderListItem } from "@/types/legislation"
import { cn } from "@/lib/utils"

interface ExecutiveOrderCardProps {
    executiveOrder: ExecutiveOrderListItem
    view?: "list" | "grid"
}

export function ExecutiveOrderCard({
    executiveOrder,
    view = "list",
}: ExecutiveOrderCardProps) {
    const eoIdentifier = `EO ${executiveOrder.orderNumber}`
    const summary = executiveOrder.summaries?.[0]?.content || ""
    const hasSummary = Boolean(summary)
    const hasFullText = Boolean(executiveOrder.fullText)
    const typeLabel =
        EXECUTIVE_ORDER_TYPE_LABELS[executiveOrder.executiveOrderType] ||
        executiveOrder.executiveOrderType
    const typeColor =
        EXECUTIVE_ORDER_TYPE_COLORS[executiveOrder.executiveOrderType] ||
        EXECUTIVE_ORDER_TYPE_COLORS.EXECUTIVE_ORDER

    return (
        <Link
            href={`/bills/eo/${executiveOrder.id}`}
            aria-label={`Open ${eoIdentifier} ${executiveOrder.title}`}
            className="group block h-full"
        >
            <article
                className={cn(
                    "lt-card",
                    view === "list" ? "p-5 sm:p-6" : "p-5"
                )}
            >
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="font-mono text-xs font-semibold">
                            {eoIdentifier}
                        </Badge>
                        <span
                            className={cn(
                                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                                typeColor
                            )}
                        >
                            {typeLabel}
                        </span>
                    </div>
                </div>

                <h3 className="mt-3 font-serif text-lg font-semibold leading-snug text-foreground transition-colors group-hover:text-primary sm:text-[1.18rem]">
                    {truncate(executiveOrder.title, view === "list" ? 180 : 135)}
                </h3>

                {summary && (
                    <p
                        className={cn(
                            "mt-2 text-sm leading-relaxed text-muted-foreground",
                            view === "list" ? "line-clamp-2 max-w-3xl" : "line-clamp-3"
                        )}
                    >
                        {summary}
                    </p>
                )}

                {executiveOrder.categories.length > 0 && (
                    <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                        {executiveOrder.categories.slice(0, 3).map((category) => (
                            <CategoryBadge key={category.id} category={category} />
                        ))}
                        {executiveOrder.categories.length > 3 && (
                            <span className="px-1.5 text-xs text-muted-foreground">
                                +{executiveOrder.categories.length - 3}
                            </span>
                        )}
                    </div>
                )}

                <div className="mt-auto pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/70 pt-3 text-xs text-muted-foreground">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
                            <span className="inline-flex items-center gap-1.5 min-w-0">
                                <User className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                <span className="truncate">{executiveOrder.presidentName}</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5 shrink-0 font-mono tabular-nums">
                                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>{formatDate(executiveOrder.signingDate)}</span>
                            </span>
                        </div>

                        {(hasSummary || hasFullText) && (
                            <div className="hidden sm:flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                                {hasSummary && (
                                    <span className="inline-flex items-center gap-1 text-primary">
                                        <Sparkles className="h-3 w-3" aria-hidden="true" />
                                        Brief
                                    </span>
                                )}
                                {hasFullText && (
                                    <span className="inline-flex items-center gap-1">
                                        <FileText className="h-3 w-3" aria-hidden="true" />
                                        Full Text
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </article>
        </Link>
    )
}
