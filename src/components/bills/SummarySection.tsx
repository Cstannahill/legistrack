import { AlertCircle, CheckCircle2, Target } from "lucide-react"
import { FormattedText } from "@/components/ui/FormattedText"
import { cn } from "@/lib/utils"

interface SummarySectionProps {
    title: string
    children: React.ReactNode
    variant?: "keyPoints" | "impactAreas" | "default"
    className?: string
}

export function SummarySection({
    title,
    children,
    variant = "default",
    className,
}: SummarySectionProps) {
    const icon =
        variant === "keyPoints" ? (
            <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
        ) : variant === "impactAreas" ? (
            <Target className="h-4 w-4 text-primary" aria-hidden="true" />
        ) : (
            <AlertCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        )

    return (
        <section
            className={cn(
                "mt-5 rounded-lg border border-border/80 bg-muted/35 p-4 sm:p-5",
                className
            )}
        >
            <div className="mb-3 flex items-center gap-2">
                {icon}
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {title}
                </h4>
            </div>
            {children}
        </section>
    )
}

interface KeyPointsListProps {
    points: string[]
}

export function KeyPointsList({ points }: KeyPointsListProps) {
    return (
        <ul className="space-y-2.5">
            {points.map((point, idx) => (
                <li key={idx} className="flex items-start gap-3 text-sm leading-relaxed">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/12 font-mono text-[11px] font-semibold text-primary">
                        {idx + 1}
                    </span>
                    <span className="min-w-0 flex-1 text-foreground/90">
                        <FormattedText text={point} />
                    </span>
                </li>
            ))}
        </ul>
    )
}

interface ImpactAreasListProps {
    areas: string[]
}

export function ImpactAreasList({ areas }: ImpactAreasListProps) {
    return (
        <div className="flex flex-wrap gap-2">
            {areas.map((area, idx) => (
                <span
                    key={idx}
                    className="inline-flex max-w-full items-center rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground/85"
                >
                    <span className="break-words">
                        <FormattedText text={area} />
                    </span>
                </span>
            ))}
        </div>
    )
}
