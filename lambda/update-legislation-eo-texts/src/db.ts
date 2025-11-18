import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { EnvironmentConfig } from "./types.js";

type Client = SupabaseClient<any, "public", any>;

let cachedClient: Client | undefined;

export function getSupabaseClient(config: EnvironmentConfig): Client {
  if (!cachedClient) {
    cachedClient = createClient(
      config.supabaseUrl,
      config.supabaseServiceRoleKey,
      {
        auth: {
          persistSession: false,
        },
      }
    );
  }
  return cachedClient;
}
