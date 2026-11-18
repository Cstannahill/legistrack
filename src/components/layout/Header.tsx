"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
    Bell,
    ChevronDown,
    LogOut,
    Menu,
    Settings,
    User as UserIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet"
import { ThemeToggle } from "@/components/theme/ThemeToggle"
import { BrandMark } from "./BrandMark"
import { useAuth } from "@/lib/useAuth"
import { cn } from "@/lib/utils"

const SHOW_NOTIFICATIONS = process.env.NEXT_PUBLIC_SHOW_NOTIFICATIONS === "true"
const ENABLE_SETTINGS = process.env.NEXT_PUBLIC_ENABLE_SETTINGS !== "false"

const NAV_LINKS = [
    { href: "/bills", label: "Legislation" },
    { href: "/about", label: "About" },
]

export function Header() {
    const pathname = usePathname()
    const { user, loading, logout } = useAuth()
    const [mobileOpen, setMobileOpen] = useState(false)

    const isActive = (href: string) =>
        href === "/" ? pathname === "/" : pathname?.startsWith(href)

    return (
        <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/75">
            <div className="container flex h-16 items-center justify-between gap-4">
                <div className="flex items-center gap-8">
                    <Link
                        href="/"
                        className="flex items-center gap-2.5 font-semibold tracking-tight text-foreground transition-opacity hover:opacity-90"
                    >
                        <BrandMark />
                        <span className="font-serif text-xl font-semibold tracking-tight">
                            LegisTrack
                        </span>
                    </Link>

                    <nav aria-label="Main navigation" className="hidden md:flex items-center gap-1">
                        {NAV_LINKS.map((link) => {
                            const active = isActive(link.href)
                            return (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    aria-current={active ? "page" : undefined}
                                    className={cn(
                                        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                                        active
                                            ? "bg-accent text-accent-foreground"
                                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                    )}
                                >
                                    {link.label}
                                </Link>
                            )
                        })}
                    </nav>
                </div>

                {/* Desktop right controls */}
                <div className="hidden md:flex items-center gap-2">
                    <ThemeToggle />

                    {SHOW_NOTIFICATIONS && (
                        <Link
                            href="/notifications"
                            aria-label="Notifications"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                            <Bell className="h-4 w-4" aria-hidden="true" />
                        </Link>
                    )}

                    {!loading && !user && (
                        <div className="flex items-center gap-2 pl-1">
                            <Button asChild variant="ghost" size="sm">
                                <Link href="/login">Sign in</Link>
                            </Button>
                            <Button asChild size="sm">
                                <Link href="/register">Register</Link>
                            </Button>
                        </div>
                    )}

                    {!loading && user && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    aria-label="Account menu"
                                    className="gap-2"
                                >
                                    <UserIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                    <span className="max-w-[140px] truncate">
                                        {user.name ?? user.username ?? user.email}
                                    </span>
                                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                                <DropdownMenuLabel className="truncate font-normal">
                                    <span className="block text-xs text-muted-foreground">Signed in as</span>
                                    <span className="block truncate font-medium text-foreground">
                                        {user.name ?? user.username ?? user.email}
                                    </span>
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {ENABLE_SETTINGS ? (
                                    <DropdownMenuItem asChild>
                                        <Link href="/settings" className="cursor-pointer">
                                            <Settings className="h-4 w-4" aria-hidden="true" />
                                            Settings
                                        </Link>
                                    </DropdownMenuItem>
                                ) : (
                                    <DropdownMenuItem disabled>
                                        <Settings className="h-4 w-4" aria-hidden="true" />
                                        Settings (disabled)
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    variant="destructive"
                                    onSelect={() => logout()}
                                    className="cursor-pointer"
                                >
                                    <LogOut className="h-4 w-4" aria-hidden="true" />
                                    Log out
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>

                {/* Mobile controls */}
                <div className="flex md:hidden items-center gap-1">
                    <ThemeToggle />

                    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                        <SheetTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Open navigation menu"
                            >
                                <Menu className="h-5 w-5" aria-hidden="true" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="right" className="w-[290px] sm:w-[340px]">
                            <SheetHeader className="text-left">
                                <SheetTitle className="flex items-center gap-2.5 font-serif text-xl">
                                    <BrandMark />
                                    <span>LegisTrack</span>
                                </SheetTitle>
                            </SheetHeader>

                            <nav aria-label="Mobile navigation" className="mt-6 flex flex-col gap-1">
                                <Link
                                    href="/"
                                    onClick={() => setMobileOpen(false)}
                                    className={cn(
                                        "rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                                        pathname === "/"
                                            ? "bg-accent text-accent-foreground"
                                            : "text-foreground/80 hover:bg-muted"
                                    )}
                                >
                                    Home
                                </Link>
                                {NAV_LINKS.map((link) => {
                                    const active = isActive(link.href)
                                    return (
                                        <Link
                                            key={link.href}
                                            href={link.href}
                                            onClick={() => setMobileOpen(false)}
                                            className={cn(
                                                "rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                                                active
                                                    ? "bg-accent text-accent-foreground"
                                                    : "text-foreground/80 hover:bg-muted"
                                            )}
                                        >
                                            {link.label}
                                        </Link>
                                    )
                                })}
                            </nav>

                            <div className="mt-6 border-t border-border pt-6">
                                {!loading && !user && (
                                    <div className="flex flex-col gap-2">
                                        <Button asChild variant="outline" className="w-full justify-center">
                                            <Link href="/login" onClick={() => setMobileOpen(false)}>
                                                Sign in
                                            </Link>
                                        </Button>
                                        <Button asChild className="w-full justify-center">
                                            <Link href="/register" onClick={() => setMobileOpen(false)}>
                                                Create account
                                            </Link>
                                        </Button>
                                    </div>
                                )}

                                {!loading && user && (
                                    <div className="space-y-3">
                                        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                                            <div className="text-xs text-muted-foreground">Signed in as</div>
                                            <div className="truncate text-sm font-medium">
                                                {user.name ?? user.username ?? user.email}
                                            </div>
                                        </div>
                                        {ENABLE_SETTINGS && (
                                            <Button asChild variant="outline" className="w-full justify-start">
                                                <Link href="/settings" onClick={() => setMobileOpen(false)}>
                                                    <Settings className="h-4 w-4" aria-hidden="true" />
                                                    Settings
                                                </Link>
                                            </Button>
                                        )}
                                        <Button
                                            variant="ghost"
                                            className="w-full justify-start text-destructive hover:text-destructive"
                                            onClick={() => {
                                                setMobileOpen(false)
                                                logout()
                                            }}
                                        >
                                            <LogOut className="h-4 w-4" aria-hidden="true" />
                                            Log out
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </SheetContent>
                    </Sheet>
                </div>
            </div>
        </header>
    )
}
