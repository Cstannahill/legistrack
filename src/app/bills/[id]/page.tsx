// Bill Detail Page with Companion Bills Support
import { notFound } from "next/navigation"
import { ExternalLink } from "lucide-react"
import { db } from "@/lib/db"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BackLink } from "@/components/bills/BackLink"
import { BillProgressStepper } from "@/components/bills/BillProgressStepper"
import { LegislationHeader } from "@/components/bills/LegislationHeader"
import { LegislativeFullText } from "@/components/bills/LegislativeFullText"
import { StatusBadge } from "@/components/bills/StatusBadge"
import { SummarySwitcher, type SummaryEntry } from "@/components/bills/SummarySwitcher"
import { formatDate } from "@/lib/utils/date"
import { formatSponsorLabel } from "@/lib/utils/formatting"
import { getBillCongressUrl } from "@/lib/utils/congress-url"
import { cn } from "@/lib/utils"

interface PageProps {
    params: Promise<{
        id: string
    }>
}

interface ActionItem {
    id: string
    actionDate: string
    text: string
    actionCode?: string | null
}

interface CosponsorItem {
    fullName: string
    party: string
    state: string
}

interface BillContentBill {
    id: string
    billType: string
    billNumber: number
    congress: number
    title: string
    currentStatus: string
    introducedDate: string | Date
    statusDate?: string | null
    lawNumber?: string | null
    shortTitle?: string | null
    officialTitle?: string | null
    fullText?: string | null
    fullTextUrl?: string | null
    sponsor?: { fullName: string; party: string; state: string } | null
    categories: { id: string; name: string; slug: string; color: string | null }[]
    summaries?: SummaryEntry[]
    actions?: ActionItem[]
    cosponsors?: CosponsorItem[]
}

function BillAtAGlanceSidebar({ bill }: { bill: BillContentBill }) {
    const billIdentifier = `${bill.billType.toUpperCase()} ${bill.billNumber}`
    const congressGovUrl = getBillCongressUrl(bill)
    const sponsorLabel = formatSponsorLabel(bill.sponsor)

    return (
        <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
            <Card className="py-5">
                <CardContent className="space-y-5 px-5">
                    <BillProgressStepper status={bill.currentStatus} />

                    <div className="border-t border-border/70 pt-4">
                        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            At a Glance
                        </div>
                        <dl className="space-y-3 text-sm">
                            <div className="flex items-start justify-between gap-3">
                                <dt className="text-muted-foreground">Identifier</dt>
                                <dd className="font-mono font-medium text-foreground text-right">
                                    {billIdentifier}
                                </dd>
                            </div>
                            <div className="flex items-start justify-between gap-3">
                                <dt className="text-muted-foreground">Congress</dt>
                                <dd className="font-medium text-foreground text-right">
                                    {bill.congress}th
                                </dd>
                            </div>
                            <div className="flex items-start justify-between gap-3">
                                <dt className="text-muted-foreground">Introduced</dt>
                                <dd className="font-mono text-foreground tabular-nums text-right">
                                    {formatDate(bill.introducedDate)}
                                </dd>
                            </div>
                            {bill.statusDate && (
                                <div className="flex items-start justify-between gap-3">
                                    <dt className="text-muted-foreground">Status Date</dt>
                                    <dd className="font-mono text-foreground tabular-nums text-right">
                                        {formatDate(bill.statusDate)}
                                    </dd>
                                </div>
                            )}
                            {sponsorLabel && (
                                <div className="space-y-1 border-t border-border/60 pt-3">
                                    <dt className="text-xs text-muted-foreground">Primary Sponsor</dt>
                                    <dd className="font-medium text-foreground leading-snug">
                                        {sponsorLabel}
                                    </dd>
                                </div>
                            )}
                            {bill.lawNumber && (
                                <div className="flex items-start justify-between gap-3 border-t border-border/60 pt-3">
                                    <dt className="text-muted-foreground">Public Law</dt>
                                    <dd className="font-mono font-semibold text-emerald-700 dark:text-emerald-300 text-right">
                                        {bill.lawNumber}
                                    </dd>
                                </div>
                            )}
                        </dl>
                    </div>

                    <div className="border-t border-border/70 pt-4">
                        <Button asChild variant="outline" className="w-full justify-center">
                            <a
                                href={congressGovUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <span>View on Congress.gov</span>
                                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            </a>
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </aside>
    )
}

function BillContent({ bill }: { bill: BillContentBill }) {
    const billIdentifier = `${bill.billType.toUpperCase()} ${bill.billNumber}`
    const congressGovUrl = getBillCongressUrl(bill)
    const sponsorLabel = formatSponsorLabel(bill.sponsor)

    return (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Tabs defaultValue="summary" className="min-w-0 space-y-6">
                <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
                    <TabsTrigger value="summary">Summary</TabsTrigger>
                    <TabsTrigger value="fulltext">Full Text</TabsTrigger>
                    <TabsTrigger value="actions">
                        Actions{bill.actions?.length ? ` (${bill.actions.length})` : ""}
                    </TabsTrigger>
                    <TabsTrigger value="details">Details</TabsTrigger>
                    {bill.cosponsors && bill.cosponsors.length > 0 && (
                        <TabsTrigger value="cosponsors">
                            Cosponsors ({bill.cosponsors.length})
                        </TabsTrigger>
                    )}
                </TabsList>

                {/* Summary Tab */}
                <TabsContent value="summary" className="space-y-4">
                    <SummarySwitcher summaries={bill.summaries} />
                </TabsContent>

                {/* Full Text Tab */}
                <TabsContent value="fulltext" className="space-y-4">
                    {bill.fullText ? (
                        <LegislativeFullText
                            text={bill.fullText}
                            billIdentifier={billIdentifier}
                        />
                    ) : bill.fullTextUrl ? (
                        <Card>
                            <CardContent className="py-10 text-center">
                                <p className="mb-4 text-muted-foreground">
                                    Full legislative text is available on Congress.gov.
                                </p>
                                <Button asChild variant="outline">
                                    <a
                                        href={bill.fullTextUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        View full text on Congress.gov
                                        <ExternalLink className="h-4 w-4" aria-hidden="true" />
                                    </a>
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
                        <Card>
                            <CardContent className="py-10 text-center">
                                <p className="text-muted-foreground">
                                    Full text not yet available. Legislative text is typically published shortly after introduction.
                                </p>
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                {/* Actions Timeline Tab */}
                <TabsContent value="actions" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="font-serif text-xl">
                                Legislative Actions
                            </CardTitle>
                            <CardDescription>
                                Chronological history of actions taken on {billIdentifier}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {!bill.actions || bill.actions.length === 0 ? (
                                <p className="py-6 text-center text-sm text-muted-foreground">
                                    No actions recorded yet.
                                </p>
                            ) : (
                                <ol className="relative space-y-6 before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-border">
                                    {bill.actions.map((action, idx) => {
                                        const isLatest = idx === 0
                                        return (
                                            <li key={action.id} className="relative pl-7">
                                                <span
                                                    className={cn(
                                                        "absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border-2",
                                                        isLatest
                                                            ? "border-primary bg-primary ring-4 ring-primary/15"
                                                            : "border-border bg-card"
                                                    )}
                                                    aria-hidden="true"
                                                />
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <time className="font-mono text-xs font-semibold text-foreground tabular-nums">
                                                        {formatDate(action.actionDate)}
                                                    </time>
                                                    {isLatest && (
                                                        <Badge variant="secondary" className="text-[11px]">
                                                            Latest
                                                        </Badge>
                                                    )}
                                                    {action.actionCode && (
                                                        <Badge variant="outline" className="font-mono text-[11px]">
                                                            {action.actionCode}
                                                        </Badge>
                                                    )}
                                                </div>
                                                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                                                    {action.text}
                                                </p>
                                            </li>
                                        )
                                    })}
                                </ol>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Details Tab */}
                <TabsContent value="details" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="font-serif text-xl">
                                Bill Information
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            <dl className="grid gap-4 sm:grid-cols-2">
                                <div>
                                    <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                        Bill Number
                                    </dt>
                                    <dd className="mt-1 font-mono text-sm font-medium text-foreground">
                                        {billIdentifier}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                        Congress
                                    </dt>
                                    <dd className="mt-1 text-sm text-foreground">
                                        {bill.congress}th U.S. Congress
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                        Introduced Date
                                    </dt>
                                    <dd className="mt-1 font-mono text-sm text-foreground tabular-nums">
                                        {formatDate(bill.introducedDate)}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                        Status Date
                                    </dt>
                                    <dd className="mt-1 font-mono text-sm text-foreground tabular-nums">
                                        {bill.statusDate ? formatDate(bill.statusDate) : "—"}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                        Current Status
                                    </dt>
                                    <dd className="mt-1.5">
                                        <StatusBadge status={bill.currentStatus} />
                                    </dd>
                                </div>
                                {sponsorLabel && (
                                    <div>
                                        <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                            Sponsor
                                        </dt>
                                        <dd className="mt-1 text-sm text-foreground">
                                            {sponsorLabel}
                                        </dd>
                                    </div>
                                )}
                            </dl>

                            {bill.officialTitle && (
                                <div className="border-t border-border/60 pt-4">
                                    <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                        Official Title
                                    </h4>
                                    <p className="text-sm leading-relaxed text-foreground/90">
                                        {bill.officialTitle}
                                    </p>
                                </div>
                            )}

                            <div className="border-t border-border/60 pt-4">
                                <a
                                    href={congressGovUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                                >
                                    <span>View full record on Congress.gov</span>
                                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                </a>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Cosponsors Tab */}
                {bill.cosponsors && bill.cosponsors.length > 0 && (
                    <TabsContent value="cosponsors" className="space-y-4">
                        <Card>
                            <CardHeader>
                                <CardTitle className="font-serif text-xl">
                                    Cosponsors
                                </CardTitle>
                                <CardDescription>
                                    Members of Congress who have cosponsored {billIdentifier}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {bill.cosponsors.map((cosponsor) => (
                                        <div
                                            key={cosponsor.fullName}
                                            className="rounded-lg border border-border bg-muted/25 p-3.5"
                                        >
                                            <div className="font-medium text-foreground">
                                                {cosponsor.fullName}
                                            </div>
                                            <div className="mt-0.5 text-xs text-muted-foreground">
                                                {cosponsor.party}-{cosponsor.state}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}
            </Tabs>

            <BillAtAGlanceSidebar bill={bill} />
        </div>
    )
}

export default async function BillDetailPage({ params }: PageProps) {
    const { id } = await params

    interface SummaryJSON {
        summaryType: string
        content: string | null
        keyPoints?: string[] | null
        impactAreas?: string[] | null
        aiModel?: string | null
        generatedAt?: string | null
    }
    interface ActionJSON {
        id: string
        actionDate: string
        text: string
        actionCode?: string | null
    }
    interface CategoryJSON {
        id: string
        name: string
        slug: string
        color: string | null
    }
    interface SponsorJSON {
        id: string
        fullName: string
        party: string
        state: string
        bioguideId?: string | null
    }
    interface CosponsorJSON {
        id: string
        fullName: string
        party: string
        state: string
    }
    interface CompanionBillJSON {
        id: string
        billType: string
        billNumber: number
        congress: number
        title: string
        currentStatus: string
        introducedDate: string
        statusDate: string | null
        lawNumber: string | null
        shortTitle: string | null
        officialTitle: string | null
        fullText: string | null
        fullTextUrl: string | null
        sponsor: SponsorJSON | null
        categories: CategoryJSON[]
        summaries: SummaryJSON[]
        actions: ActionJSON[]
        cosponsors: CosponsorJSON[]
    }
    interface BillJSON {
        id: string
        billType: string
        billNumber: number
        congress: number
        title: string
        shortTitle: string | null
        officialTitle: string | null
        currentStatus: string
        statusDate: string | null
        introducedDate: string
        lawNumber: string | null
        fullText: string | null
        fullTextUrl: string | null
        sponsor: SponsorJSON | null
        categories: CategoryJSON[]
        summaries: SummaryJSON[]
        actions: ActionJSON[]
        cosponsors: CosponsorJSON[]
        companionBills: CompanionBillJSON[]
        companionOf: CompanionBillJSON[]
    }

    const billRows = await db.$queryRaw<{ bill: BillJSON }[]>`SELECT get_bill_by_id(${id}::text) AS bill`
    const billJson = billRows[0]?.bill as BillJSON | undefined

    if (!billJson) {
        notFound()
    }

    const bill: BillJSON = {
        ...billJson,
        companionBills: Array.isArray(billJson.companionBills)
            ? billJson.companionBills
            : [],
        companionOf: billJson.companionOf || [],
    }

    const companions: CompanionBillJSON[] = bill.companionBills || []
    const hasCompanions = companions.length > 0
    const billIdentifier = `${bill.billType.toUpperCase()} ${bill.billNumber}`

    return (
        <div className="container py-8 md:py-10">
            <div className="mb-6">
                <BackLink fallbackHref="/bills" label="Back to legislation" />
            </div>

            <div className="mb-8">
                <LegislationHeader
                    identifier={billIdentifier}
                    title={bill.title}
                    shortTitle={bill.shortTitle}
                    congress={bill.congress}
                    status={bill.currentStatus}
                    companionIdentifiers={companions.map((c) => ({
                        id: c.id,
                        label: `${c.billType.toUpperCase()} ${c.billNumber}`,
                    }))}
                    categories={bill.categories}
                />
            </div>

            {hasCompanions ? (
                <Tabs defaultValue={bill.id} className="space-y-6">
                    <div className="rounded-xl border border-border bg-muted/40 p-3">
                        <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Chamber Versions
                        </div>
                        <TabsList className="w-full justify-start">
                            <TabsTrigger value={bill.id} className="flex-1">
                                {bill.billType.toUpperCase()} {bill.billNumber}
                                <span className="ml-1.5 text-xs text-muted-foreground">
                                    ({bill.billType.toUpperCase() === "HR" || bill.billType.toUpperCase() === "HJRES" ? "House" : "Senate"})
                                </span>
                            </TabsTrigger>
                            {companions.map((companion) => (
                                <TabsTrigger key={companion.id} value={companion.id} className="flex-1">
                                    {companion.billType.toUpperCase()} {companion.billNumber}
                                    <span className="ml-1.5 text-xs text-muted-foreground">
                                        ({companion.billType.toUpperCase() === "HR" || companion.billType.toUpperCase() === "HJRES" ? "House" : "Senate"})
                                    </span>
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </div>

                    <TabsContent value={bill.id}>
                        <BillContent bill={bill as unknown as BillContentBill} />
                    </TabsContent>

                    {companions.map((companion) => (
                        <TabsContent key={companion.id} value={companion.id}>
                            <BillContent bill={companion as unknown as BillContentBill} />
                        </TabsContent>
                    ))}
                </Tabs>
            ) : (
                <BillContent bill={bill} />
            )}
        </div>
    )
}
