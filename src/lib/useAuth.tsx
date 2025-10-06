"use client"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"

type User = { id: string; username?: string | null; email?: string | null; name?: string | null }

export function useAuth() {
    const [user, setUser] = useState<User | null>(null)
    const [loading, setLoading] = useState(true)
    const router = useRouter()

    useEffect(() => {
        let mounted = true

        async function load() {
            const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
            if (!token) {
                if (!mounted) return
                setUser(null)
                setLoading(false)
                return
            }
            try {
                const r = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } })
                const data = await r.json()
                if (!mounted) return
                setUser(data?.user ?? null)
            } catch {
                if (!mounted) return
                setUser(null)
            } finally {
                if (!mounted) return
                setLoading(false)
            }
        }

        load()

        // Listen for cross-tab storage events and in-page auth changes
        function onStorage(e: StorageEvent) {
            if (e.key === 'authToken') load()
        }
        function onAuthChanged() {
            load()
        }
        window.addEventListener('storage', onStorage)
        window.addEventListener('authChanged', onAuthChanged)

        return () => {
            mounted = false
            window.removeEventListener('storage', onStorage)
            window.removeEventListener('authChanged', onAuthChanged)
        }
    }, [])

    function logout() {
        if (typeof window !== 'undefined') {
            // Ask server to clear HttpOnly cookie, then notify listeners
            fetch('/api/logout', { method: 'POST' }).catch(() => { })
            if (typeof window !== 'undefined') window.dispatchEvent(new Event('authChanged'))
            router.push('/')
            setUser(null)
        }
    }

    return { user, loading, logout, setUser }
}
