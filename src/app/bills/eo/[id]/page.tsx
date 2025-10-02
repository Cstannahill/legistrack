// Executive Order Detail Page
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

    const executiveOrder = await db.executiveOrder.findUnique({
        where: { id },
        include: {
            categories: {
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    color: true,
                },
            },
            summaries: {
                orderBy: { generatedAt: 'desc' },
            },
        },
    })

    if (!executiveOrder) {
        notFound()
    }

    const eoIdentifier = `Executive Order ${executiveOrder.orderNumber}`
    const briefSummary = executiveOrder.summaries?.find((s) => s.summaryType === 'BRIEF')
    const standardSummary = executiveOrder.summaries?.find((s) => s.summaryType === 'STANDARD')
    const detailedSummary = executiveOrder.summaries?.find((s) => s.summaryType === 'DETAILED')
    const typeLabel = EXECUTIVE_ORDER_TYPE_LABELS[executiveOrder.executiveOrderType] || executiveOrder.executiveOrderType
    const typeColor = EXECUTIVE_ORDER_TYPE_COLORS[executiveOrder.executiveOrderType] || 'bg-gray-100 text-gray-800'

    return (
        <div className="container py-8">
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
                            <Badge variant="outline" className="font-mono">
                                {eoIdentifier}
                            </Badge>
                            <Badge className={typeColor}>
                                {typeLabel}
                            </Badge>
                        </div>
                        <h1 className="text-3xl font-bold tracking-tight">
                            {executiveOrder.title}
                        </h1>
                    </div>
                </div>

                {/* Metadata */}
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
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
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
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
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
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
                    <TabsTrigger value="summary">Summary</TabsTrigger>
                    <TabsTrigger value="fulltext">Full Text</TabsTrigger>
                    <TabsTrigger value="details">Details</TabsTrigger>
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
                                <p className="text-base leading-relaxed">{briefSummary.content}</p>
                                {briefSummary.keyPoints && briefSummary.keyPoints.length > 0 && (
                                    <div className="mt-4">
                                        <h4 className="mb-2 font-semibold">Key Points:</h4>
                                        <ul className="list-inside list-disc space-y-1 text-sm">
                                            {briefSummary.keyPoints.map((point: string, idx: number) => (
                                                <li key={idx}>{point}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                <div className="mt-4 text-xs text-muted-foreground">
                                    Generated by {briefSummary.aiModel} on{' '}
                                    {formatDate(briefSummary.generatedAt)}
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
                                    {standardSummary.content}
                                </p>
                                {standardSummary.keyPoints && standardSummary.keyPoints.length > 0 && (
                                    <div className="mt-4">
                                        <h4 className="mb-2 font-semibold">Key Points:</h4>
                                        <ul className="list-inside list-disc space-y-1 text-sm">
                                            {standardSummary.keyPoints.map((point: string, idx: number) => (
                                                <li key={idx}>{point}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                <div className="mt-4 text-xs text-muted-foreground">
                                    Generated by {standardSummary.aiModel} on{' '}
                                    {formatDate(standardSummary.generatedAt)}
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
                                    {detailedSummary.content}
                                </p>
                                {detailedSummary.keyPoints && detailedSummary.keyPoints.length > 0 && (
                                    <div className="mt-4">
                                        <h4 className="mb-2 font-semibold">Key Points:</h4>
                                        <ul className="list-inside list-disc space-y-1 text-sm">
                                            {detailedSummary.keyPoints.map((point: string, idx: number) => (
                                                <li key={idx}>{point}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                <div className="mt-4 text-xs text-muted-foreground">
                                    Generated by {detailedSummary.aiModel} on{' '}
                                    {formatDate(detailedSummary.generatedAt)}
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                {/* Full Text Tab */}
                <TabsContent value="fulltext">
                    <Card>
                        <CardHeader>
                            <CardTitle>Full Text</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {executiveOrder.fullText ? (
                                <div className="prose max-w-none whitespace-pre-wrap font-mono text-sm leading-relaxed">
                                    {formatExecutiveOrderText(executiveOrder.fullText)}
                                </div>
                            ) : (
                                <div className="py-8 text-center text-muted-foreground">
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
                            )}
                        </CardContent>
                    </Card>
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
                                    <dd className="mt-1 text-sm">{formatDate(executiveOrder.lastFetchedAt)}</dd>
                                </div>
                            </dl>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
