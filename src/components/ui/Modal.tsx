"use client"
import { useEffect, useRef } from 'react'

type ModalProps = React.PropsWithChildren<{
    open: boolean
    onClose: () => void
    title?: string
}>

export default function Modal({ open, onClose, title, children }: ModalProps) {
    const ref = useRef<HTMLDivElement | null>(null)
    const previouslyFocused = useRef<HTMLElement | null>(null)

    useEffect(() => {
        if (!open) return
        previouslyFocused.current = document.activeElement as HTMLElement | null
        // Move focus to the modal container
        setTimeout(() => {
            ref.current?.focus()
        }, 0)

        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose()
            if (e.key === 'Tab') {
                // basic focus trap
                const focusable = ref.current?.querySelectorAll<HTMLElement>(
                    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
                )
                if (!focusable || focusable.length === 0) return
                const first = focusable[0]
                const last = focusable[focusable.length - 1]
                if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault()
                    first.focus()
                }
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault()
                    last.focus()
                }
            }
        }

        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('keydown', onKey)
            previouslyFocused.current?.focus()
        }
    }, [open, onClose])

    if (!open) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div
                ref={ref}
                role="dialog"
                aria-modal="true"
                aria-label={title ?? 'Dialog'}
                tabIndex={-1}
                className="max-h-[90vh] w-full max-w-md overflow-auto rounded bg-white p-6 shadow-lg">
                {title && <h2 className="mb-2 text-lg font-semibold">{title}</h2>}
                {children}
            </div>
        </div>
    )
}
