"use client"
// Header Navigation Component
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Scale, Bell, User as UserIcon, LogOut } from 'lucide-react'
import { useAuth } from '@/lib/useAuth'
// Feature flags from env (defaults: notifications visible, settings enabled)
const SHOW_NOTIFICATIONS = process.env.NEXT_PUBLIC_SHOW_NOTIFICATIONS === 'true'
const ENABLE_SETTINGS = process.env.NEXT_PUBLIC_ENABLE_SETTINGS !== 'false'
import { useState } from 'react'

export function Header() {
    const { user, loading, logout } = useAuth()
    const [open, setOpen] = useState(false)

    return (
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container flex h-16 items-center">
                <Link href="/" className="flex items-center gap-2 font-semibold">
                    <Scale className="h-6 w-6" />
                    <span className="text-lg">LegisTrack</span>
                </Link>

                <nav className="ml-8 flex gap-6">
                    <Link href="/bills" className="text-sm font-medium transition-colors hover:text-primary">
                        Legislation
                    </Link>
                    <Link href="/about" className="text-sm font-medium transition-colors hover:text-primary">
                        About
                    </Link>
                </nav>

                <div className="ml-auto flex items-center gap-4">
                    {/* Notification bell behind feature flag */}
                    {SHOW_NOTIFICATIONS && (
                        <Link href="/notifications" className="text-muted-foreground hover:text-foreground">
                            <Bell className="h-5 w-5" />
                        </Link>
                    )}

                    {!loading && !user && (
                        <div className="flex items-center gap-2">
                            <Link href="/login">
                                <Button variant="ghost" size="sm">Login</Button>
                            </Link>
                            <Link href="/register">
                                <Button size="sm">Register</Button>
                            </Link>
                        </div>
                    )}

                    {!loading && user && (
                        <div className="relative">
                            <button onClick={() => setOpen((s) => !s)} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted">
                                <UserIcon className="h-5 w-5" />
                                <span className="text-sm">{user.name ?? user.username ?? user.email}</span>
                            </button>
                            {open && (
                                <div className="absolute right-0 mt-2 w-48 rounded border bg-card p-2 shadow">
                                    {ENABLE_SETTINGS ? (
                                        <Link href="/settings" className="block px-2 py-1 text-sm hover:bg-muted">Settings</Link>
                                    ) : (
                                        <div className="block px-2 py-1 text-sm text-muted-foreground">Settings (disabled)</div>
                                    )}
                                    <button onClick={logout} className="mt-2 flex w-full items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted">
                                        <LogOut className="h-4 w-4" />
                                        Logout
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </header>
    )
}
