import { createClient } from "@/lib/supabase/server";

/**
 * AI result cache — stored in Supabase ai_cache table.
 *
 * Strategy: User-driven refresh. Cache lasts forever until user explicitly
 * clicks Refresh button → forces regeneration.
 *
 * Rationale: Sonnet 4.6 costs ~1000-3000đ per call. If user switches tabs and
 * comes back, re-generating is wasteful — the underlying data hasn't changed
 * meaningfully in seconds. Let user decide when to refresh.
 */

export type CacheRecord<T = unknown> = {
  cache_key: string;
  payload: T;
  metadata: {
    model?: string;
    elapsed_seconds?: number;
    generated_at?: string;
    [k: string]: unknown;
  };
  created_at: string;
  updated_at: string;
};

export async function getCached<T>(cacheKey: string): Promise<CacheRecord<T> | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_cache")
    .select("*")
    .eq("cache_key", cacheKey)
    .maybeSingle();
  return (data as CacheRecord<T> | null) ?? null;
}

export async function setCached<T>(
  cacheKey: string,
  payload: T,
  metadata: CacheRecord<T>["metadata"] = {}
): Promise<void> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("ai_cache")
    .upsert(
      {
        cache_key: cacheKey,
        payload: payload as object,
        metadata: { ...metadata, generated_at: now },
        updated_at: now,
      },
      { onConflict: "cache_key" }
    );
  if (error) {
    // Don't crash — caching is best-effort. Log only.
    console.warn(`[ai-cache] Failed to cache ${cacheKey}: ${error.message}`);
  }
}

export async function clearCached(cacheKey: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("ai_cache").delete().eq("cache_key", cacheKey);
}

// Canonical cache keys
export const cacheKey = {
  growthPlan: () => "growth_plan:default",
  leadInsights: (leadId: string) => `lead_insights:${leadId}`,
};
