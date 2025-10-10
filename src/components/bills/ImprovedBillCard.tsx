// components/bills/ImprovedBillCard.tsx
import Link from 'next/link'
import React from 'react'
import { Calendar, User, FileText, Sparkles } from 'lucide-react'
import { formatDate } from '@/lib/utils/date'
import { truncate } from '@/lib/utils/formatting'
import { getCategoryBySlug } from '@/lib/utils/category-helper'
import { StatusBadge } from './StatusBadge'
import { Badge } from '@/components/ui/badge'

type BillProps = {
    bill: {
        id: string
        billType: string
        billNumber: number
        congress: number
        title: string
        currentStatus: string
        introducedDate: Date | string
        fullText?: string | null
        sponsor?: { fullName: string; party: string; state: string } | null
        categories: Array<{ id: string; name: string; slug: string; color?: string | null }>
        summaries?: Array<{ content: string }>
    }
}

/**
 * Polished bill card used in lists.
 * - Uses accessible layout with clear metadata
 * - Colored category chips (derived from category helper)
 * - StatusBadge for consistent status styling
 */
export function ImprovedBillCard({ bill }: BillProps) {
    const idLabel = `${bill.billType?.toUpperCase() ?? ''} ${bill.billNumber ?? ''}`

    // Debug: Log the summaries to see what we're getting
    console.log('Bill summaries:', bill.summaries)

    const summary = bill.summaries?.[0]?.content || ''
    const hasSummary = !!summary
    const hasFullText = !!bill.fullText

    return (
        <Link href={`/bills/${bill.id}`} aria-label={`Open ${idLabel} ${bill.title}`}>
            <article className="lt-card lt-card-grid h-full">
                {/* Header row with bill ID and status badge */}
                <div className="flex items-start justify-between gap-3 w-full">
                    <div className="flex items-center gap-3 flex-wrap">
                        <Badge variant="outline" className="font-mono text-xs">
                            {idLabel}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                            {bill.congress}th Congress
                        </span>
                    </div>
                    <StatusBadge status={bill.currentStatus} />
                </div>

                {/* Title - full width */}
                <h3 className="lt-title text-base md:text-lg leading-snug">
                    {truncate(bill.title, 140)}
                </h3>



                {/* Categories */}
                {bill.categories.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {bill.categories.slice(0, 3).map((c) => {
                            const category = getCategoryBySlug(c.slug as any) || c
                            const color = category?.color || undefined
                            return (
                                <Badge
                                    key={c.id}
                                    variant="secondary"
                                    className="text-xs"
                                    style={{
                                        backgroundColor: color ? `${color}15` : undefined,
                                        color: color || undefined,
                                    }}
                                >
                                    {c.name}
                                </Badge>
                            )
                        })}
                    </div>
                )}

                {/* Footer with metadata */}
                <div className="mt-auto pt-3 border-t border-border">
                    <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
                        {bill.sponsor && (
                            <div className="flex items-center gap-1 flex-1 min-w-0">
                                <User className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate">
                                    {bill.sponsor.fullName}
                                </span>
                            </div>
                        )}
                        <div className="flex items-center gap-1 flex-shrink-0">
                            <Calendar className="h-3 w-3" />
                            <span>{formatDate(bill.introducedDate)}</span>
                        </div>
                    </div>

                    {/* Availability Indicators */}
                    {(hasSummary || hasFullText) && (
                        <div className="mt-2 flex items-center gap-2">
                            {hasSummary && (
                                <Badge
                                    variant="secondary"
                                    className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs"
                                >
                                    <Sparkles className="mr-1 h-3 w-3" />
                                    Summary
                                </Badge>
                            )}
                            {hasFullText && (
                                <Badge
                                    variant="secondary"
                                    className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs"
                                >
                                    <FileText className="mr-1 h-3 w-3" />
                                    Full Text
                                </Badge>
                            )}
                        </div>
                    )}
                </div>
            </article>
        </Link>
    )
}