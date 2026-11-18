"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { BrandMark } from "@/components/layout/BrandMark"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

export default function RegisterPage() {
    const [username, setUsername] = useState("")
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const router = useRouter()

    async function submit(e: React.FormEvent) {
        e.preventDefault()
        setLoading(true)
        setError(null)
        try {
            const res = await fetch("/api/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, email, password }),
            })
            const body = await res.json()
            if (!res.ok) throw new Error(body?.error || "Registration failed")
            if (typeof window !== "undefined") {
                window.dispatchEvent(new Event("authChanged"))
            }
            router.push("/")
        } catch (err: unknown) {
            const msg =
                err && typeof err === "object" && "message" in err
                    ? (err as { message?: string }).message
                    : String(err)
            setError(msg ?? "Registration failed")
        } finally {
            setLoading(false)
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
                        <CardTitle className="font-serif text-2xl">Create an account</CardTitle>
                        <CardDescription>
                            Free access to plain-English federal legislation tracking.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={submit} className="space-y-4">
                            <div className="space-y-1.5">
                                <label htmlFor="register-username" className="text-sm font-medium text-foreground">
                                    Username
                                </label>
                                <Input
                                    id="register-username"
                                    type="text"
                                    autoComplete="username"
                                    required
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label htmlFor="register-email" className="text-sm font-medium text-foreground">
                                    Email
                                </label>
                                <Input
                                    id="register-email"
                                    type="email"
                                    autoComplete="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="you@example.com"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label htmlFor="register-password" className="text-sm font-medium text-foreground">
                                    Password
                                </label>
                                <Input
                                    id="register-password"
                                    type="password"
                                    autoComplete="new-password"
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
                                {loading ? "Creating account..." : "Create account"}
                            </Button>

                            <p className="text-center text-sm text-muted-foreground">
                                Already have an account?{" "}
                                <Link href="/login" className="font-medium text-primary hover:underline">
                                    Sign in
                                </Link>
                            </p>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
