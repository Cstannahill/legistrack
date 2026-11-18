import Link from "next/link"
import { Calendar, FileText, Sparkles, User } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "./StatusBadge"
import { CategoryBadge } from "./CategoryBadge"
import { formatDate } from "@/lib/utils/date"
import {
    formatSponsorLabel,
    getBillStageSummary,
    truncate,
} from "@/lib/utils/formatting"
import type { BillListItem } from "@/types/legislation"
import { cn } from "@/lib/utils"

interface ImprovedBillCardProps {
    bill: BillListItem
    view?: "list" | "grid"
}

/**
 * Editorial bill card supporting both scannable list rows (default) and 2-column grid cards.
 */
export function ImprovedBillCard({
    bill,
    view = "list",
}: ImprovedBillCardProps) {
    const idLabel = `${bill.billType?.toUpperCase() ?? ""} ${bill.billNumber ?? ""}`
    const summary = bill.summaries?.[0]?.content || ""
    const hasSummary = Boolean(summary)
    const hasFullText = Boolean(bill.fullText)
    const sponsorLabel = formatSponsorLabel(bill.sponsor)
    const stage = getBillStageSummary(bill.currentStatus)

    return (
        <Link
            href={`/bills/${bill.id}`}
            aria-label={`Open ${idLabel} ${bill.title}`}
            className="group block h-full"
        >
            <article
                className={cn(
                    "lt-card",
                    view === "list" ? "p-5 sm:p-6" : "p-5"
                )}
            >
                {/* Header row: identifier + congress + status */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="font-mono text-xs font-semibold">
                            {idLabel}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                            {bill.congress}th Congress
                        </span>
                    </div>
                    <StatusBadge status={bill.currentStatus} />
                </div>

                {/* Title */}
                <h3 className="mt-3 font-serif text-lg font-semibold leading-snug text-foreground transition-colors group-hover:text-primary sm:text-[1.18rem]">
                    {truncate(bill.title, view === "list" ? 180 : 135)}
                </h3>

                {/* AI Summary Preview */}
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

                {/* Categories */}
                {bill.categories.length > 0 && (
                    <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                        {bill.categories.slice(0, 3).map((cat) => (
                            <CategoryBadge key={cat.id} category={cat} />
                        ))}
                        {bill.categories.length > 3 && (
                            <span className="px-1.5 text-xs text-muted-foreground">
                                +{bill.categories.length - 3}
                            </span>
                        )}
                    </div>
                )}

                {/* Footer metadata + mini stage progress */}
                <div className="mt-auto pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/70 pt-3 text-xs text-muted-foreground">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
                            {sponsorLabel && (
                                <span className="inline-flex items-center gap-1.5 min-w-0">
                                    <User className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                    <span className="truncate">{sponsorLabel}</span>
                                </span>
                            )}
                            <span className="inline-flex items-center gap-1.5 shrink-0 font-mono tabular-nums">
                                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>{formatDate(bill.introducedDate)}</span>
                            </span>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
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

                            {/* 4-segment legislative stage micro-bar */}
                            <div
                                className="flex items-center gap-1"
                                title={`Legislative stage ${stage.step} of 4`}
                                aria-label={`Legislative stage ${stage.step} of 4`}
                            >
                                {[1, 2, 3, 4].map((idx) => {
                                    const active = idx <= stage.step
                                    const barColor = !active
                                        ? "bg-border"
                                        : stage.outcome === "failed" && idx === 4
                                            ? "bg-rose-500"
                                            : stage.outcome === "law"
                                                ? "bg-emerald-600 dark:bg-emerald-400"
                                                : "bg-primary"
                                    return (
                                        <span
                                            key={idx}
                                            className={cn("h-1.5 w-3.5 rounded-full", barColor)}
                                        />
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </article>
        </Link>
    )
}
