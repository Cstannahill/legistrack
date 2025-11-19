// Executive Order Detail Page
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SummarySection, KeyPointsList } from '@/components/bills/SummarySection'
import { LegislativeFullText } from '@/components/bills/LegislativeFullText'
import { FormattedText } from '@/components/ui/FormattedText'
import { formatDate } from '@/lib/utils/date'
import { formatExecutiveOrderText } from '@/lib/utils/html-to-text'
import { Calendar, User, ExternalLink, FileText, ArrowLeft } from 'lucide-react'
import { EXECUTIVE_ORDER_TYPE_LABELS, EXECUTIVE_ORDER_TYPE_COLORS } from '@/lib/constants'

interface PageProps {
    params: Promise<{
        id: string
    }>
}

export default async function ExecutiveOrderPage({ params }: PageProps) {
    const { id } = await params

    interface EOSummary { id: string; summaryType: string; content: string | null; keyPoints?: string[] | null; aiModel?: string | null; generatedAt?: string | null }
    interface EOCategory { id: string; name: string; slug: string; color: string | null }
    interface EOJSON {
        id: string; orderNumber: number; title: string; executiveOrderType: string; presidentName: string;
        signingDate: string; publicationDate?: string | null; lastFetchedAt?: string | null;
        fullText: string | null; fullTextUrl?: string | null; federalRegisterUrl?: string | null;
        categories: EOCategory[]; summaries: EOSummary[];
    }
    const eoRows = await db.$queryRaw<{ eo: EOJSON }[]>`SELECT get_executive_order_by_id(${id}::text) as eo`
    const executiveOrder = eoRows[0]?.eo as EOJSON | undefined

    if (!executiveOrder) {
        notFound()
    }

    const eoIdentifier = `Executive Order ${executiveOrder.orderNumber}`
    const briefSummary = executiveOrder.summaries?.find((s) => s.summaryType === 'BRIEF')
    const standardSummary = executiveOrder.summaries?.find((s) => s.summaryType === 'STANDARD')
    const detailedSummary = executiveOrder.summaries?.find((s) => s.summaryType === 'DETAILED')
    const typeLabel = EXECUTIVE_ORDER_TYPE_LABELS[executiveOrder.executiveOrderType as keyof typeof EXECUTIVE_ORDER_TYPE_LABELS] || executiveOrder.executiveOrderType
    const typeColor = EXECUTIVE_ORDER_TYPE_COLORS[executiveOrder.executiveOrderType as keyof typeof EXECUTIVE_ORDER_TYPE_COLORS] || 'bg-gray-100 text-gray-800'

    return (
        <div className="container py-8 overflow-x-hidden">
            {/* Back Button */}
            <Link
                href="/bills?type=EXECUTIVE_ORDERS"
                className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
                <ArrowLeft className="h-4 w-4" />
                Back to Executive Orders
            </Link>

            {/* Header */}
            <div className="mb-6 space-y-4">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="font-mono text-white">
                                {eoIdentifier}
                            </Badge>
                            <Badge className={typeColor}>
                                {typeLabel}
                            </Badge>
                        </div>
                        <h1 className="text-lg font-bold tracking-tight">
                            {executiveOrder.title}
                        </h1>
                    </div>
                </div>

                {/* Metadata */}
                <div className="flex flex-wrap gap-4 text-sm text-stone-300">
                    <div className="flex items-center gap-1">
                        <User className="h-4 w-4" />
                        <span>{executiveOrder.presidentName}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        <span>Signed: {formatDate(executiveOrder.signingDate)}</span>
                    </div>
                    {executiveOrder.publicationDate && (
                        <div className="flex items-center gap-1">
                            <FileText className="h-4 w-4" />
                            <span>Published: {formatDate(executiveOrder.publicationDate)}</span>
                        </div>
                    )}
                </div>

                {/* Categories */}
                {executiveOrder.categories.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {executiveOrder.categories.map((category) => (
                            <Badge
                                key={category.id}
                                variant="secondary"
                                style={{
                                    backgroundColor: category.color ? `${category.color}15` : undefined,
                                    color: category.color || undefined,
                                }}
                            >
                                {category.name}
                            </Badge>
                        ))}
                    </div>
                )}

                {/* External Links */}
                <div className="flex flex-wrap gap-2">
                    {executiveOrder.federalRegisterUrl && (
                        <a
                            href={executiveOrder.federalRegisterUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-white hover:underline"
                        >
                            <ExternalLink className="h-3 w-3" />
                            Federal Register
                        </a>
                    )}
                    {executiveOrder.fullTextUrl && (
                        <a
                            href={executiveOrder.fullTextUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-white hover:underline"
                        >
                            <ExternalLink className="h-3 w-3" />
                            Full Text
                        </a>
                    )}
                </div>
            </div>

            {/* Content Tabs */}
            <Tabs defaultValue="summary" className="space-y-6">
                <TabsList>
                    <TabsTrigger className="text-zinc-500" value="summary">Summary</TabsTrigger>
                    <TabsTrigger className="text-zinc-500" value="fulltext">Full Text</TabsTrigger>
                    <TabsTrigger className="text-zinc-500" value="details">Details</TabsTrigger>
                </TabsList>

                {/* Summary Tab */}
                <TabsContent value="summary" className="space-y-4">
                    {!briefSummary && !standardSummary && !detailedSummary && (
                        <Card>
                            <CardContent className="py-8 text-center">
                                <p className="text-muted-foreground">
                                    No AI-generated summaries available yet. Summaries are
                                    generated automatically and will appear here once processed.
                                </p>
                            </CardContent>
                        </Card>
                    )}

                    {briefSummary && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Brief Summary</CardTitle>
                                <CardDescription>
                                    Quick overview in 2-3 sentences
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-base leading-relaxed">
                                    <FormattedText text={briefSummary.content || ''} />
                                </p>
                                {briefSummary.keyPoints && briefSummary.keyPoints.length > 0 && (
                                    <SummarySection title="Key Points" variant="keyPoints">
                                        <KeyPointsList points={briefSummary.keyPoints} />
                                    </SummarySection>
                                )}
                                <div className="mt-4 text-xs text-muted-foreground">
                                    Generated by {briefSummary.aiModel} on{' '}
                                    {briefSummary.generatedAt ? formatDate(briefSummary.generatedAt) : '—'}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {standardSummary && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Standard Summary</CardTitle>
                                <CardDescription>
                                    Comprehensive overview
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-base leading-relaxed">
                                    <FormattedText text={standardSummary.content || ''} />
                                </p>
                                {standardSummary.keyPoints && standardSummary.keyPoints.length > 0 && (
                                    <SummarySection title="Key Points" variant="keyPoints">
                                        <KeyPointsList points={standardSummary.keyPoints} />
                                    </SummarySection>
                                )}
                                <div className="mt-4 text-xs text-muted-foreground">
                                    Generated by {standardSummary.aiModel} on{' '}
                                    {standardSummary.generatedAt ? formatDate(standardSummary.generatedAt) : '—'}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {detailedSummary && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Detailed Analysis</CardTitle>
                                <CardDescription>
                                    In-depth analysis of the executive order
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-base leading-relaxed">
                                    <FormattedText text={detailedSummary.content || ''} />
                                </p>
                                {detailedSummary.keyPoints && detailedSummary.keyPoints.length > 0 && (
                                    <SummarySection title="Key Points" variant="keyPoints">
                                        <KeyPointsList points={detailedSummary.keyPoints} />
                                    </SummarySection>
                                )}
                                <div className="mt-4 text-xs text-muted-foreground">
                                    Generated by {detailedSummary.aiModel} on{' '}
                                    {detailedSummary.generatedAt ? formatDate(detailedSummary.generatedAt) : '—'}
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                {/* Full Text Tab */}
                <TabsContent value="fulltext" className="space-y-4 grid-cols-3">
                    {executiveOrder.fullText ? (
                        <LegislativeFullText
                            text={formatExecutiveOrderText(executiveOrder.fullText)}
                            billIdentifier={`EO ${executiveOrder.orderNumber}`}
                        />
                    ) : (
                        <Card>
                            <CardContent className="py-8">
                                <div className="text-center text-muted-foreground">
                                    <p>Full text not available.</p>
                                    {executiveOrder.fullTextUrl && (
                                        <a
                                            href={executiveOrder.fullTextUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="mt-2 inline-flex items-center gap-1 text-primary hover:underline"
                                        >
                                            <ExternalLink className="h-4 w-4" />
                                            View on Federal Register
                                        </a>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                {/* Details Tab */}
                <TabsContent value="details">
                    <Card>
                        <CardHeader>
                            <CardTitle>Executive Order Details</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <dl className="grid gap-4 sm:grid-cols-2">
                                <div>
                                    <dt className="text-sm font-medium text-muted-foreground">Order Number</dt>
                                    <dd className="mt-1 text-sm">{executiveOrder.orderNumber}</dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-muted-foreground">Type</dt>
                                    <dd className="mt-1 text-sm">{typeLabel}</dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-muted-foreground">President</dt>
                                    <dd className="mt-1 text-sm">{executiveOrder.presidentName}</dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-muted-foreground">Signing Date</dt>
                                    <dd className="mt-1 text-sm">{formatDate(executiveOrder.signingDate)}</dd>
                                </div>
                                {executiveOrder.publicationDate && (
                                    <div>
                                        <dt className="text-sm font-medium text-muted-foreground">Publication Date</dt>
                                        <dd className="mt-1 text-sm">{formatDate(executiveOrder.publicationDate)}</dd>
                                    </div>
                                )}
                                <div>
                                    <dt className="text-sm font-medium text-muted-foreground">Last Updated</dt>
                                    <dd className="mt-1 text-sm">{executiveOrder.lastFetchedAt ? formatDate(executiveOrder.lastFetchedAt) : '—'}</dd>
                                </div>
                            </dl>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
