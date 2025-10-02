// ExecutiveOrderCard Component - Display executive order summary in a card
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils/date'
import { truncate } from '@/lib/utils/formatting'
import { Calendar, User } from 'lucide-react'
import { EXECUTIVE_ORDER_TYPE_COLORS, EXECUTIVE_ORDER_TYPE_LABELS } from '@/lib/constants'

interface ExecutiveOrderCardProps {
    executiveOrder: {
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
}

export function ExecutiveOrderCard({ executiveOrder }: ExecutiveOrderCardProps) {
    const eoIdentifier = `EO ${executiveOrder.orderNumber}`
    const summary = executiveOrder.summaries?.[0]?.content || ''
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
                </CardHeader>

                <CardContent className="space-y-3">
                    {summary && (
                        <CardDescription className="line-clamp-3">
                            {truncate(summary, 200)}
                        </CardDescription>
                    )}

                    {executiveOrder.categories.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {executiveOrder.categories.slice(0, 3).map((category) => (
                                <Badge
                                    key={category.id}
                                    variant="secondary"
                                    className="text-xs"
                                    style={{
                                        backgroundColor: category.color ? `${category.color}15` : undefined,
                                        color: category.color || undefined,
                                    }}
                                >
                                    {category.name}
                                </Badge>
                            ))}
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
