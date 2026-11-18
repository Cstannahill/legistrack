"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    BILL_STATUS_LABELS,
    BILL_STATUS_TONES,
    LEGISLATION_TYPE_LABELS,
    SEMANTIC_TONE_DOT_CLASSES,
} from "@/lib/constants"
import { cn } from "@/lib/utils"

interface FilterPanelProps {
    categories: Array<{
        id: string
        name: string
        slug: string
        color?: string | null
    }>
    onSelectFilter?: () => void
}

export function FilterPanel({ categories, onSelectFilter }: FilterPanelProps) {
    const router = useRouter()
    const searchParams = useSearchParams()

    const currentType = searchParams.get("type") || "ALL"
    const currentStatus = searchParams.get("status")
    const currentCategory = searchParams.get("category")
    const showIncomplete = searchParams.get("showIncomplete") === "true"

    const updateFilter = (key: string, value: string | null) => {
        const params = new URLSearchParams(searchParams.toString())
        if (value) {
            params.set(key, value)
        } else {
            params.delete(key)
        }
        params.set("page", "1")
        const qs = params.toString()
        router.push(qs ? `/bills?${qs}` : "/bills")
        onSelectFilter?.()
    }

    const handleTypeChange = (value: string) => {
        const params = new URLSearchParams(searchParams.toString())
        if (value === "ALL") {
            params.delete("type")
        } else {
            params.set("type", value)
        }

        if (value === "EXECUTIVE_ORDERS") {
            params.delete("congress")
            params.delete("status")
        }

        params.set("page", "1")
        const qs = params.toString()
        router.push(qs ? `/bills?${qs}` : "/bills")
        onSelectFilter?.()
    }

    const clearFilters = () => {
        router.push("/bills")
        onSelectFilter?.()
    }

    const hasActiveFilters = Boolean(
        currentStatus || currentCategory || currentType !== "ALL" || showIncomplete
    )

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    Filters
                </h2>
                {hasActiveFilters && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearFilters}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                        <X className="h-3 w-3" aria-hidden="true" />
                        Clear
                    </Button>
                )}
            </div>

            {/* Type Filter */}
            <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-foreground">
                    Legislation Type
                </legend>
                <Select value={currentType} onValueChange={handleTypeChange}>
                    <SelectTrigger className="w-full bg-card">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {Object.entries(LEGISLATION_TYPE_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                                {label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </fieldset>

            {/* Full-text availability toggle */}
            {currentType !== "EXECUTIVE_ORDERS" && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/60 px-3 py-2.5">
                    <label
                        htmlFor="filter-show-incomplete"
                        className="cursor-pointer text-xs font-medium leading-snug text-foreground/90"
                    >
                        Include bills without full text
                    </label>
                    <Switch
                        id="filter-show-incomplete"
                        checked={showIncomplete}
                        onCheckedChange={(checked) =>
                            updateFilter("showIncomplete", checked ? "true" : null)
                        }
                    />
                </div>
            )}

            {/* Status Filter - Only for bills */}
            {currentType !== "EXECUTIVE_ORDERS" && (
                <fieldset className="space-y-2">
                    <legend className="text-sm font-medium text-foreground">Status</legend>
                    <div className="space-y-0.5">
                        {Object.entries(BILL_STATUS_LABELS).map(([value, label]) => {
                            const selected = currentStatus === value
                            const tone =
                                BILL_STATUS_TONES[value as keyof typeof BILL_STATUS_TONES] ||
                                "neutral"
                            const dotClass = SEMANTIC_TONE_DOT_CLASSES[tone]

                            return (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() =>
                                        updateFilter("status", selected ? null : value)
                                    }
                                    aria-pressed={selected}
                                    className={cn(
                                        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                                        selected
                                            ? "bg-accent font-medium text-accent-foreground"
                                            : "text-foreground/80 hover:bg-muted hover:text-foreground"
                                    )}
                                >
                                    <span
                                        className={cn("h-2 w-2 shrink-0 rounded-full", dotClass)}
                                        aria-hidden="true"
                                    />
                                    <span className="flex-1 truncate">{label}</span>
                                    {selected && (
                                        <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                                    )}
                                </button>
                            )
                        })}
                    </div>
                </fieldset>
            )}

            {/* Category Filter */}
            <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-foreground">
                    Policy Areas
                </legend>
                <div className="space-y-0.5">
                    {categories.map((category) => {
                        const selected = currentCategory === category.slug
                        return (
                            <button
                                key={category.id}
                                type="button"
                                onClick={() =>
                                    updateFilter(
                                        "category",
                                        selected ? null : category.slug
                                    )
                                }
                                aria-pressed={selected}
                                className={cn(
                                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                                    selected
                                        ? "bg-accent font-medium text-accent-foreground"
                                        : "text-foreground/80 hover:bg-muted hover:text-foreground"
                                )}
                            >
                                {category.color && (
                                    <span
                                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                                        style={{ backgroundColor: category.color }}
                                        aria-hidden="true"
                                    />
                                )}
                                <span className="flex-1 truncate">{category.name}</span>
                                {selected && (
                                    <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                                )}
                            </button>
                        )
                    })}
                </div>
            </fieldset>
        </div>
    )
}
