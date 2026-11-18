import Link from "next/link"
import { ExternalLink } from "lucide-react"
import { BrandMark } from "./BrandMark"

export function Footer() {
    const year = new Date().getFullYear()

    return (
        <footer className="border-t border-border/70 bg-card/50">
            <div className="container py-10 md:py-12">
                <div className="grid gap-8 md:grid-cols-12">
                    <div className="md:col-span-5 space-y-3">
                        <Link
                            href="/"
                            className="inline-flex items-center gap-2.5 font-semibold text-foreground"
                        >
                            <BrandMark className="h-7 w-7" />
                            <span className="font-serif text-lg font-semibold tracking-tight">
                                LegisTrack
                            </span>
                        </Link>
                        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
                            Plain-English summaries of U.S. federal bills and executive orders, built to make public legislation accessible without paywalls.
                        </p>
                    </div>

                    <div className="md:col-span-3 space-y-3">
                        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Explore
                        </h2>
                        <ul className="space-y-2 text-sm">
                            <li>
                                <Link href="/bills" className="text-foreground/80 transition-colors hover:text-primary">
                                    All Legislation
                                </Link>
                            </li>
                            <li>
                                <Link href="/bills?type=BILLS" className="text-foreground/80 transition-colors hover:text-primary">
                                    Congressional Bills
                                </Link>
                            </li>
                            <li>
                                <Link href="/bills?type=EXECUTIVE_ORDERS" className="text-foreground/80 transition-colors hover:text-primary">
                                    Executive Orders
                                </Link>
                            </li>
                            <li>
                                <Link href="/about" className="text-foreground/80 transition-colors hover:text-primary">
                                    About &amp; Mission
                                </Link>
                            </li>
                        </ul>
                    </div>

                    <div className="md:col-span-4 space-y-3">
                        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Official Data Sources
                        </h2>
                        <ul className="space-y-2 text-sm">
                            <li>
                                <a
                                    href="https://www.congress.gov"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-foreground/80 transition-colors hover:text-primary"
                                >
                                    <span>Congress.gov</span>
                                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                </a>
                            </li>
                            <li>
                                <a
                                    href="https://www.federalregister.gov"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-foreground/80 transition-colors hover:text-primary"
                                >
                                    <span>Federal Register</span>
                                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                </a>
                            </li>
                        </ul>
                        <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
                            Summaries are AI-generated from official legislative texts. Always verify critical legal details against source documents.
                        </p>
                    </div>
                </div>

                <div className="mt-8 flex flex-col gap-2 border-t border-border/60 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                    <p>&copy; {year} LegisTrack. Free and open civic information.</p>
                    <p>Data sourced from official U.S. government APIs</p>
                </div>
            </div>
        </footer>
    )
}
