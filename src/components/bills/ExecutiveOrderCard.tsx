// ExecutiveOrderCard Component - Improved EO card aligned with bill cards
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Calendar, User, FileText, Sparkles } from 'lucide-react'
import { formatDate } from '@/lib/utils/date'
import { truncate } from '@/lib/utils/formatting'
import { getCategoryBySlug, type CategorySlug } from '@/lib/utils/category-helper'
import { EXECUTIVE_ORDER_TYPE_COLORS, EXECUTIVE_ORDER_TYPE_LABELS } from '@/lib/constants'

interface ExecutiveOrderCardProps {
    executiveOrder: {
        id: string
        orderNumber: number
        executiveOrderType: 'EXECUTIVE_ORDER' | 'PRESIDENTIAL_MEMORANDUM' | 'PROCLAMATION' | 'DETERMINATION'
        title: string
        signingDate: Date | string
        presidentName: string
        fullText?: string | null
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
}

export function ExecutiveOrderCard({ executiveOrder }: ExecutiveOrderCardProps) {
    const eoIdentifier = `EO ${executiveOrder.orderNumber}`
    const summary = executiveOrder.summaries?.[0]?.content || ''
    const hasSummary = !!summary
    const hasFullText = !!executiveOrder.fullText
    const typeLabel = EXECUTIVE_ORDER_TYPE_LABELS[executiveOrder.executiveOrderType] || executiveOrder.executiveOrderType
    const typeColor = EXECUTIVE_ORDER_TYPE_COLORS[executiveOrder.executiveOrderType] || 'bg-gray-100 text-gray-800'

    return (
        <Link
            href={`/bills/eo/${executiveOrder.id}`}
            aria-label={`Open ${eoIdentifier} ${executiveOrder.title}`}
        >
            <article className="lt-card lt-card-grid h-full">
                <div className="flex items-start justify-between gap-3 w-full">
                    <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="font-mono text-xs">
                            {eoIdentifier}
                        </Badge>
                        <Badge className={`text-xs ${typeColor}`}>
                            {typeLabel}
                        </Badge>
                    </div>
                </div>

                <h3 className="lt-title text-base md:text-lg leading-snug">
                    {truncate(executiveOrder.title, 140)}
                </h3>

                {summary && (
                    <p className="text-sm text-muted-foreground line-clamp-3">
                        {truncate(summary, 200)}
                    </p>
                )}

                {executiveOrder.categories.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {executiveOrder.categories.slice(0, 3).map((category) => {
                            const categoryData = getCategoryBySlug(category.slug as CategorySlug)
                            const color = categoryData?.color
                            return (
                                <Badge
                                    key={category.id}
                                    variant="secondary"
                                    className="text-xs"
                                    style={{
                                        backgroundColor: color ? `${color}15` : undefined,
                                        color: color || undefined,
                                    }}
                                >
                                    {category.name}
                                </Badge>
                            )
                        })}
                    </div>
                )}

                <div className="mt-auto pt-3 border-t border-border">
                    <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1 flex-1 min-w-0">
                            <User className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{executiveOrder.presidentName}</span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                            <Calendar className="h-3 w-3" />
                            <span>{formatDate(executiveOrder.signingDate)}</span>
                        </div>
                    </div>

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
