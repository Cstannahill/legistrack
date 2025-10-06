"use client"
import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

export default function ResetPasswordPage() {
    const params = useSearchParams()
    const token = params.get('token') ?? ''
    const router = useRouter()
    const [password, setPassword] = useState('')
    const [confirm, setConfirm] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!token) setError('Missing reset token')
    }, [token])

    async function submit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        if (password.length < 8) return setError('Password must be at least 8 characters')
        if (password !== confirm) return setError('Passwords do not match')
        setLoading(true)
        try {
            const res = await fetch('/api/auth/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, newPassword: password }) })
            const body = await res.json()
            if (!res.ok) throw new Error(body?.error || 'Reset failed')
            localStorage.setItem('authToken', body.authToken)
            router.push('/')
        } catch (err: unknown) {
            const msg = err && typeof err === 'object' && 'message' in err ? (err as { message?: string }).message : String(err)
            setError(msg ?? 'Reset failed')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-[70vh] flex items-center justify-center py-12">
            <div className="w-full max-w-md rounded-lg border bg-white p-8 shadow-md">
                <h1 className="mb-4 text-2xl font-semibold">Reset password</h1>
                <form onSubmit={submit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium">New password</label>
                        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 w-full rounded border px-4 py-3" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium">Confirm password</label>
                        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-2 w-full rounded border px-4 py-3" />
                    </div>
                    {error && <div className="text-sm text-destructive">{error}</div>}
                    <div className="flex justify-end">
                        <button disabled={loading} className="rounded bg-primary px-4 py-2 text-white">{loading ? 'Updating...' : 'Update password'}</button>
                    </div>
                </form>
            </div>
        </div>
    )
}
