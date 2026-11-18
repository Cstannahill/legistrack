"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { LayoutGrid, List, X } from "lucide-react"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { BILL_STATUS_LABELS, LEGISLATION_TYPE_LABELS } from "@/lib/constants"
import { formatCount } from "@/lib/utils/formatting"
import { cn } from "@/lib/utils"

interface ActiveFiltersBarProps {
    total: number
    startIndex: number
    endIndex: number
    categories: Array<{ id: string; name: string; slug: string }>
    currentSort: string
    currentView: "list" | "grid"
}

export function ActiveFiltersBar({
    total,
    startIndex,
    endIndex,
    categories,
    currentSort,
    currentView,
}: ActiveFiltersBarProps) {
    const router = useRouter()
    const searchParams = useSearchParams()

    const type = searchParams.get("type")
    const status = searchParams.get("status")
    const category = searchParams.get("category")
    const search = searchParams.get("search")
    const showIncomplete = searchParams.get("showIncomplete") === "true"

    const categoryName = category
        ? categories.find((c) => c.slug === category)?.name || category
        : null

    const updateParam = (key: string, value: string | null, resetPage = true) => {
        const params = new URLSearchParams(searchParams.toString())
        if (value) {
            params.set(key, value)
        } else {
            params.delete(key)
        }
        if (resetPage) params.set("page", "1")
        const qs = params.toString()
        router.push(qs ? `/bills?${qs}` : "/bills")
    }

    const clearAll = () => {
        const params = new URLSearchParams()
        if (currentSort !== "newest") params.set("sort", currentSort)
        if (currentView === "grid") params.set("view", "grid")
        const qs = params.toString()
        router.push(qs ? `/bills?${qs}` : "/bills")
    }

    const activeChips: Array<{ key: string; label: string }> = []
    if (type && type !== "ALL") {
        activeChips.push({
            key: "type",
            label:
                LEGISLATION_TYPE_LABELS[type as keyof typeof LEGISLATION_TYPE_LABELS] ||
                type,
        })
    }
    if (status) {
        activeChips.push({
            key: "status",
            label:
                BILL_STATUS_LABELS[status as keyof typeof BILL_STATUS_LABELS] || status,
        })
    }
    if (category && categoryName) {
        activeChips.push({ key: "category", label: categoryName })
    }
    if (search) {
        activeChips.push({ key: "search", label: `"${search}"` })
    }
    if (showIncomplete) {
        activeChips.push({ key: "showIncomplete", label: "Including incomplete" })
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                    {total === 0 ? (
                        "No matching items"
                    ) : (
                        <>
                            Showing{" "}
                            <span className="font-mono font-medium text-foreground tabular-nums">
                                {formatCount(startIndex)}&ndash;{formatCount(endIndex)}
                            </span>{" "}
                            of{" "}
                            <span className="font-mono font-medium text-foreground tabular-nums">
                                {formatCount(total)}
                            </span>{" "}
                            items
                        </>
                    )}
                </p>

                <div className="flex items-center gap-2">
                    <Select
                        value={currentSort}
                        onValueChange={(value) =>
                            updateParam("sort", value === "newest" ? null : value)
                        }
                    >
                        <SelectTrigger size="sm" aria-label="Sort legislation" className="bg-card">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="newest">Newest first</SelectItem>
                            <SelectItem value="updated">Recently updated</SelectItem>
                            <SelectItem value="oldest">Oldest first</SelectItem>
                        </SelectContent>
                    </Select>

                    <div
                        role="group"
                        aria-label="Layout view"
                        className="inline-flex rounded-md border border-border bg-card p-0.5 shadow-xs"
                    >
                        <button
                            type="button"
                            onClick={() => updateParam("view", null, false)}
                            aria-label="List view"
                            aria-pressed={currentView === "list"}
                            className={cn(
                                "inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors",
                                currentView === "list"
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <List className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            onClick={() => updateParam("view", "grid", false)}
                            aria-label="Grid view"
                            aria-pressed={currentView === "grid"}
                            className={cn(
                                "inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors",
                                currentView === "grid"
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                    </div>
                </div>
            </div>

            {activeChips.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                        Active:
                    </span>
                    {activeChips.map((chip) => (
                        <button
                            key={chip.key}
                            type="button"
                            onClick={() => updateParam(chip.key, null)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground transition-colors hover:bg-primary/15"
                        >
                            <span>{chip.label}</span>
                            <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={clearAll}
                        className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                        Clear all
                    </button>
                </div>
            )}
        </div>
    )
}
