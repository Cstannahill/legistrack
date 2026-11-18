"use client"

import { useState } from "react"
import { Sparkles } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FormattedText } from "@/components/ui/FormattedText"
import { ImpactAreasList, KeyPointsList, SummarySection } from "./SummarySection"
import { formatDate } from "@/lib/utils/date"
import { cn } from "@/lib/utils"

export interface SummaryEntry {
    summaryType: string
    content: string | null
    keyPoints?: string[] | null
    impactAreas?: string[] | null
    aiModel?: string | null
    generatedAt?: string | null
}

const DEPTH_META: Record<string, { label: string; description: string }> = {
    BRIEF: {
        label: "Brief",
        description: "Quick 2–3 sentence overview",
    },
    STANDARD: {
        label: "Standard",
        description: "Balanced plain-English summary",
    },
    DETAILED: {
        label: "Detailed",
        description: "In-depth section-by-section breakdown",
    },
}

const PREFERRED_ORDER = ["STANDARD", "BRIEF", "DETAILED"] as const

interface SummarySwitcherProps {
    summaries?: SummaryEntry[] | null
}

/**
 * Consolidates Brief, Standard, and Detailed AI summaries into a single focused card
 * with a clean segmented depth toggle.
 */
export function SummarySwitcher({ summaries }: SummarySwitcherProps) {
    const available = PREFERRED_ORDER.map((type) =>
        summaries?.find((s) => s.summaryType === type && Boolean(s.content))
    ).filter((s): s is SummaryEntry => Boolean(s))

    const defaultType = available[0]?.summaryType ?? "STANDARD"
    const [selectedType, setSelectedType] = useState<string>(defaultType)

    if (available.length === 0) {
        return (
            <Card>
                <CardContent className="py-10 text-center">
                    <Sparkles className="mx-auto mb-3 h-7 w-7 text-muted-foreground" aria-hidden="true" />
                    <p className="font-medium text-foreground">
                        AI summary pending
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Summaries are generated automatically from official legislative text and will appear here once processed.
                    </p>
                </CardContent>
            </Card>
        )
    }

    const active =
        available.find((s) => s.summaryType === selectedType) ?? available[0]
    const meta = DEPTH_META[active.summaryType] ?? {
        label: active.summaryType,
        description: "AI-generated legislative summary",
    }

    return (
        <Card>
            <CardHeader className="gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                    <CardTitle className="font-serif text-xl">
                        {meta.label} Summary
                    </CardTitle>
                    <CardDescription>{meta.description}</CardDescription>
                </div>

                {available.length > 1 && (
                    <div
                        role="tablist"
                        aria-label="Summary depth"
                        className="inline-flex w-fit items-center rounded-lg border border-border bg-muted p-1"
                    >
                        {["BRIEF", "STANDARD", "DETAILED"].map((depth) => {
                            const entry = available.find((a) => a.summaryType === depth)
                            if (!entry) return null
                            const isActive = active.summaryType === depth
                            return (
                                <button
                                    key={depth}
                                    type="button"
                                    role="tab"
                                    aria-selected={isActive}
                                    onClick={() => setSelectedType(depth)}
                                    className={cn(
                                        "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                                        isActive
                                            ? "bg-card text-foreground shadow-xs"
                                            : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    {DEPTH_META[depth]?.label ?? depth}
                                </button>
                            )
                        })}
                    </div>
                )}
            </CardHeader>

            <CardContent className="pt-6">
                <div className="max-w-[68ch] space-y-4">
                    <p className="text-[15.5px] leading-[1.75] text-foreground/95 whitespace-pre-line">
                        <FormattedText text={active.content || ""} />
                    </p>
                </div>

                {active.keyPoints && active.keyPoints.length > 0 && (
                    <SummarySection title="Key Points" variant="keyPoints">
                        <KeyPointsList points={active.keyPoints} />
                    </SummarySection>
                )}

                {active.impactAreas && active.impactAreas.length > 0 && (
                    <SummarySection title="Impact Areas" variant="impactAreas">
                        <ImpactAreasList areas={active.impactAreas} />
                    </SummarySection>
                )}

                <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-4 text-xs text-muted-foreground">
                    <span>
                        Generated by <span className="font-mono">{active.aiModel || "AI Model"}</span>
                    </span>
                    <span className="font-mono tabular-nums">
                        {active.generatedAt ? formatDate(active.generatedAt) : "—"}
                    </span>
                </div>
            </CardContent>
        </Card>
    )
}
