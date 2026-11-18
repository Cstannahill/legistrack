"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet"
import { FilterPanel } from "./FilterPanel"

interface MobileFilterDrawerProps {
    categories: Array<{
        id: string
        name: string
        slug: string
        color?: string | null
    }>
}

export function MobileFilterDrawer({ categories }: MobileFilterDrawerProps) {
    const [open, setOpen] = useState(false)
    const searchParams = useSearchParams()

    const activeCount = [
        searchParams.get("type") && searchParams.get("type") !== "ALL",
        searchParams.get("status"),
        searchParams.get("category"),
        searchParams.get("showIncomplete") === "true",
    ].filter(Boolean).length

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="w-full justify-center gap-2 bg-card lg:hidden">
                    <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                    <span>Filters &amp; Categories</span>
                    {activeCount > 0 && (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 font-mono text-xs font-semibold text-primary-foreground">
                            {activeCount}
                        </span>
                    )}
                </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[300px] sm:w-[360px] overflow-y-auto">
                <SheetHeader>
                    <SheetTitle className="font-serif text-xl">Filter Legislation</SheetTitle>
                </SheetHeader>
                <div className="mt-6 pb-8">
                    <FilterPanel
                        categories={categories}
                        onSelectFilter={() => setOpen(false)}
                    />
                </div>
            </SheetContent>
        </Sheet>
    )
}
