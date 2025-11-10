import type { BillStatus, Chamber } from "@prisma/client";

export interface IngestLegislationEvent {
  startDate?: string;
  endDate?: string;
  lookbackDays?: number;
  congress?: number;
  billTypes?: string[];
  limit?: number;
}

export interface IngestLegislationResult {
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
  congressApiKey: string;
  lookbackDays: number;
  defaultCongress: number;
  minimumLogLevel: "debug" | "info" | "warn" | "error";
}

export interface CongressBillListItem {
  congress: number;
  type: string;
  number: string;
  title: string;
  updateDate?: string;
  introducedDate?: string;
  latestAction?: {
    actionDate?: string;
    text?: string;
  };
  url?: string;
}

export interface CongressBillListResponse {
  bills: CongressBillListItem[];
  pagination?: {
    count?: number;
    limit?: number;
    offset?: number;
    next?: string;
  };
}

export interface CongressName {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  middleName?: string;
  suffix?: string;
}

export interface CongressPersonReference extends CongressName {
  bioguideId?: string;
  party?: string;
  state?: string;
  chamber?: Chamber;
  district?: number | null;
}

export interface CongressBillDetail {
  bill: {
    billType?: string;
    type?: string;
    billNumber?: string;
    number?: string;
    congress?: number;
    title?: string;
    shortTitle?: string;
    introducedDate?: string;
    latestAction?: {
      actionDate?: string;
      text?: string;
      description?: string;
    };
    committees?: Array<{
      name?: string;
    }>;
    subjects?: Array<{
      name?: string;
    }>;
    policyArea?: { name?: string } | null;
    laws?: Array<{ lawNumber?: string }>;
    sponsor?: CongressPersonReference | null;
    sponsors?: CongressPersonReference[];
    cosponsors?: {
      count?: number;
      url?: string;
      items?: CongressPersonReference[];
    };
    relatedBills?: Array<{
      type?: string;
      number?: string;
      congress?: number;
      relationship?: string;
    }>;
    actions?: {
      url?: string;
      count?: number;
      items?: CongressBillAction[];
    };
  };
}

export interface CongressTextFormat {
  type?: string;
  url?: string;
}

export interface CongressBillTextVersion {
  type?: string;
  date?: string;
  formats?: CongressTextFormat[];
}

export interface CongressBillTextResponse {
  textVersions?: CongressBillTextVersion[];
}

export interface CongressBillAction {
  actionDate?: string;
  sourceSystem?: {
    code?: string;
    name?: string;
  };
  text?: string;
}

export interface CongressBillActionResponse {
  actions?: CongressBillAction[];
}

export interface CongressAmendmentSummary {
  number?: string;
  type?: string;
  congress?: number;
  status?: string;
  statusDate?: string;
  description?: string;
  purpose?: string;
  sponsor?: CongressPersonReference | null;
}

export interface CongressAmendmentResponse {
  amendments?: CongressAmendmentSummary[];
}

export interface CongressMemberDetail {
  member?: {
    bioguideId?: string;
    officialName?: string;
    firstName?: string;
    lastName?: string;
    middleName?: string;
    suffix?: string;
    party?: string;
    state?: string;
    district?: string;
    chamber?: {
      code?: string;
      name?: string;
    };
    terms?: Array<{
      startYear?: number;
      endYear?: number;
      party?: string;
      state?: string;
      district?: string;
      chamber?: string;
      startDate?: string;
      endDate?: string;
    }>;
    depiction?: {
      url?: string;
    };
    website?: string;
  };
}

export interface HydratedBillData {
  bill: CongressBillDetail["bill"];
  text?: {
    content: string | null;
    url?: string;
    date?: string;
  };
  actions: CongressBillAction[];
  amendments: CongressAmendmentSummary[];
  cosponsors: CongressPersonReference[];
}

export interface PersistedBillResult {
  action: "created" | "updated" | "skipped" | "failed";
  billId?: string;
  identifier: string;
  message?: string;
}

export interface BillStatusResolution {
  status: BillStatus;
  statusDate: Date;
}
