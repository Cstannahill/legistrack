import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CheckCircle2, Target, AlertCircle } from "lucide-react";
import { FormattedText } from "@/components/ui/FormattedText";

interface SummarySectionProps {
    title: string;
    children: React.ReactNode;
    variant?: 'keyPoints' | 'impactAreas' | 'default';
    className?: string;
}

export function SummarySection({
    title,
    children,
    variant = 'default',
    className
}: SummarySectionProps) {
    const getIcon = () => {
        switch (variant) {
            case 'keyPoints':
                return <CheckCircle2 className="h-4 w-4" />;
            case 'impactAreas':
                return <Target className="h-4 w-4" />;
            default:
                return <AlertCircle className="h-4 w-4" />;
        }
    };

    const getColorClasses = () => {
        switch (variant) {
            case 'keyPoints':
                return 'border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20';
            case 'impactAreas':
                return 'border-purple-200 bg-purple-50/50 dark:border-purple-900 dark:bg-purple-950/20';
            default:
                return 'border-gray-200 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/20';
        }
    };

    return (
        <Card className={cn(
            "mt-4 border-l-4",
            getColorClasses(),
            className
        )}>
            <div className="p-4">
                <div className="mb-3 flex items-center gap-2">
                    {getIcon()}
                    <h4 className="font-semibold text-sm uppercase tracking-wide">
                        {title}
                    </h4>
                </div>
                {children}
            </div>
        </Card>
    );
}

interface KeyPointsListProps {
    points: string[];
}

export function KeyPointsList({ points }: KeyPointsListProps) {
    return (
        <ul className="space-y-2">
            {points.map((point: string, idx: number) => (
                <li key={idx} className="flex items-start gap-2 text-sm">
                    <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                        {idx + 1}
                    </span>
                    <span className="leading-relaxed">
                        <FormattedText text={point} />
                    </span>
                </li>
            ))}
        </ul>
    );
}

interface ImpactAreasListProps {
    areas: string[];
}

export function ImpactAreasList({ areas }: ImpactAreasListProps) {
    return (
        <div className="flex flex-wrap gap-2">
            {areas.map((area: string, idx: number) => (
                <Badge
                    key={idx}
                    variant="secondary"
                    className="bg-purple-100 text-purple-800 hover:bg-purple-200 dark:bg-purple-900 dark:text-purple-200"
                >
                    <FormattedText text={area} />
                </Badge>
            ))}
        </div>
    );
}
