"use client"
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/components/ui/Modal'
import AutoFocusOnOpen from '@/components/ui/AutoFocusOnOpen'

export default function LoginPage() {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [forgotOpen, setForgotOpen] = useState(false)
    const [forgotEmail, setForgotEmail] = useState('')
    const [forgotStatus, setForgotStatus] = useState<string | null>(null)
    const router = useRouter()

    async function submit(e: React.FormEvent) {
        e.preventDefault()
        setLoading(true)
        setError(null)
        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            })
            const body = await res.json()
            if (!res.ok) throw new Error(body?.error || 'Login failed')
            localStorage.setItem('authToken', body.authToken)
            router.push('/')
        } catch (err: unknown) {
            const msg = err && typeof err === 'object' && 'message' in err ? (err as { message?: string }).message : String(err)
            setError(msg ?? 'Login failed')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-[70vh] flex items-center justify-center py-12">
            <div className="w-full max-w-lg rounded-lg border bg-white p-8 shadow-md">
                <h1 className="mb-6 text-3xl font-semibold">Sign in to LegisTrack</h1>
                <form onSubmit={submit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium">Username</label>
                        <input value={username} onChange={(e) => setUsername(e.target.value)} className="mt-2 w-full rounded border px-4 py-3" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium">Password</label>
                        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 w-full rounded border px-4 py-3" />
                    </div>
                    {error && <div className="text-sm text-destructive">{error}</div>}
                    <div className="flex items-center justify-between">
                        <button disabled={loading} className="rounded bg-primary px-5 py-2 text-white">{loading ? 'Signing in...' : 'Sign in'}</button>
                        <button type="button" onClick={() => setForgotOpen(true)} className="text-sm text-muted-foreground">Forgot Password?</button>
                    </div>
                </form>
            </div>

            <Modal open={forgotOpen} onClose={() => setForgotOpen(false)} title="Reset your password">
                <p className="mb-4 text-sm text-muted-foreground">Enter your email and we will send a reset link if the account exists.</p>
                <input
                    ref={null}
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="mb-3 w-full rounded border px-3 py-2"
                    id="forgot-email"
                />
                {/* aria-live region for screen readers */}
                <div role="status" aria-live="polite" className="mb-2 text-sm">
                    {forgotStatus}
                </div>
                <div className="flex justify-end gap-2">
                    <button onClick={() => setForgotOpen(false)} className="rounded px-3 py-2">Cancel</button>
                    <button onClick={async () => {
                        setForgotStatus(null)
                        try {
                            const res = await fetch('/api/auth/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: forgotEmail }) })
                            if (res.status === 429) {
                                setForgotStatus('Too many attempts. Try again later.')
                                return
                            }
                            if (!res.ok) throw new Error('Unable to send')
                            setForgotStatus('If an account exists we have sent a reset email.')
                            // Auto-close after a short delay
                            setTimeout(() => {
                                setForgotOpen(false)
                                setForgotEmail('')
                                setForgotStatus(null)
                            }, 2200)
                        } catch {
                            setForgotStatus('Unable to send email. Try again later.')
                        }
                    }} className="rounded bg-primary px-3 py-2 text-white">Send</button>
                </div>
                {/* autofocus the input when modal opens */}
                <AutoFocusOnOpen open={forgotOpen} selector="#forgot-email" />
            </Modal>
        </div>
    )
}
