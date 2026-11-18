"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { BrandMark } from "@/components/layout/BrandMark"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

export default function LoginPage() {
    const [username, setUsername] = useState("")
    const [password, setPassword] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [forgotOpen, setForgotOpen] = useState(false)
    const [forgotEmail, setForgotEmail] = useState("")
    const [forgotStatus, setForgotStatus] = useState<string | null>(null)
    const [forgotSending, setForgotSending] = useState(false)
    const router = useRouter()

    async function submit(e: React.FormEvent) {
        e.preventDefault()
        setLoading(true)
        setError(null)
        try {
            const res = await fetch("/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
            })
            const body = await res.json()
            if (!res.ok) throw new Error(body?.error || "Login failed")
            if (typeof window !== "undefined") {
                window.dispatchEvent(new Event("authChanged"))
            }
            router.push("/")
        } catch (err: unknown) {
            const msg =
                err && typeof err === "object" && "message" in err
                    ? (err as { message?: string }).message
                    : String(err)
            setError(msg ?? "Login failed")
        } finally {
            setLoading(false)
        }
    }

    async function sendForgotEmail(e: React.FormEvent) {
        e.preventDefault()
        setForgotStatus(null)
        setForgotSending(true)
        try {
            const res = await fetch("/api/auth/forgot", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: forgotEmail }),
            })
            if (res.status === 429) {
                setForgotStatus("Too many attempts. Try again later.")
                return
            }
            if (!res.ok) throw new Error("Unable to send")
            setForgotStatus("If an account exists, we have sent a reset email.")
            setTimeout(() => {
                setForgotOpen(false)
                setForgotEmail("")
                setForgotStatus(null)
            }, 2200)
        } catch {
            setForgotStatus("Unable to send email. Try again later.")
        } finally {
            setForgotSending(false)
        }
    }

    return (
        <div className="container flex min-h-[75vh] items-center justify-center py-12">
            <div className="w-full max-w-md space-y-6">
                <div className="flex flex-col items-center text-center space-y-2">
                    <BrandMark className="h-10 w-10" />
                    <span className="font-serif text-xl font-semibold tracking-tight text-foreground">
                        LegisTrack
                    </span>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle className="font-serif text-2xl">Sign in</CardTitle>
                        <CardDescription>
                            Enter your username or email to access your account.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={submit} className="space-y-4">
                            <div className="space-y-1.5">
                                <label htmlFor="login-username" className="text-sm font-medium text-foreground">
                                    Username or email
                                </label>
                                <Input
                                    id="login-username"
                                    type="text"
                                    autoComplete="username"
                                    required
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <label htmlFor="login-password" className="text-sm font-medium text-foreground">
                                        Password
                                    </label>
                                    <button
                                        type="button"
                                        onClick={() => setForgotOpen(true)}
                                        className="text-xs font-medium text-primary hover:underline"
                                    >
                                        Forgot password?
                                    </button>
                                </div>
                                <Input
                                    id="login-password"
                                    type="password"
                                    autoComplete="current-password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </div>

                            {error && (
                                <div
                                    role="alert"
                                    className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                                >
                                    {error}
                                </div>
                            )}

                            <Button type="submit" disabled={loading} className="w-full">
                                {loading ? "Signing in..." : "Sign in"}
                            </Button>

                            <p className="text-center text-sm text-muted-foreground">
                                New to LegisTrack?{" "}
                                <Link href="/register" className="font-medium text-primary hover:underline">
                                    Create an account
                                </Link>
                            </p>
                        </form>
                    </CardContent>
                </Card>
            </div>

            <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="font-serif text-xl">
                            Reset your password
                        </DialogTitle>
                        <DialogDescription>
                            Enter your email address and we will send a reset link if an account exists.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={sendForgotEmail} className="space-y-4">
                        <div className="space-y-1.5">
                            <label htmlFor="forgot-email" className="text-sm font-medium text-foreground">
                                Email address
                            </label>
                            <Input
                                id="forgot-email"
                                type="email"
                                required
                                autoFocus
                                value={forgotEmail}
                                onChange={(e) => setForgotEmail(e.target.value)}
                                placeholder="you@example.com"
                            />
                        </div>
                        {forgotStatus && (
                            <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
                                {forgotStatus}
                            </div>
                        )}
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => setForgotOpen(false)}
                            >
                                Cancel
                            </Button>
                            <Button type="submit" disabled={forgotSending}>
                                {forgotSending ? "Sending..." : "Send reset link"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
