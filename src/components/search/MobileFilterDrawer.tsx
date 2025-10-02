// MobileFilterDrawer - Mobile-friendly filter drawer with hamburger menu
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { FilterPanel } from './FilterPanel'
import { Filter } from 'lucide-react'

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

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="w-full lg:hidden">
                    <Filter className="mr-2 h-4 w-4" />
                    Filters & Categories
                </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[300px] sm:w-[400px] overflow-y-auto">
                <SheetHeader>
                    <SheetTitle>Filters</SheetTitle>
                </SheetHeader>
                <div className="mt-6">
                    <FilterPanel categories={categories} />
                </div>
            </SheetContent>
        </Sheet>
    )
}
