import Link from "next/link"
import {
    Archive,
    ArrowLeft,
    BarChart3,
    Bell,
    History,
    Smartphone,
    UserCheck,
} from "lucide-react"
import { db } from "@/lib/db"

async function getCoverageMonths() {
    const today = new Date()

    const oldest = await db.bill.findFirst({
        orderBy: { introducedDate: "asc" },
        select: { introducedDate: true },
    })

    if (!oldest || !oldest.introducedDate) {
        return { status: "no-bills" } as const
    }

    const introduced = new Date(oldest.introducedDate)

    if (introduced > today) {
        return { status: "future" } as const
    }

    const yearsDiff = today.getFullYear() - introduced.getFullYear()
    const monthsDiff = today.getMonth() - introduced.getMonth()
    const daysDiff = today.getDate() - introduced.getDate()

    let totalMonths = yearsDiff * 12 + monthsDiff
    if (daysDiff >= 15) totalMonths += 1
    if (totalMonths < 0) totalMonths = 0

    return { status: "ok" as const, months: totalMonths }
}

const ROADMAP_ITEMS = [
    {
        icon: History,
        title: "Detailed Actions History",
        description:
            "Complete chamber-by-chamber timeline of legislative actions, votes, and amendments over time.",
    },
    {
        icon: Smartphone,
        title: "Mobile Reading Experience",
        description:
            "Continued refinements to filtering, quick scanning, and long-form bill text reading on mobile.",
    },
    {
        icon: Bell,
        title: "Custom Alerts",
        description:
            "Opt-in notifications when bills you follow advance or new legislation appears in your topics.",
    },
    {
        icon: UserCheck,
        title: "Personalized Tracking",
        description:
            "Save and organize bills and executive orders in a personal legislative watchlist.",
    },
    {
        icon: Archive,
        title: "Expanded Historical Archive",
        description:
            "Broader archival coverage reaching further back across earlier sessions of Congress.",
    },
    {
        icon: BarChart3,
        title: "Legislative Analytics",
        description:
            "Clear visual breakdowns of bill activity, committee progress, and topic trends.",
    },
] as const

export default async function AboutPage() {
    const coverage = await getCoverageMonths()

    return (
        <div className="container py-10 md:py-14">
            <div className="mx-auto max-w-3xl">
                <Link
                    href="/"
                    className="mb-8 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    <span>Back to Home</span>
                </Link>

                <article className="space-y-10 rounded-xl border border-border bg-card p-6 sm:p-10 md:p-12 shadow-xs">
                    <header className="space-y-3 border-b border-border/70 pb-8">
                        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                            About LegisTrack
                        </p>
                        <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                            Making federal legislation legible for everyone.
                        </h1>
                        <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
                            Simplifying the legal language inside government filings to increase public understanding and civic transparency.
                        </p>
                    </header>

                    <section className="space-y-3">
                        <h2 className="font-serif text-2xl font-semibold text-foreground">
                            Our Mission
                        </h2>
                        <p className="text-[15.5px] leading-[1.75] text-foreground/90">
                            Federal legislation and presidential directives are written in dense statutory language that is hard to parse without legal training. LegisTrack breaks down those barriers by pairing official source texts with clear, structured AI summaries in Brief, Standard, and Detailed depths.
                        </p>
                    </section>

                    <section className="rounded-lg border border-primary/20 border-l-4 border-l-primary bg-primary/5 p-6 space-y-2">
                        <h2 className="font-serif text-xl font-semibold text-foreground">
                            Commitment to Free Access
                        </h2>
                        <p className="text-sm font-medium text-foreground">
                            LegisTrack will always be free to use.
                        </p>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                            Access to federal laws and clear explanations of what they do should never sit behind a paywall. There are no subscriptions, ads, or paywalled summaries — only open civic information.
                        </p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="font-serif text-2xl font-semibold text-foreground">
                            Summarization Principles
                        </h2>
                        <p className="text-[15.5px] leading-[1.75] text-foreground/90">
                            Every summary is structured around three editorial standards:
                        </p>
                        <ul className="grid gap-3 pt-1 sm:grid-cols-3">
                            <li className="rounded-lg border border-border bg-muted/35 p-4">
                                <div className="font-semibold text-foreground">Brevity</div>
                                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                    Concise briefs you can read in seconds before diving deeper.
                                </p>
                            </li>
                            <li className="rounded-lg border border-border bg-muted/35 p-4">
                                <div className="font-semibold text-foreground">Clarity</div>
                                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                    Plain English that explains practical impact without jargon.
                                </p>
                            </li>
                            <li className="rounded-lg border border-border bg-muted/35 p-4">
                                <div className="font-semibold text-foreground">Completeness</div>
                                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                    Captures key provisions, impact areas, and official source links.
                                </p>
                            </li>
                        </ul>
                    </section>

                    <section className="space-y-3">
                        <h2 className="font-serif text-2xl font-semibold text-foreground">
                            Data Coverage
                        </h2>
                        <p className="text-[15.5px] leading-[1.75] text-foreground/90">
                            {coverage.status === "no-bills" ? (
                                <strong>No legislative data is currently indexed.</strong>
                            ) : coverage.status === "future" ? (
                                <strong>Indexed start date is in the future.</strong>
                            ) : (
                                (() => {
                                    const months = coverage.months
                                    const label = months === 1 ? "month" : "months"
                                    return (
                                        <>
                                            Our database currently covers federal legislation from the{" "}
                                            <strong className="font-semibold text-foreground">
                                                past {months} {label}
                                            </strong>
                                            , sourced directly from official APIs including Congress.gov and the Federal Register. Over time, we plan to expand coverage across earlier sessions of Congress.
                                        </>
                                    )
                                })()
                            )}
                        </p>
                    </section>

                    <section className="space-y-4">
                        <div className="space-y-1">
                            <h2 className="font-serif text-2xl font-semibold text-foreground">
                                Roadmap
                            </h2>
                            <p className="text-sm text-muted-foreground">
                                Ongoing improvements and upcoming capabilities in active development:
                            </p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            {ROADMAP_ITEMS.map((item) => {
                                const Icon = item.icon
                                return (
                                    <div
                                        key={item.title}
                                        className="flex items-start gap-3 rounded-lg border border-border bg-muted/25 p-4"
                                    >
                                        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                                            <Icon className="h-4 w-4" aria-hidden="true" />
                                        </span>
                                        <div>
                                            <h3 className="text-sm font-semibold text-foreground">
                                                {item.title}
                                            </h3>
                                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                                {item.description}
                                            </p>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </section>

                    <footer className="border-t border-border/70 pt-6 text-center text-xs text-muted-foreground">
                        Project started October 1, 2025 &middot; Data sourced from Congress.gov and the Federal Register
                    </footer>
                </article>
            </div>
        </div>
    )
}
