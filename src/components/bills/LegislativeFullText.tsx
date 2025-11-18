import { Card } from "@/components/ui/card";
import { FileText, Building2 } from "lucide-react";
import { cleanLegislativeText, parseLegislativeText } from "@/lib/utils/legislation-text";

interface LegislativeFullTextProps {
    text: string;
    billIdentifier: string;
}

export function LegislativeFullText({ text, billIdentifier }: LegislativeFullTextProps) {
    const cleaned = cleanLegislativeText(text);
    const parsed = parseLegislativeText(text);

    return (
        <div className="space-y-4">
            {/* Header Information Card */}
            {(parsed.header || parsed.billInfo) && (
                <Card className="border-l-4 border-l-slate-500 bg-slate-50/50 dark:bg-slate-950/20">
                    <div className="p-4 space-y-3">
                        {parsed.header && (
                            <div className="flex items-start gap-3">
                                <Building2 className="h-4 w-4 mt-1 text-slate-600 dark:text-slate-400 shrink-0" />
                                <div className="space-y-1 text-xs font-mono text-slate-600 dark:text-slate-400">
                                    {parsed.header.split('\n').map((line, idx) => (
                                        <div key={idx}>{line}</div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {parsed.billInfo && (
                            <div className="flex items-start gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                                <FileText className="h-4 w-4 mt-1 text-slate-600 dark:text-slate-400 shrink-0" />
                                <div className="space-y-1">
                                    {parsed.title && (
                                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                                            {parsed.title}
                                        </h3>
                                    )}
                                    <pre className="text-xs font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                                        {parsed.billInfo}
                                    </pre>
                                </div>
                            </div>
                        )}
                    </div>
                </Card>
            )}

            {/* Main Legislative Text Card */}
            <Card>
                <div className="p-6 mx-auto">
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                        <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed">
                            {parsed.content || cleaned}
                        </pre>
                    </div>
                </div>
            </Card>

            {/* Footer Note */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="h-3 w-3" />
                <span>Official legislative text for {billIdentifier}</span>
            </div>
        </div>
    );
}
