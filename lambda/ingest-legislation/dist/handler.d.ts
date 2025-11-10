interface IngestLegislationEvent {
    startDate?: string;
    endDate?: string;
    lookbackDays?: number;
    congress?: number;
    billTypes?: string[];
    limit?: number;
}
interface IngestLegislationResult {
    processed: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    windowStart: string;
    windowEnd: string;
    details: Array<{
        identifier: string;
        action: "created" | "updated" | "skipped" | "failed";
        message?: string;
    }>;
}

declare function handler(event?: IngestLegislationEvent): Promise<IngestLegislationResult>;

export { handler };
