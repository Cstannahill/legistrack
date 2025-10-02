// Header Navigation Component
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Scale } from 'lucide-react'

export function Header() {
    return (
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container flex h-16 items-center">
                <Link href="/" className="flex items-center gap-2 font-semibold">
                    <Scale className="h-6 w-6" />
                    <span className="text-lg">LegisTracker</span>
                </Link>

                <nav className="ml-8 flex gap-6">
                    <Link href="/bills" className="text-sm font-medium transition-colors hover:text-primary">
                        Bills
                    </Link>
                    <Link href="/about" className="text-sm font-medium transition-colors hover:text-primary">
                        About
                    </Link>
                </nav>

                {/* <div className="ml-auto flex items-center gap-4">
                    <Button variant="outline" size="sm">
                        Sign In
                    </Button>
                </div> */}
            </div>
        </header>
    )
}
