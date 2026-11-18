"use client"

import { useEffect, useRef, useState } from "react"
import { Search, X } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { useDebouncedCallback } from "use-debounce"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export function SearchBar() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const urlSearch = searchParams.get("search") || ""
    const [query, setQuery] = useState(urlSearch)
    const inputRef = useRef<HTMLInputElement | null>(null)

    useEffect(() => {
        setQuery(urlSearch)
    }, [urlSearch])

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (e.key !== "/") return
            const target = e.target as HTMLElement | null
            if (
                target &&
                (target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.tagName === "SELECT" ||
                    target.isContentEditable)
            ) {
                return
            }
            e.preventDefault()
            inputRef.current?.focus()
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [])

    const handleSearch = useDebouncedCallback((value: string) => {
        const params = new URLSearchParams(searchParams.toString())
        if (value.trim()) {
            params.set("search", value.trim())
        } else {
            params.delete("search")
        }
        params.set("page", "1")
        router.push(`/bills?${params.toString()}`)
    }, 300)

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value
        setQuery(value)
        handleSearch(value)
    }

    const handleClear = () => {
        setQuery("")
        handleSearch.cancel()
        const params = new URLSearchParams(searchParams.toString())
        params.delete("search")
        params.set("page", "1")
        router.push(`/bills?${params.toString()}`)
        inputRef.current?.focus()
    }

    return (
        <div className="relative w-full">
            <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
            />
            <Input
                ref={inputRef}
                type="search"
                value={query}
                onChange={handleChange}
                aria-label="Search federal legislation"
                placeholder='Search by title, bill # (HR 4398, EO 14111), or "exact phrase"...'
                className={cn(
                    "h-11 w-full rounded-lg bg-card pl-10 text-sm shadow-xs",
                    query ? "pr-11 sm:pr-12" : "pr-4 sm:pr-12"
                )}
            />
            <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
                {query ? (
                    <button
                        type="button"
                        onClick={handleClear}
                        aria-label="Clear search"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                ) : (
                    <kbd
                        aria-hidden="true"
                        className="hidden sm:inline-flex h-5 items-center rounded border border-border bg-muted/70 px-1.5 font-mono text-[11px] font-medium text-muted-foreground"
                    >
                        /
                    </kbd>
                )}
            </div>
        </div>
    )
}
