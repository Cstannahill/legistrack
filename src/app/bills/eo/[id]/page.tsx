// Executive Order Detail Page
import { notFound } from "next/navigation"
import { ExternalLink, Landmark } from "lucide-react"
import { db } from "@/lib/db"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BackLink } from "@/components/bills/BackLink"
import { LegislationHeader } from "@/components/bills/LegislationHeader"
import { LegislativeFullText } from "@/components/bills/LegislativeFullText"
import { SummarySwitcher, type SummaryEntry } from "@/components/bills/SummarySwitcher"
import { formatDate } from "@/lib/utils/date"
import { formatExecutiveOrderText } from "@/lib/utils/html-to-text"
import {
    EXECUTIVE_ORDER_TYPE_COLORS,
    EXECUTIVE_ORDER_TYPE_LABELS,
} from "@/lib/constants"

interface PageProps {
    params: Promise<{
        id: string
    }>
}

export default async function ExecutiveOrderPage({ params }: PageProps) {
    const { id } = await params

    interface EOCategory {
        id: string
        name: string
        slug: string
        color: string | null
    }
    interface EOJSON {
        id: string
        orderNumber: number
        title: string
        executiveOrderType: string
        presidentName: string
        signingDate: string
        publicationDate?: string | null
        lastFetchedAt?: string | null
        fullText: string | null
        fullTextUrl?: string | null
        federalRegisterUrl?: string | null
        categories: EOCategory[]
        summaries: SummaryEntry[]
    }

    const eoRows = await db.$queryRaw<{ eo: EOJSON }[]>`SELECT get_executive_order_by_id(${id}::text) as eo`
    const executiveOrder = eoRows[0]?.eo as EOJSON | undefined

    if (!executiveOrder) {
        notFound()
    }

    const eoIdentifier = `EO ${executiveOrder.orderNumber}`
    const typeLabel =
        EXECUTIVE_ORDER_TYPE_LABELS[
            executiveOrder.executiveOrderType as keyof typeof EXECUTIVE_ORDER_TYPE_LABELS
        ] || executiveOrder.executiveOrderType
    const typeColor =
        EXECUTIVE_ORDER_TYPE_COLORS[
            executiveOrder.executiveOrderType as keyof typeof EXECUTIVE_ORDER_TYPE_COLORS
        ] || EXECUTIVE_ORDER_TYPE_COLORS.EXECUTIVE_ORDER

    return (
        <div className="container py-8 md:py-10">
            <div className="mb-6">
                <BackLink
                    fallbackHref="/bills?type=EXECUTIVE_ORDERS"
                    label="Back to executive orders"
                />
            </div>

            <div className="mb-8">
                <LegislationHeader
                    identifier={eoIdentifier}
                    title={executiveOrder.title}
                    typeBadge={{ label: typeLabel, className: typeColor }}
                    categories={executiveOrder.categories}
                />
            </div>

            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
                <Tabs defaultValue="summary" className="min-w-0 space-y-6">
                    <TabsList className="w-full justify-start sm:w-fit">
                        <TabsTrigger value="summary">Summary</TabsTrigger>
                        <TabsTrigger value="fulltext">Full Text</TabsTrigger>
                        <TabsTrigger value="details">Details</TabsTrigger>
                    </TabsList>

                    <TabsContent value="summary" className="space-y-4">
                        <SummarySwitcher summaries={executiveOrder.summaries} />
                    </TabsContent>

                    <TabsContent value="fulltext" className="space-y-4">
                        {executiveOrder.fullText ? (
                            <LegislativeFullText
                                text={formatExecutiveOrderText(executiveOrder.fullText)}
                                billIdentifier={eoIdentifier}
                            />
                        ) : (
                            <Card>
                                <CardContent className="py-10 text-center">
                                    <p className="mb-4 text-muted-foreground">
                                        Full text is not stored locally for this document.
                                    </p>
                                    {executiveOrder.fullTextUrl && (
                                        <Button asChild variant="outline">
                                            <a
                                                href={executiveOrder.fullTextUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                <span>View on Federal Register</span>
                                                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                                            </a>
                                        </Button>
                                    )}
                                </CardContent>
                            </Card>
                        )}
                    </TabsContent>

                    <TabsContent value="details">
                        <Card>
                            <CardHeader>
                                <CardTitle className="font-serif text-xl">
                                    Executive Order Details
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <dl className="grid gap-4 sm:grid-cols-2">
                                    <div>
                                        <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                            Order Number
                                        </dt>
                                        <dd className="mt-1 font-mono text-sm font-medium text-foreground">
                                            {executiveOrder.orderNumber}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                            Document Type
                                        </dt>
                                        <dd className="mt-1 text-sm text-foreground">{typeLabel}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                            President
                                        </dt>
                                        <dd className="mt-1 text-sm text-foreground">
                                            {executiveOrder.presidentName}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                            Signing Date
                                        </dt>
                                        <dd className="mt-1 font-mono text-sm text-foreground tabular-nums">
                                            {formatDate(executiveOrder.signingDate)}
                                        </dd>
                                    </div>
                                    {executiveOrder.publicationDate && (
                                        <div>
                                            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                                Publication Date
                                            </dt>
                                            <dd className="mt-1 font-mono text-sm text-foreground tabular-nums">
                                                {formatDate(executiveOrder.publicationDate)}
                                            </dd>
                                        </div>
                                    )}
                                    <div>
                                        <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                            Last Synced
                                        </dt>
                                        <dd className="mt-1 font-mono text-sm text-foreground tabular-nums">
                                            {executiveOrder.lastFetchedAt
                                                ? formatDate(executiveOrder.lastFetchedAt)
                                                : "—"}
                                        </dd>
                                    </div>
                                </dl>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>

                <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
                    <Card className="py-5">
                        <CardContent className="space-y-5 px-5">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                <Landmark className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                                <span>Presidential Document</span>
                            </div>

                            <dl className="space-y-3 text-sm">
                                <div className="flex items-start justify-between gap-3">
                                    <dt className="text-muted-foreground">Order</dt>
                                    <dd className="font-mono font-medium text-foreground text-right">
                                        {eoIdentifier}
                                    </dd>
                                </div>
                                <div className="flex items-start justify-between gap-3">
                                    <dt className="text-muted-foreground">President</dt>
                                    <dd className="font-medium text-foreground text-right">
                                        {executiveOrder.presidentName}
                                    </dd>
                                </div>
                                <div className="flex items-start justify-between gap-3">
                                    <dt className="text-muted-foreground">Signed</dt>
                                    <dd className="font-mono text-foreground tabular-nums text-right">
                                        {formatDate(executiveOrder.signingDate)}
                                    </dd>
                                </div>
                                {executiveOrder.publicationDate && (
                                    <div className="flex items-start justify-between gap-3">
                                        <dt className="text-muted-foreground">Published</dt>
                                        <dd className="font-mono text-foreground tabular-nums text-right">
                                            {formatDate(executiveOrder.publicationDate)}
                                        </dd>
                                    </div>
                                )}
                            </dl>

                            {(executiveOrder.federalRegisterUrl || executiveOrder.fullTextUrl) && (
                                <div className="space-y-2 border-t border-border/70 pt-4">
                                    {executiveOrder.federalRegisterUrl && (
                                        <Button asChild variant="outline" className="w-full justify-center">
                                            <a
                                                href={executiveOrder.federalRegisterUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                <span>Federal Register</span>
                                                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                            </a>
                                        </Button>
                                    )}
                                    {executiveOrder.fullTextUrl && (
                                        <Button asChild variant="ghost" className="w-full justify-center">
                                            <a
                                                href={executiveOrder.fullTextUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                <span>Source Text URL</span>
                                                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                            </a>
                                        </Button>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </aside>
            </div>
        </div>
    )
}
