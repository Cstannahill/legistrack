// StatusBadge Component - Display bill status with appropriate colors
import { Badge } from '@/components/ui/badge'
import { BILL_STATUS_COLORS, BILL_STATUS_LABELS } from '@/lib/constants'
import { cn } from '@/lib/utils'

interface StatusBadgeProps {
    status: string
    className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
    const colorClass = BILL_STATUS_COLORS[status as keyof typeof BILL_STATUS_COLORS] || BILL_STATUS_COLORS.INTRODUCED
    const label = BILL_STATUS_LABELS[status as keyof typeof BILL_STATUS_LABELS] || status

    return (
        <Badge className={cn(colorClass, className)} variant="secondary">
            {label}
        </Badge>
    )
}
