import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for ANALYTICS queries only.
 *
 * Why a separate client:
 * - lib/supabase/server.ts uses cookies (RLS-aware, per-user)
 * - That makes it incompatible with Next.js unstable_cache (cookies are
 *   request-scoped). Calling cookies() inside cache throws.
 * - This admin client uses service role key, no cookies → can wrap with
 *   unstable_cache → analytics queries cached across requests.
 *
 * Safe for MDA (single tenant): all authenticated users see same workspace data.
 * For multi-tenant: include workspace_id in cache key + filter explicitly.
 */

let _client: SupabaseClient | null = null;

export function getAnalyticsClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase env vars for analytics client");
  }
  _client = createClient(
    url.trim().replace(/^﻿/, ""),
    key.trim().replace(/^﻿/, ""),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  return _client;
}
