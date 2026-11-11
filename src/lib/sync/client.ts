import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadSyncConfig } from "./config.ts";

let cachedClient: SupabaseClient | null = null;
let lastUrl = "";
let lastKey = "";

export function getSupabaseClient(): SupabaseClient | null {
  const config = loadSyncConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    return null;
  }

  if (cachedClient && lastUrl === config.supabaseUrl && lastKey === config.supabaseAnonKey) {
    return cachedClient;
  }

  try {
    cachedClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });
    lastUrl = config.supabaseUrl;
    lastKey = config.supabaseAnonKey;
    return cachedClient;
  } catch (err) {
    console.error("[sync] Failed to initialize Supabase client:", err);
    return null;
  }
}
