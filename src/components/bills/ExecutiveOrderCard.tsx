// ExecutiveOrderCard Component - Display executive order summary in a card
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils/date'
import { truncate } from '@/lib/utils/formatting'
import { getCategoryBySlug, type CategorySlug } from '@/lib/utils/category-helper'
import { Calendar, User, FileText, Sparkles } from 'lucide-react'
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
        <Link href={`/bills/eo/${executiveOrder.id}`}>
            <Card className="h-full transition-shadow hover:shadow-lg">
                <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                            <div className="mb-1 flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className="font-mono text-xs">
                                    {eoIdentifier}
                                </Badge>
                                <Badge className={`text-xs ${typeColor}`}>
                                    {typeLabel}
                                </Badge>
                            </div>
                            <CardTitle className="text-lg leading-tight">
                                {truncate(executiveOrder.title, 120)}
                            </CardTitle>
                        </div>
                    </div>

                    {/* Availability Indicators */}
                    {(hasSummary || hasFullText) && (
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
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
                </CardHeader>

                <CardContent className="space-y-3">
                    {summary && (
                        <CardDescription className="line-clamp-3">
                            {truncate(summary, 200)}
                        </CardDescription>
                    )}

                    {executiveOrder.categories.length > 0 && (
                        <div className="flex flex-wrap gap-1">
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
                </CardContent>

                <CardFooter className="text-xs text-muted-foreground">
                    <div className="flex w-full items-center justify-between">
                        <div className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            <span>{executiveOrder.presidentName}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            <span>{formatDate(executiveOrder.signingDate)}</span>
                        </div>
                    </div>
                </CardFooter>
            </Card>
        </Link>
    )
}
