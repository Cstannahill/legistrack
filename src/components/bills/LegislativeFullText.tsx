"use client"

import { useState } from "react"
import { Building2, Check, Copy, FileText, Type } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cleanLegislativeText, parseLegislativeText } from "@/lib/utils/legislation-text"
import { cn } from "@/lib/utils"

interface LegislativeFullTextProps {
    text: string
    billIdentifier: string
}

export function LegislativeFullText({
    text,
    billIdentifier,
}: LegislativeFullTextProps) {
    const cleaned = cleanLegislativeText(text)
    const parsed = parseLegislativeText(text)
    const mainText = parsed.content || cleaned

    const [copied, setCopied] = useState(false)
    const [comfortable, setComfortable] = useState(true)
    const [fontStyle, setFontStyle] = useState<"sans" | "mono">("sans")

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(cleaned)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch {
            // Clipboard unavailable
        }
    }

    return (
        <div className="space-y-4">
            {/* Reader Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-2.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Official text for {billIdentifier}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => setFontStyle((f) => (f === "sans" ? "mono" : "sans"))}
                    >
                        <Type className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{fontStyle === "sans" ? "Sans" : "Mono"}</span>
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => setComfortable((c) => !c)}
                    >
                        <span>{comfortable ? "Comfortable" : "Compact"}</span>
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={handleCopy}
                    >
                        {copied ? (
                            <>
                                <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                                <span>Copied</span>
                            </>
                        ) : (
                            <>
                                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Copy text</span>
                            </>
                        )}
                    </Button>
                </div>
            </div>

            {/* Header Information Card */}
            {(parsed.header || parsed.billInfo) && (
                <Card className="border-l-4 border-l-primary/50 bg-muted/35 py-4">
                    <div className="px-5 space-y-3">
                        {parsed.header && (
                            <div className="flex items-start gap-3">
                                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                <div className="space-y-0.5 font-mono text-xs text-muted-foreground">
                                    {parsed.header.split("\n").map((line, idx) => (
                                        <div key={idx}>{line}</div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {parsed.billInfo && (
                            <div className="flex items-start gap-3 border-t border-border/60 pt-3">
                                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                <div className="min-w-0 space-y-1">
                                    {parsed.title && (
                                        <h3 className="text-sm font-semibold text-foreground">
                                            {parsed.title}
                                        </h3>
                                    )}
                                    <pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                                        {parsed.billInfo}
                                    </pre>
                                </div>
                            </div>
                        )}
                    </div>
                </Card>
            )}

            {/* Main Legislative Text Card */}
            <Card className="overflow-hidden py-0">
                <div className="p-5 sm:p-8">
                    <div
                        className={cn(
                            "max-w-[74ch] whitespace-pre-wrap break-words text-foreground/90",
                            fontStyle === "mono" ? "font-mono" : "font-sans",
                            comfortable
                                ? "text-[15px] leading-[1.75]"
                                : "text-[13px] leading-[1.55]"
                        )}
                    >
                        {mainText}
                    </div>
                </div>
            </Card>
        </div>
    )
}
