"use client"
import { useEffect } from 'react'

export default function AutoFocusOnOpen({ open, selector }: { open: boolean; selector: string }) {
    useEffect(() => {
        if (!open) return
        const el = document.querySelector<HTMLInputElement>(selector)
        if (el) el.focus()
    }, [open, selector])
    return null
}
