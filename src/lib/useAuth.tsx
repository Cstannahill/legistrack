"use client"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"

type User = { id: string; username?: string | null; email?: string | null; name?: string | null }

export function useAuth() {
    const [user, setUser] = useState<User | null>(null)
    const [loading, setLoading] = useState(true)
    const router = useRouter()

    useEffect(() => {
        const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
        if (!token) {
            setUser(null)
            setLoading(false)
            return
        }
        fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } })
            .then((r) => r.json())
            .then((data) => {
                setUser(data?.user ?? null)
            })
            .catch(() => setUser(null))
            .finally(() => setLoading(false))
    }, [])

    function logout() {
        if (typeof window !== 'undefined') {
            localStorage.removeItem('authToken')
            router.push('/')
            setUser(null)
        }
    }

    return { user, loading, logout, setUser }
}
