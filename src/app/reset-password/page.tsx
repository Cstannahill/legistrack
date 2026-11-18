"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { BrandMark } from "@/components/layout/BrandMark"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

function ResetPasswordInner() {
    const params = useSearchParams()
    const token = params.get("token") ?? ""
    const router = useRouter()
    const [password, setPassword] = useState("")
    const [confirm, setConfirm] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!token) setError("Missing reset token")
    }, [token])

    async function submit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        if (password.length < 8) {
            return setError("Password must be at least 8 characters")
        }
        if (password !== confirm) {
            return setError("Passwords do not match")
        }
        setLoading(true)
        try {
            const res = await fetch("/api/auth/reset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, newPassword: password }),
            })
            const body = await res.json()
            if (!res.ok) throw new Error(body?.error || "Reset failed")
            if (typeof window !== "undefined") {
                window.dispatchEvent(new Event("authChanged"))
            }
            router.push("/")
        } catch (err: unknown) {
            const msg =
                err && typeof err === "object" && "message" in err
                    ? (err as { message?: string }).message
                    : String(err)
            setError(msg ?? "Reset failed")
        } finally {
            setLoading(false)
        }
    }

    return (
        <Card className="w-full max-w-md">
            <CardHeader>
                <CardTitle className="font-serif text-2xl">Reset password</CardTitle>
                <CardDescription>
                    Choose a new password for your LegisTrack account.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={submit} className="space-y-4">
                    <div className="space-y-1.5">
                        <label htmlFor="reset-password" className="text-sm font-medium text-foreground">
                            New password
                        </label>
                        <Input
                            id="reset-password"
                            type="password"
                            autoComplete="new-password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label htmlFor="reset-confirm" className="text-sm font-medium text-foreground">
                            Confirm password
                        </label>
                        <Input
                            id="reset-confirm"
                            type="password"
                            autoComplete="new-password"
                            required
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
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

                    <Button type="submit" disabled={loading || !token} className="w-full">
                        {loading ? "Updating..." : "Update password"}
                    </Button>

                    <p className="text-center text-sm text-muted-foreground">
                        <Link href="/login" className="font-medium text-primary hover:underline">
                            Return to sign in
                        </Link>
                    </p>
                </form>
            </CardContent>
        </Card>
    )
}

export default function ResetPasswordPage() {
    return (
        <div className="container flex min-h-[75vh] items-center justify-center py-12">
            <div className="w-full max-w-md space-y-6">
                <div className="flex flex-col items-center text-center space-y-2">
                    <BrandMark className="h-10 w-10" />
                    <span className="font-serif text-xl font-semibold tracking-tight text-foreground">
                        LegisTrack
                    </span>
                </div>
                <Suspense
                    fallback={
                        <div className="text-center text-sm text-muted-foreground">
                            Loading...
                        </div>
                    }
                >
                    <ResetPasswordInner />
                </Suspense>
            </div>
        </div>
    )
}
