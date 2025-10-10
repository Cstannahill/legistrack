"use client"
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function RegisterPage() {
    const [username, setUsername] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const router = useRouter()

    async function submit(e: React.FormEvent) {
        e.preventDefault()
        setLoading(true)
        setError(null)
        try {
            const res = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password }),
            })
            const body = await res.json()
            if (!res.ok) throw new Error(body?.error || 'Registration failed')
            // server set the auth cookie; notify listeners to re-check auth
            if (typeof window !== 'undefined') window.dispatchEvent(new Event('authChanged'))
            router.push('/')
        } catch (err: unknown) {
            const msg = err && typeof err === 'object' && 'message' in err ? (err as { message?: string }).message : String(err)
            setError(msg ?? 'Registration failed')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-[70vh] flex items-center justify-center py-12">
            <div className="w-full max-w-lg rounded-lg border bg-white p-8 shadow-md">
                <h1 className="mb-6 text-3xl font-semibold">Create an account</h1>
                <form onSubmit={submit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium">Username</label>
                        <input value={username} onChange={(e) => setUsername(e.target.value)} className="mt-2 w-full rounded border px-4 py-3" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium">Email</label>
                        <input value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 w-full rounded border px-4 py-3" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium">Password</label>
                        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 w-full rounded border px-4 py-3" />
                    </div>
                    {error && <div className="text-sm text-destructive">{error}</div>}
                    <div className="flex items-center justify-between">
                        <button disabled={loading} className="rounded bg-primary px-5 py-2 text-white">{loading ? 'Creating...' : 'Create account'}</button>
                        <a href="/login" className="text-sm text-muted-foreground">Already have an account?</a>
                    </div>
                </form>
            </div>
        </div>
    )
}
