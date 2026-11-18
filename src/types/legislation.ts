export interface LegislationCategory {
  id: string;
  name: string;
  slug: string;
  color?: string | null;
}

export interface LegislationSummaryPreview {
  summaryType: string;
  content: string;
  keyPoints?: string[];
}

export interface BillListItem {
  type: "bill";
  id: string;
  billType: string;
  billNumber: number;
  congress: number;
  title: string;
  currentStatus: string;
  introducedDate: Date | string;
  fullText?: string | null;
  sponsor?: {
    fullName: string;
    party: string;
    state: string;
  } | null;
  categories: LegislationCategory[];
  summaries?: LegislationSummaryPreview[];
}

export interface ExecutiveOrderListItem {
  type: "executiveOrder";
  id: string;
  orderNumber: number;
  executiveOrderType:
    | "EXECUTIVE_ORDER"
    | "PRESIDENTIAL_MEMORANDUM"
    | "PROCLAMATION"
    | "DETERMINATION";
  title: string;
  signingDate: Date | string;
  presidentName: string;
  fullText?: string | null;
  categories: LegislationCategory[];
  summaries?: LegislationSummaryPreview[];
}

export type LegislationListItem = BillListItem | ExecutiveOrderListItem;
