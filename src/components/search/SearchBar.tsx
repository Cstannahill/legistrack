// SearchBar Component - Search input with live suggestions
'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useDebouncedCallback } from 'use-debounce'

export function SearchBar() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [query, setQuery] = useState(searchParams.get('search') || '')

    const handleSearch = useDebouncedCallback((value: string) => {
        const params = new URLSearchParams(searchParams.toString())
        if (value) {
            params.set('search', value)
        } else {
            params.delete('search')
        }
        params.set('page', '1') // Reset to first page on new search
        router.push(`/bills?${params.toString()}`)
    }, 300)

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value
        setQuery(value)
        handleSearch(value)
    }

    return (
        <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
                type="search"
                placeholder='Search by title, bill # (HR 4398), or "exact word"...'
                className="pl-8 border border-slate-500"
                value={query}
                onChange={handleChange}
            />
        </div>
    )
}
