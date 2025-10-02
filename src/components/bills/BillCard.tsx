// BillCard Component - Display bill summary in a card
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from './StatusBadge'
import { formatDate } from '@/lib/utils/date'
import { truncate } from '@/lib/utils/formatting'
import { Calendar, User } from 'lucide-react'

interface BillCardProps {
    bill: {
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
}

export function BillCard({ bill }: BillCardProps) {
    const billIdentifier = `${bill.billType.toUpperCase()}. ${bill.billNumber}`
    const summary = bill.summaries?.[0]?.content || ''

    // Get companion bills for display
    const companions = bill.companionBills?.map(cb => cb.companionBill) || []

    return (
        <Link href={`/bills/${bill.id}`}>
            <Card className="h-full transition-shadow hover:shadow-lg">
                <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                            <div className="mb-1 flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className="font-mono text-xs">
                                    {billIdentifier}
                                </Badge>
                                {companions.map((companion) => (
                                    <Badge
                                        key={companion.id}
                                        variant="outline"
                                        className="font-mono text-xs"
                                    >
                                        {companion.billType.toUpperCase()}. {companion.billNumber}
                                    </Badge>
                                ))}
                                <span className="text-xs text-muted-foreground">
                                    {bill.congress}th Congress
                                </span>
                            </div>
                            <CardTitle className="text-lg leading-tight">
                                {truncate(bill.title, 120)}
                            </CardTitle>
                        </div>
                        <StatusBadge status={bill.currentStatus} />
                    </div>
                </CardHeader>

                <CardContent className="space-y-3">
                    {summary && (
                        <CardDescription className="line-clamp-3">
                            {truncate(summary, 200)}
                        </CardDescription>
                    )}

                    {bill.categories.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {bill.categories.slice(0, 3).map((category) => (
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
                        {bill.sponsor && (
                            <div className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                <span>
                                    {bill.sponsor.fullName} ({bill.sponsor.party}-{bill.sponsor.state})
                                </span>
                            </div>
                        )}
                        <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            <span>{formatDate(bill.introducedDate)}</span>
                        </div>
                    </div>
                </CardFooter>
            </Card>
        </Link>
    )
}
