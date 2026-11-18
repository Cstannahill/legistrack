"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"

interface BackLinkProps {
    fallbackHref: string
    label: string
}

/**
 * Navigates back to the caller's filtered list view when coming from the same origin,
 * otherwise routes cleanly to fallbackHref.
 */
export function BackLink({ fallbackHref, label }: BackLinkProps) {
    const router = useRouter()

    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
        if (typeof window === "undefined") return
        try {
            if (document.referrer) {
                const ref = new URL(document.referrer)
                if (
                    ref.origin === window.location.origin &&
                    ref.pathname.startsWith("/bills") &&
                    window.history.length > 1
                ) {
                    e.preventDefault()
                    router.back()
                }
            }
        } catch {
            // Fall back to default Link navigation
        }
    }

    return (
        <Link
            href={fallbackHref}
            onClick={handleClick}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>{label}</span>
        </Link>
    )
}
