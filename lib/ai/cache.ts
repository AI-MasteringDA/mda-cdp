import { getAnalyticsClient } from "@/lib/supabase/analytics";

/**
 * AI result cache — stored in Supabase ai_cache table.
 *
 * Strategy: User-driven refresh. Cache lasts forever until user explicitly
 * clicks Refresh button → forces regeneration.
 *
 * Uses service-role client (no cookies, bypasses RLS) because cache is
 * workspace-shared and we don't need per-user RLS.
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
  try {
    const supabase = getAnalyticsClient();
    const { data, error } = await supabase
      .from("ai_cache")
      .select("*")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (error) {
      console.warn(`[ai-cache] getCached ${cacheKey} error: ${error.message}`);
      return null;
    }
    return (data as CacheRecord<T> | null) ?? null;
  } catch (e) {
    console.warn(`[ai-cache] getCached ${cacheKey} threw: ${(e as Error).message}`);
    return null;
  }
}

export async function setCached<T>(
  cacheKey: string,
  payload: T,
  metadata: CacheRecord<T>["metadata"] = {}
): Promise<void> {
  try {
    const supabase = getAnalyticsClient();
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
      console.warn(`[ai-cache] setCached ${cacheKey} error: ${error.message}`);
    } else {
      console.log(`[ai-cache] ✅ Saved ${cacheKey} at ${now}`);
    }
  } catch (e) {
    console.warn(`[ai-cache] setCached ${cacheKey} threw: ${(e as Error).message}`);
  }
}

export async function clearCached(cacheKey: string): Promise<void> {
  try {
    const supabase = getAnalyticsClient();
    await supabase.from("ai_cache").delete().eq("cache_key", cacheKey);
  } catch (e) {
    console.warn(`[ai-cache] clearCached ${cacheKey} threw: ${(e as Error).message}`);
  }
}

// Canonical cache keys
export const cacheKey = {
  growthPlan: () => "growth_plan:default",
  leadInsights: (leadId: string) => `lead_insights:${leadId}`,
};
