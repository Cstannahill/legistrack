import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "./StatusBadge"
import { CategoryBadge } from "./CategoryBadge"
import type { LegislationCategory } from "@/types/legislation"
import { cn } from "@/lib/utils"

interface LegislationHeaderProps {
    identifier: string
    title: string
    shortTitle?: string | null
    congress?: number
    status?: string
    typeBadge?: { label: string; className?: string }
    companionIdentifiers?: Array<{ id: string; label: string }>
    categories?: LegislationCategory[]
}

export function LegislationHeader({
    identifier,
    title,
    shortTitle,
    congress,
    status,
    typeBadge,
    companionIdentifiers = [],
    categories = [],
}: LegislationHeaderProps) {
    return (
        <header className="space-y-4 border-b border-border/70 pb-6">
            <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs font-semibold">
                    {identifier}
                </Badge>
                {companionIdentifiers.map((companion) => (
                    <Badge
                        key={companion.id}
                        variant="outline"
                        className="font-mono text-xs text-muted-foreground"
                    >
                        Companion: {companion.label}
                    </Badge>
                ))}
                {congress !== undefined && (
                    <span className="text-sm font-medium text-muted-foreground">
                        {congress}th Congress
                    </span>
                )}
                {typeBadge && (
                    <span
                        className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                            typeBadge.className
                        )}
                    >
                        {typeBadge.label}
                    </span>
                )}
                {status && <StatusBadge status={status} />}
            </div>

            <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-3xl lg:text-[2.25rem] lg:leading-[1.15]">
                {title}
            </h1>

            {shortTitle && shortTitle !== title && (
                <p className="text-sm text-muted-foreground sm:text-base">
                    Short title: <span className="font-medium text-foreground/90">{shortTitle}</span>
                </p>
            )}

            {categories.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                    {categories.map((category) => (
                        <CategoryBadge key={category.id} category={category} linked />
                    ))}
                </div>
            )}
        </header>
    )
}
