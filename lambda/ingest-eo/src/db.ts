import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type GlobalWithSupabase = typeof globalThis & {
  __eo_supabase?: SupabaseClient;
};

const globalRef = globalThis as GlobalWithSupabase;

interface SupabaseConfig {
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
}

export function getSupabaseClient(config?: SupabaseConfig): SupabaseClient {
  if (!globalRef.__eo_supabase) {
    const supabaseUrl = config?.supabaseUrl ?? process.env.SUPABASE_URL;
    const supabaseServiceRoleKey =
      config?.supabaseServiceRoleKey ??
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl) {
      throw new Error("SUPABASE_URL must be configured");
    }

    if (!supabaseServiceRoleKey) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) must be configured"
      );
    }

    globalRef.__eo_supabase = createClient(
      supabaseUrl,
      supabaseServiceRoleKey,
      {
        auth: { persistSession: false },
      }
    );
  }

  return globalRef.__eo_supabase;
}
