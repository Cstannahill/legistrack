import type { SupabaseClient } from "@supabase/supabase-js";

export type SummaryType = "STANDARD";

export type RecordKind = "bill" | "executive_order";

export interface EnvironmentConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  siteUrl: string;
  appName: string;
  billBatchSize: number;
  executiveOrderBatchSize: number;
  billModelKey: OpenRouterModelKey;
  executiveOrderModelKey: OpenRouterModelKey;
  billKeyIndex: number;
  executiveOrderKeyIndex: number;
}

export type OpenRouterModelKey = "openai/gpt-oss-20b:free" | "kwaipilot/kat-coder-pro:free";

export interface BillRecord {
  id: string;
  billType: string;
  billNumber: number;
  congress: number;
  title: string;
  shortTitle?: string | null;
  currentStatus: string;
  statusDate?: string | null;
  introducedDate?: string | null;
  fullText: string | null;
  fullTextUrl?: string | null;
}

export interface ExecutiveOrderRecord {
  id: string;
  orderNumber: number;
  executiveOrderType: string;
  title: string;
  presidentName?: string | null;
  signingDate?: string | null;
  publicationDate?: string | null;
  fullText: string | null;
  fullTextUrl?: string | null;
}

export interface SummarizationItem {
  sourceId: string;
  kind: RecordKind;
  title: string;
  text: string;
  metadata: Record<string, string | number | undefined | null>;
}

export interface SummarizationResult {
  sourceId: string;
  summary: string;
  keyPoints: string[];
  impactAreas: string[];
  confidence: number;
  aiModel: string;
}

export interface BatchProcessMetrics {
  requested: number;
  prepared: number;
  summarized: number;
  persisted: number;
  skipped: number;
  failed: number;
  errors: Array<{ id: string; reason: string }>;
}

export interface LambdaSummaryResult {
  bills: BatchProcessMetrics;
  executiveOrders: BatchProcessMetrics;
}

export interface SummaryInsert {
  summaryType: SummaryType;
  content: string;
  keyPoints: string[];
  impactAreas: string[];
  aiModel: string;
  confidence: number;
  billId?: string;
  executiveOrderId?: string;
}

export type Supabase = SupabaseClient<any, "public", any>;

