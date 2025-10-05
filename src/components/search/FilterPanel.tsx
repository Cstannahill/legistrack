// FilterPanel Component - Sidebar filters for bills
'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { BILL_STATUS_LABELS, CURRENT_CONGRESS, LEGISLATION_TYPE_LABELS } from '@/lib/constants'
import { X } from 'lucide-react'

interface FilterPanelProps {
    categories: Array<{
        id: string
        name: string
        slug: string
        color?: string | null
    }>
}

export function FilterPanel({ categories }: FilterPanelProps) {
    const router = useRouter()
    const searchParams = useSearchParams()

    const currentType = searchParams.get('type') || 'ALL'
    const currentStatus = searchParams.get('status')
    const currentCategory = searchParams.get('category')
    const currentCongress = searchParams.get('congress') || String(CURRENT_CONGRESS)
    const showIncomplete = searchParams.get('showIncomplete') === 'true'

    const updateFilter = (key: string, value: string | null) => {
        const params = new URLSearchParams(searchParams.toString())
        if (value) {
            params.set(key, value)
        } else {
            params.delete(key)
        }
        params.set('page', '1') // Reset to first page
        router.push(`/bills?${params.toString()}`)
    }

    const clearFilters = () => {
        router.push('/bills')
    }

    const hasActiveFilters = currentStatus || currentCategory || currentType !== 'ALL' || showIncomplete

    return (
        <div className="space-y-6">
            <div>
                <div className="mb-2 flex items-center justify-between">
                    <h3 className="font-semibold">Filters</h3>
                    {hasActiveFilters && (
                        <Button variant="ghost" size="sm" onClick={clearFilters}>
                            <X className="mr-1 h-3 w-3" />
                            Clear
                        </Button>
                    )}
                </div>
            </div>

            {/* Show Incomplete Bills Toggle - Only for bills */}
            {currentType !== 'EXECUTIVE_ORDERS' && (
                <div className="rounded-lg border bg-muted/50 p-4">
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <label htmlFor="show-incomplete" className="text-sm font-medium">
                                Show Incomplete Bills
                            </label>
                            <p className="text-xs text-muted-foreground">
                                Include bills without full text
                            </p>
                        </div>
                        <Switch
                            id="show-incomplete"
                            checked={showIncomplete}
                            onCheckedChange={(checked) => {
                                updateFilter('showIncomplete', checked ? 'true' : null)
                            }}
                        />
                    </div>
                </div>
            )}

            {/* Type Filter */}
            <div>
                <label className="mb-2 block text-sm font-medium">Type</label>
                <Select value={currentType} onValueChange={(value) => updateFilter('type', value === 'ALL' ? null : value)}>
                    <SelectTrigger>
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
            </div>

            {/* Congress Filter - Only for bills */}
            {currentType !== 'EXECUTIVE_ORDERS' && (
                <div>
                    <label className="mb-2 block text-sm font-medium">Congress</label>
                    <Select value={currentCongress} onValueChange={(value) => updateFilter('congress', value)}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={String(CURRENT_CONGRESS)}>{CURRENT_CONGRESS}th Congress</SelectItem>
                            <SelectItem value={String(CURRENT_CONGRESS - 1)}>
                                {CURRENT_CONGRESS - 1}th Congress
                            </SelectItem>
                            <SelectItem value={String(CURRENT_CONGRESS - 2)}>
                                {CURRENT_CONGRESS - 2}th Congress
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            )}

            {/* Status Filter - Only for bills */}
            {currentType !== 'EXECUTIVE_ORDERS' && (
                <div>
                    <label className="mb-2 block text-sm font-medium">Status</label>
                    <div className="space-y-1">
                        {Object.entries(BILL_STATUS_LABELS).map(([value, label]) => (
                            <button
                                key={value}
                                onClick={() => updateFilter('status', currentStatus === value ? null : value)}
                                aria-pressed={currentStatus === value}
                                className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 hover:bg-accent/80 active:scale-[0.996] ${currentStatus === value ? 'bg-accent font-medium shadow-sm' : 'bg-transparent'} `}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Category Filter */}
            <div>
                <label className="mb-2 block text-sm font-medium">Categories</label>
                <div className="space-y-1">
                    {categories.map((category) => (
                        <button
                            key={category.id}
                            onClick={() =>
                                updateFilter('category', currentCategory === category.slug ? null : category.slug)
                            }
                            aria-pressed={currentCategory === category.slug}
                            className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 hover:bg-accent/80 active:scale-[0.996] ${currentCategory === category.slug ? 'bg-accent font-medium shadow-sm' : 'bg-transparent'}`}
                        >
                            {category.color && (
                                <div
                                    className="h-3 w-3 rounded-full shrink-0"
                                    style={{ backgroundColor: category.color }}
                                />
                            )}
                            <span className="flex-1">{category.name}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}
