import type { SupabaseClient } from "@supabase/supabase-js";

export interface EnvironmentConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  billBatchSize: number;
  executiveOrderBatchSize: number;
  billDelayMs: number;
  executiveOrderDelayMs: number;
}

export interface BillRecord {
  id: string;
  billType: string;
  billNumber: number;
  congress: number;
  title: string;
  fullText: string | null;
  fullTextUrl?: string | null;
}

export interface ExecutiveOrderRecord {
  id: string;
  orderNumber: number;
  title: string;
  signingDate?: string | null;
  fullText: string | null;
  federalRegisterUrl?: string | null;
}

export interface UpdateSummary {
  requested: number;
  processed: number;
  updated: number;
  urlOnly: number;
  failed: number;
}

export interface LambdaResult {
  bills: UpdateSummary;
  executiveOrders: UpdateSummary;
}

export type Supabase = SupabaseClient<any, "public", any>;
