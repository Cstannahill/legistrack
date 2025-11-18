export type ExecutiveOrderType =
  | "EXECUTIVE_ORDER"
  | "PRESIDENTIAL_MEMORANDUM"
  | "PROCLAMATION"
  | "DETERMINATION";

export interface FetchExecutiveOrdersParams {
  page?: number;
  perPage?: number;
  conditions?: {
    publicationDate?: {
      gte?: string;
      lte?: string;
    };
    signingDate?: {
      gte?: string;
      lte?: string;
    };
    presidentialDocumentType?: string[];
    type?: string[];
  };
}

export interface FederalRegisterPresident {
  name?: string;
}

export interface FederalRegisterDocument {
  document_number: string;
  type: string;
  presidential_document_type?: string;
  subtype?: string;
  title: string;
  signing_date?: string;
  publication_date?: string;
  executive_order_number?: number | string | null;
  presidential_document_number?: string | null;
  proclamation_number?: number | string | null;
  president?: FederalRegisterPresident;
  html_url?: string;
  pdf_url?: string;
  body_html_url?: string;
  full_text_xml_url?: string;
  raw_text_url?: string;
  abstract?: string;
}

export interface FederalRegisterListResponse {
  count: number;
  page: number;
  total_pages: number;
  total_entries: number;
  results: FederalRegisterDocument[];
}

export interface HydratedExecutiveOrder {
  documentNumber: string;
  orderNumber: number;
  executiveOrderType: ExecutiveOrderType;
  title: string;
  signingDate: Date;
  publicationDate?: Date;
  federalRegisterUrl?: string;
  sourceUrl?: string;
  presidentName: string;
  summary?: string | null;
  fullText?: string | null;
  fullTextUrl?: string | null;
}

export interface PersistedExecutiveOrderResult {
  action: "created" | "updated" | "skipped" | "failed";
  identifier: string;
  executiveOrderId?: string;
  message?: string;
}

export interface IngestExecutiveOrdersEvent {
  startDate?: string;
  endDate?: string;
  lookbackDays?: number;
  documentTypes?: string[];
  perPage?: number;
  fetchFullText?: boolean;
  maxPages?: number;
}

export interface IngestExecutiveOrdersResult {
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

export interface EnvironmentConfig {
  lookbackDays: number;
  minimumLogLevel: "debug" | "info" | "warn" | "error";
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  defaultPerPage: number;
  defaultFetchFullText: boolean;
  defaultDocumentTypes?: string[];
}
