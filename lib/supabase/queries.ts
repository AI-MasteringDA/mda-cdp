import { unstable_cache } from "next/cache";
import { createClient } from "./server";
import { getAnalyticsClient } from "./analytics";
import type { Lead, LeadTier, ScoreReason, Touchpoint } from "@/types/lead";
import { scoreToTier } from "@/types/lead";

/**
 * Wrap heavy analytics queries with Next.js unstable_cache (5-min revalidate).
 * Uses analytics client (service role, no cookies) so it works inside cache.
 *
 * IMPORTANT: heavy analytics functions that use unstable_cache must NOT call
 * createClient() (which uses cookies). They must use getAnalyticsClient() directly.
 *
 * Single-tenant assumption (MDA): all users share the same workspace data.
 */
const CACHE_REVALIDATE_SECONDS = 300;

// Map UI tier label to (minScore, maxScore inclusive)
export const TIER_RANGE: Record<LeadTier, [number, number]> = {
  "NÓNG": [70, 100],
  "ẤM": [40, 69],
  "MÁT": [20, 39],
  "NGỦ ĐÔNG": [0, 19],
};

type LeadRow = {
  lead_id: string;
  email: string;
  phone: string;
  full_name: string;
  source: string;
  avatar_color: string;
  stage: string;
  /** DEPRECATED — no ETL maintains this column. Use last_engagement_at instead. */
  last_touch_at: string | null;
  /** Real "last activity" — set by recompute_lead_aggregates() from any meaningful event */
  last_engagement_at: string | null;
  last_chat_at?: string | null;
  last_chat_staff_at?: string | null;
  last_email_at?: string | null;
  first_seen_at: string;
  company?: string | null;
  assignee?: string | null;
  lead_source?: string | null;
  sf_product?: string | null;
  sf_rating?: string | null;
  sf_status?: string | null;
};

type ScoreRow = {
  lead_id: string;
  hot_score: number;
  cold_score: number;
  hot_reasons: string[];
  cold_reasons: string[];
};

type TouchRow = {
  id: string;
  lead_id: string;
  source: string;
  event_type: string;
  title: string;
  detail: string | null;
  occurred_at: string;
  payload?: { sender_is_staff?: boolean } | null;
};

function parseReasons(raw: unknown): ScoreReason[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is { sign: string; label: string; points: number } =>
      typeof r === "object" && r !== null &&
      "sign" in r && "label" in r && "points" in r
    )
    .map((r) => ({
      sign: (r.sign === "-" ? "-" : "+") as "+" | "-",
      label: String(r.label),
      points: Number(r.points) || 0,
    }));
}

function mergeToLead(row: LeadRow, score?: ScoreRow, touchpoints: TouchRow[] = []): Lead {
  const unifiedScore = score?.hot_score ?? 0;
  const reasons = parseReasons(score?.hot_reasons);
  return {
    id: row.lead_id,
    name: row.full_name,
    email: row.email,
    phone: row.phone,
    source: row.source as Lead["source"],
    avatarColor: row.avatar_color,
    score: unifiedScore,
    tier: scoreToTier(unifiedScore),
    reasons,
    // Backward-compat (deprecated, computed from unified)
    hotScore: unifiedScore,
    coldScore: score?.cold_score ?? 0,
    hotReasons: reasons.map((r) => `${r.sign}${r.points} ${r.label}`),
    coldReasons: [],
    // Priority chain: last_engagement_at (any real signal) → last_chat_at → last_chat_staff_at
    //                 → last_email_at → last_touch_at (legacy null) → first_seen_at (creation)
    lastContactAt: new Date(
      row.last_engagement_at ??
      row.last_chat_at ??
      row.last_chat_staff_at ??
      row.last_email_at ??
      row.last_touch_at ??
      row.first_seen_at
    ),
    firstSeenAt: new Date(row.first_seen_at),
    stage: row.stage as Lead["stage"],
    assignee: row.assignee || "—",
    company: row.company || null,
    leadSource: row.lead_source || null,
    sfProduct: row.sf_product || null,
    sfRating: row.sf_rating || null,
    sfStatus: row.sf_status || null,
    touchpoints: touchpoints.map<Touchpoint>((t) => ({
      id: t.id,
      source: t.source as Touchpoint["source"],
      type: t.event_type as Touchpoint["type"],
      title: t.title,
      detail: t.detail ?? undefined,
      occurredAt: new Date(t.occurred_at),
      senderIsStaff: t.source === "smax"
        ? (t.payload?.sender_is_staff ?? (t.event_type === "chat_staff" ? true : t.event_type === "chat" ? false : null))
        : undefined,
    })),
  };
}

async function getLatestScoredAt(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  const { data } = await supabase
    .from("fact_lead_score")
    .select("scored_at")
    .order("scored_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.scored_at || new Date().toISOString().slice(0, 10);
}

export type LeadListFilter = {
  source?: string;
  stage?: string;
  /** Filter by SF product name substring. e.g. "K61" matches "K61 - 2026" and "K61 - ONL - 2026". */
  product?: string;
  sort?: "score-desc" | "score-asc" | "recent" | "oldest" | "name";
};

async function fetchLeadsByScoreRange(
  minScore: number,
  maxScore: number,
  limit: number,
  offset: number,
  scoreAsc = false, // for cold/dormant, ascending = "most dormant first"
  filter?: LeadListFilter
): Promise<Lead[]> {
  const supabase = await createClient();
  const latestDate = await getLatestScoredAt(supabase);
  let query = supabase
    .from("fact_lead_score")
    .select("*")
    .eq("scored_at", latestDate)
    .gte("hot_score", minScore)
    .lte("hot_score", maxScore);

  // Apply sort to score query (only for score-based sort)
  const sort = filter?.sort ?? (scoreAsc ? "score-asc" : "score-desc");
  if (sort === "score-asc") query = query.order("hot_score", { ascending: true });
  else query = query.order("hot_score", { ascending: false });

  // If no source/stage/product filter, paginate at SQL level
  const hasMetaFilter = !!(filter?.source || filter?.stage || filter?.product);
  if (!hasMetaFilter) {
    const { data: scores } = await query.range(offset, offset + limit - 1);
    if (!scores || scores.length === 0) return [];
    return joinLeads(supabase, scores, sort);
  }

  // Else: pull more scores then filter in JS
  const { data: scores } = await query.range(0, Math.min(5000, offset + limit) - 1);
  if (!scores || scores.length === 0) return [];
  const all = await joinLeads(supabase, scores, sort);
  const productLower = filter?.product?.toLowerCase();
  const filtered = all.filter((l) => {
    if (filter?.source && l.source !== filter.source) return false;
    if (filter?.stage && l.stage !== filter.stage) return false;
    if (productLower && !(l.sfProduct || "").toLowerCase().includes(productLower)) return false;
    return true;
  });
  return filtered.slice(offset, offset + limit);
}

async function joinLeads(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scores: { lead_id: string; hot_score: number; cold_score: number; hot_reasons: unknown; cold_reasons: unknown }[],
  sort: LeadListFilter["sort"]
): Promise<Lead[]> {
  const leadIds = scores.map((s) => s.lead_id);
  const { data: leads } = await supabase.from("dim_lead").select("*").in("lead_id", leadIds);
  if (!leads) return [];
  const leadMap = new Map(leads.map((l) => [l.lead_id, l]));
  const merged = scores
    .map((s) => {
      const lead = leadMap.get(s.lead_id);
      return lead ? mergeToLead(lead, s as Parameters<typeof mergeToLead>[1]) : null;
    })
    .filter((x): x is Lead => x !== null);

  // Apply non-score sorts in JS
  if (sort === "recent") merged.sort((a, b) => b.lastContactAt.getTime() - a.lastContactAt.getTime());
  else if (sort === "oldest") merged.sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime());
  else if (sort === "name") merged.sort((a, b) => a.name.localeCompare(b.name, "vi"));
  return merged;
}

async function countLeadsByScoreRange(min: number, max: number, filter?: LeadListFilter): Promise<number> {
  const supabase = await createClient();
  const latestDate = await getLatestScoredAt(supabase);
  // No meta filter → exact count fast
  if (!filter?.source && !filter?.stage && !filter?.product) {
    const { count } = await supabase
      .from("fact_lead_score")
      .select("*", { count: "exact", head: true })
      .eq("scored_at", latestDate)
      .gte("hot_score", min)
      .lte("hot_score", max);
    return count ?? 0;
  }
  // With meta filter, pull score lead_ids then count via dim_lead with .in()
  const { data: scores } = await supabase
    .from("fact_lead_score")
    .select("lead_id")
    .eq("scored_at", latestDate)
    .gte("hot_score", min)
    .lte("hot_score", max);
  if (!scores || scores.length === 0) return 0;
  const leadIds = scores.map((s) => s.lead_id);
  let total = 0;
  for (let i = 0; i < leadIds.length; i += 500) {
    const batch = leadIds.slice(i, i + 500);
    let q = supabase.from("dim_lead").select("*", { count: "exact", head: true }).in("lead_id", batch);
    if (filter?.source) q = q.eq("source", filter.source);
    if (filter?.stage) q = q.eq("stage", filter.stage);
    if (filter?.product) q = q.ilike("sf_product", `%${filter.product}%`);
    const { count } = await q;
    total += count ?? 0;
  }
  return total;
}

export const getHotLeads = (limit = 50, offset = 0, filter?: LeadListFilter) =>
  fetchLeadsByScoreRange(70, 100, limit, offset, false, filter);

/**
 * Auto-discover top products in Hot leads (for filter dropdown).
 * Returns product name + hot count, sorted by count DESC.
 * Excludes null/generic products.
 */
export async function getTopHotProducts(limit = 15): Promise<{ product: string; hotCount: number }[]> {
  const supabase = await createClient();
  const latestDate = await getLatestScoredAt(supabase);
  const { data: scores } = await supabase
    .from("fact_lead_score")
    .select("lead_id")
    .eq("scored_at", latestDate)
    .gte("hot_score", 70);
  if (!scores || scores.length === 0) return [];
  const leadIds = scores.map((s) => s.lead_id);
  const productCounts = new Map<string, number>();
  for (let i = 0; i < leadIds.length; i += 500) {
    const batch = leadIds.slice(i, i + 500);
    const { data: leads } = await supabase
      .from("dim_lead")
      .select("sf_product")
      .in("lead_id", batch)
      .not("sf_product", "is", null);
    for (const l of leads ?? []) {
      const p = (l.sf_product || "").trim();
      if (!p || p === "Data Analytics Training") continue; // skip generic
      productCounts.set(p, (productCounts.get(p) ?? 0) + 1);
    }
  }
  return Array.from(productCounts.entries())
    .map(([product, hotCount]) => ({ product, hotCount }))
    .sort((a, b) => b.hotCount - a.hotCount)
    .slice(0, limit);
}
export const getHotLeadsCount = (filter?: LeadListFilter) => countLeadsByScoreRange(70, 100, filter);

// Cross-sell READY: existing customers with intent for next course
export type CrossSellRow = {
  lead_id: string;
  full_name: string | null;
  email: string | null;
  customer_lifecycle_stage: string;
  lifetime_value: number;
  months_since_last_purchase: number | null;
  courses_purchased: string[] | null;
  cross_score: number;
  cross_reasons: Array<{ sign: string; label: string; points: number }>;
  suggested_next_course: string | null;
};

export async function getCrossSellReady(minScore = 60, limit = 100): Promise<CrossSellRow[]> {
  const supabase = getAnalyticsClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("fact_crosssell_score")
    .select(`
      cross_score, cross_reasons, suggested_next_course, lead_id,
      dim_lead!inner(full_name, email, customer_lifecycle_stage, lifetime_value, months_since_last_purchase, courses_purchased)
    `)
    .eq("scored_at", today)
    .gte("cross_score", minScore)
    .order("cross_score", { ascending: false })
    .limit(limit);

  return (data || []).map((r) => {
    const l = r.dim_lead as unknown as {
      full_name: string | null;
      email: string | null;
      customer_lifecycle_stage: string;
      lifetime_value: number;
      months_since_last_purchase: number | null;
      courses_purchased: string[] | null;
    };
    return {
      lead_id: r.lead_id,
      full_name: l.full_name,
      email: l.email,
      customer_lifecycle_stage: l.customer_lifecycle_stage,
      lifetime_value: l.lifetime_value,
      months_since_last_purchase: l.months_since_last_purchase,
      courses_purchased: l.courses_purchased,
      cross_score: r.cross_score,
      cross_reasons: (r.cross_reasons as Array<{ sign: string; label: string; points: number }>) || [],
      suggested_next_course: r.suggested_next_course,
    };
  });
}

export async function getCrossSellStats() {
  const supabase = getAnalyticsClient();
  const today = new Date().toISOString().slice(0, 10);
  const [readyC, nurtureC, coldC] = await Promise.all([
    supabase.from("fact_crosssell_score").select("*", { count: "exact", head: true }).eq("scored_at", today).gte("cross_score", 60),
    supabase.from("fact_crosssell_score").select("*", { count: "exact", head: true }).eq("scored_at", today).gte("cross_score", 40).lte("cross_score", 59),
    supabase.from("fact_crosssell_score").select("*", { count: "exact", head: true }).eq("scored_at", today).lte("cross_score", 39),
  ]);
  return {
    ready: readyC.count ?? 0,
    nurture: nurtureC.count ?? 0,
    cold: coldC.count ?? 0,
  };
}

export const getWarmLeads = (limit = 100, offset = 0, filter?: LeadListFilter) =>
  fetchLeadsByScoreRange(40, 69, limit, offset, false, filter);
export const getWarmLeadsCount = (filter?: LeadListFilter) => countLeadsByScoreRange(40, 69, filter);

export const getCoolLeads = (limit = 100, offset = 0, filter?: LeadListFilter) =>
  fetchLeadsByScoreRange(20, 39, limit, offset, false, filter);
export const getCoolLeadsCount = (filter?: LeadListFilter) => countLeadsByScoreRange(20, 39, filter);

export const getDormantLeads = (limit = 100, offset = 0, filter?: LeadListFilter) =>
  fetchLeadsByScoreRange(0, 19, limit, offset, true, filter);
export const getDormantLeadsCount = (filter?: LeadListFilter) => countLeadsByScoreRange(0, 19, filter);

// Deprecated aliases — old /cold-leads route still uses these
export const getColdLeads = (limit = 100, offset = 0) =>
  fetchLeadsByScoreRange(0, 39, limit, offset, true);
export const getColdLeadsCount = () => countLeadsByScoreRange(0, 39);

function buildSearchOrClause(q: string): string {
  // Escape % and , để tránh broken query syntax
  const safe = q.replace(/[%,]/g, "");
  return [
    `full_name.ilike.%${safe}%`,
    `email.ilike.%${safe}%`,
    `phone.ilike.%${safe}%`,
  ].join(",");
}

export async function getAllLeadsCount(searchQuery?: string): Promise<number> {
  const supabase = await createClient();
  let q = supabase.from("dim_lead").select("*", { count: "exact", head: true });
  if (searchQuery && searchQuery.trim()) {
    q = q.or(buildSearchOrClause(searchQuery.trim()));
  }
  const { count } = await q;
  return count ?? 0;
}

export async function getAllLeads(
  limit = 100,
  offset = 0,
  searchQuery?: string
): Promise<Lead[]> {
  const supabase = await createClient();
  const today = await getLatestScoredAt(supabase);

  // Search mode: filter dim_lead by name/email/phone first, then sort locally by hot
  if (searchQuery && searchQuery.trim()) {
    const { data: leads } = await supabase
      .from("dim_lead")
      .select("*")
      .or(buildSearchOrClause(searchQuery.trim()))
      .range(offset, offset + limit - 1);
    if (!leads || leads.length === 0) return [];
    const leadIds = leads.map((l) => l.lead_id);
    const { data: scores } = await supabase
      .from("fact_lead_score")
      .select("*")
      .eq("scored_at", today)
      .in("lead_id", leadIds);
    const scoreMap = new Map((scores ?? []).map((s) => [s.lead_id, s]));
    return leads.map((l) => mergeToLead(l, scoreMap.get(l.lead_id)));
  }

  // Default mode: sort by hot_score DESC server-side via fact_lead_score
  // → fetch ranked scores (paginated), then join leads
  const { data: scores } = await supabase
    .from("fact_lead_score")
    .select("*")
    .eq("scored_at", today)
    .order("hot_score", { ascending: false })
    .order("cold_score", { ascending: false })
    .range(offset, offset + limit - 1);
  if (!scores || scores.length === 0) return [];

  const leadIds = scores.map((s) => s.lead_id);
  const { data: leads } = await supabase
    .from("dim_lead")
    .select("*")
    .in("lead_id", leadIds);
  if (!leads) return [];

  const leadMap = new Map(leads.map((l) => [l.lead_id, l]));
  // Preserve scoring order
  return scores
    .map((s) => {
      const l = leadMap.get(s.lead_id);
      return l ? mergeToLead(l, s) : null;
    })
    .filter((x): x is Lead => x !== null);
}

export async function getLeadById(id: string): Promise<Lead | null> {
  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("dim_lead")
    .select("*")
    .eq("lead_id", id)
    .single();
  if (!lead) return null;

  // Use most recent scored_at (handles cross-day case before cron recomputes)
  const { data: score } = await supabase
    .from("fact_lead_score")
    .select("*")
    .eq("lead_id", id)
    .order("scored_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: touchpoints } = await supabase
    .from("fact_touchpoint")
    .select("*")
    .eq("lead_id", id)
    .order("occurred_at", { ascending: false })
    .limit(50);

  return mergeToLead(lead, score ?? undefined, touchpoints ?? []);
}

export async function getDashboardKPI() {
  const supabase = await createClient();
  const today = await getLatestScoredAt(supabase);

  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = new Date(startOfToday); weekAgo.setDate(weekAgo.getDate() - 7);
  const twoWeekAgo = new Date(startOfToday); twoWeekAgo.setDate(twoWeekAgo.getDate() - 14);
  const monthAgo = new Date(startOfToday); monthAgo.setDate(monthAgo.getDate() - 30);

  async function countEvent(eventType: string, fromDate: Date, toDate?: Date): Promise<number> {
    let q = supabase.from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("event_type", eventType)
      .gte("occurred_at", fromDate.toISOString());
    if (toDate) q = q.lt("occurred_at", toDate.toISOString());
    const { count } = await q;
    return count ?? 0;
  }

  // Hot lead count + delta vs previous scoring date
  const { count: hotCount } = await supabase
    .from("fact_lead_score")
    .select("*", { count: "exact", head: true })
    .eq("scored_at", today)
    .gte("hot_score", 60);

  // Conversions tuần này vs tuần trước
  const convThisWeek = await countEvent("conversion", weekAgo);
  const convLastWeek = await countEvent("conversion", twoWeekAgo, weekAgo);

  // Đã tư vấn tuần này = distinct lead_id có chat/call/meeting trong 7d
  const { data: engaged } = await supabase
    .from("fact_touchpoint")
    .select("lead_id")
    .in("event_type", ["chat", "chat_staff", "call", "meeting"])
    .gte("occurred_at", weekAgo.toISOString());
  const engagedSet = new Set((engaged || []).map((r) => r.lead_id));
  const { data: engagedPrev } = await supabase
    .from("fact_touchpoint")
    .select("lead_id")
    .in("event_type", ["chat", "chat_staff", "call", "meeting"])
    .gte("occurred_at", twoWeekAgo.toISOString())
    .lt("occurred_at", weekAgo.toISOString());
  const engagedPrevSet = new Set((engagedPrev || []).map((r) => r.lead_id));

  // Conversion rate = total conversions / total leads (cumulative — stable metric)
  const { count: totalConv } = await supabase
    .from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("event_type", "conversion");
  const { count: totalLeads } = await supabase
    .from("dim_lead")
    .select("*", { count: "exact", head: true });
  const conversionRate = totalLeads ? ((totalConv ?? 0) / totalLeads * 100) : 0;

  // Delta calc helpers
  function pctDelta(curr: number, prev: number): { pct: number; positive: boolean } {
    if (prev === 0) return { pct: curr > 0 ? 100 : 0, positive: curr >= 0 };
    const diff = ((curr - prev) / prev) * 100;
    return { pct: Math.abs(diff), positive: diff >= 0 };
  }

  const convDelta = pctDelta(convThisWeek, convLastWeek);
  const engagedDelta = pctDelta(engagedSet.size, engagedPrevSet.size);

  return {
    hotToday: {
      value: hotCount ?? 0,
      deltaPct: 0,
      deltaPositive: true,
    },
    conversionsWeek: {
      value: convThisWeek,
      deltaPct: convDelta.pct,
      deltaPositive: convDelta.positive,
    },
    consultedWeek: {
      value: engagedSet.size,
      deltaPct: engagedDelta.pct,
      deltaPositive: engagedDelta.positive,
    },
    conversionRate: {
      value: Number(conversionRate.toFixed(2)),
      deltaPct: 0,
      deltaPositive: true,
    },
    // Extra for richer dashboard
    extras: {
      convMonth: await countEvent("conversion", monthAgo),
      totalConv: totalConv ?? 0,
      totalLeads: totalLeads ?? 0,
    },
  };
}

/**
 * KPI row data with date range filter
 */
export async function getKpisInRange(from: Date, to: Date) {
  const supabase = await createClient();

  async function countEvent(eventType: string, fromDate: Date, toDate: Date): Promise<number> {
    const { count } = await supabase
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("event_type", eventType)
      .gte("occurred_at", fromDate.toISOString())
      .lt("occurred_at", toDate.toISOString());
    return count ?? 0;
  }

  const rangeMs = to.getTime() - from.getTime();
  const prevTo = from;
  const prevFrom = new Date(from.getTime() - rangeMs);

  // Parallel only short queries (count head:true is cheap)
  const [conv, convPrev, newLeads, newLeadsPrev, emailsSent, emailsSentPrev, emailOpens, chatsReceived, chatsReceivedPrev, tvvReplies] = await Promise.all([
    countEvent("conversion", from, to),
    countEvent("conversion", prevFrom, prevTo),
    countEvent("lead_created", from, to),
    countEvent("lead_created", prevFrom, prevTo),
    countEvent("email_sent", from, to),
    countEvent("email_sent", prevFrom, prevTo),
    countEvent("email_open", from, to),
    countEvent("chat", from, to),
    countEvent("chat", prevFrom, prevTo),
    countEvent("chat_staff", from, to),
  ]);

  // Engaged leads — distinct lead_id with engagement. Use COUNT(DISTINCT) via
  // separate paginated query (capped at 5k to avoid memory blowup)
  async function countDistinctEngagedLeads(fromD: Date, toD: Date): Promise<number> {
    const seen = new Set<string>();
    let row = 0;
    while (row < 5000) {
      const { data } = await supabase
        .from("fact_touchpoint")
        .select("lead_id")
        .in("event_type", ["chat", "chat_staff", "call", "meeting"])
        .gte("occurred_at", fromD.toISOString())
        .lt("occurred_at", toD.toISOString())
        .range(row, row + 999);
      if (!data || data.length === 0) break;
      for (const r of data) seen.add(r.lead_id);
      if (data.length < 1000) break;
      row += 1000;
    }
    return seen.size;
  }
  const engagedSetSize = await countDistinctEngagedLeads(from, to);
  const engagedPrevSetSize = await countDistinctEngagedLeads(prevFrom, prevTo);

  function pctDelta(curr: number, prev: number) {
    if (prev === 0) return { pct: curr > 0 ? 100 : 0, positive: curr >= 0 };
    const diff = ((curr - prev) / prev) * 100;
    return { pct: Math.abs(Number(diff.toFixed(1))), positive: diff >= 0 };
  }

  return {
    conversions: { value: conv, ...pctDelta(conv, convPrev) },
    newLeads: { value: newLeads, ...pctDelta(newLeads, newLeadsPrev) },
    emailsSent: { value: emailsSent, ...pctDelta(emailsSent, emailsSentPrev) },
    emailOpens: { value: emailOpens, ...pctDelta(emailOpens, 0) },
    openRate: {
      value: emailsSent ? Number((emailOpens / emailsSent * 100).toFixed(1)) : 0,
      pct: 0,
      positive: true,
    },
    chatsReceived: { value: chatsReceived, ...pctDelta(chatsReceived, chatsReceivedPrev) },
    tvvReplies: { value: tvvReplies, ...pctDelta(tvvReplies, 0) },
    responseRate: {
      value: chatsReceived ? Number((tvvReplies / chatsReceived * 100).toFixed(1)) : 0,
      pct: 0,
      positive: true,
    },
    engagedLeads: { value: engagedSetSize, ...pctDelta(engagedSetSize, engagedPrevSetSize) },
    conversionRate: {
      value: newLeads ? Number((conv / newLeads * 100).toFixed(2)) : 0,
      pct: 0,
      positive: true,
    },
  };
}

/**
 * Daily activity series for the range — using per-day count queries (fast)
 * instead of pulling all rows. For 30 days = 30 small queries in parallel.
 */
export async function getDailyActivity(from: Date, to: Date) {
  const supabase = await createClient();
  const days: { iso: string; start: Date; end: Date }[] = [];
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  while (d <= to) {
    const end = new Date(d);
    end.setDate(end.getDate() + 1);
    days.push({ iso: d.toISOString().slice(0, 10), start: new Date(d), end });
    d.setDate(d.getDate() + 1);
  }
  // Cap to 90 days to keep dashboard fast
  if (days.length > 90) days.splice(0, days.length - 90);

  const results = await Promise.all(
    days.map(async (day) => {
      const [chatCnt, emailCnt, convCnt] = await Promise.all([
        supabase.from("fact_touchpoint").select("*", { count: "exact", head: true })
          .in("event_type", ["chat", "chat_staff"])
          .gte("occurred_at", day.start.toISOString())
          .lt("occurred_at", day.end.toISOString()),
        supabase.from("fact_touchpoint").select("*", { count: "exact", head: true })
          .in("event_type", ["email_sent", "email_open", "email_click", "email_reply"])
          .gte("occurred_at", day.start.toISOString())
          .lt("occurred_at", day.end.toISOString()),
        supabase.from("fact_touchpoint").select("*", { count: "exact", head: true })
          .eq("event_type", "conversion")
          .gte("occurred_at", day.start.toISOString())
          .lt("occurred_at", day.end.toISOString()),
      ]);
      return {
        day: day.iso.slice(5),
        chat: chatCnt.count ?? 0,
        email: emailCnt.count ?? 0,
        conversion: convCnt.count ?? 0,
        other: 0,
      };
    })
  );
  return results;
}

/**
 * Conversion by source (for marketing dashboard)
 * Use conversion_count column on dim_lead (already aggregated) — single fast query per source.
 */
export const getConversionBySource = unstable_cache(
  async () => _getConversionBySourceImpl(),
  ["conversion-by-source"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["analytics"] }
);

async function _getConversionBySourceImpl() {
  const supabase = getAnalyticsClient();
  const sources = ["salesforce", "smax", "instantly", "web"];
  const colorMap: Record<string, string> = {
    salesforce: "#00a1e0", smax: "#7c3aed", instantly: "#f59e0b", web: "#10b981",
  };

  // For each source, count total leads + leads with conversion_count > 0 — in parallel
  const results = await Promise.all(
    sources.map(async (src) => {
      const [{ count: totalCount }, { count: convertedCount }] = await Promise.all([
        supabase.from("dim_lead").select("*", { count: "exact", head: true }).eq("source", src),
        supabase.from("dim_lead").select("*", { count: "exact", head: true }).eq("source", src).gt("conversion_count", 0),
      ]);
      return {
        source: src,
        converted: convertedCount ?? 0,
        total: totalCount ?? 0,
        rate: totalCount ? Number(((convertedCount ?? 0) / totalCount * 100).toFixed(2)) : 0,
        color: colorMap[src],
      };
    })
  );
  return results;
}

/**
 * Conversion funnel: total leads → engaged → emailed → opened → converted
 */
export const getConversionFunnel = unstable_cache(
  async () => _getConversionFunnelImpl(),
  ["conversion-funnel"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["analytics"] }
);

async function _getConversionFunnelImpl() {
  const supabase = getAnalyticsClient();

  const { count: totalLeads } = await supabase
    .from("dim_lead")
    .select("*", { count: "exact", head: true });

  // Engaged = total_touchpoints > 1
  const { count: engagedLeads } = await supabase
    .from("dim_lead")
    .select("*", { count: "exact", head: true })
    .gt("total_touchpoints", 1);

  // Emailed = email_received_count > 0
  const { count: emailedLeads } = await supabase
    .from("dim_lead")
    .select("*", { count: "exact", head: true })
    .gt("email_received_count", 0);

  // Chatted = chat_count > 0
  const { count: chattedLeads } = await supabase
    .from("dim_lead")
    .select("*", { count: "exact", head: true })
    .gt("chat_count", 0);

  // Converted
  const { count: convertedLeads } = await supabase
    .from("dim_lead")
    .select("*", { count: "exact", head: true })
    .gt("conversion_count", 0);

  return [
    { stage: "1. Tổng lead", count: totalLeads ?? 0, color: "#a1a1aa" },
    { stage: "2. Đã engage (>1 tp)", count: engagedLeads ?? 0, color: "#5ac8fa" },
    { stage: "3. Đã nhận email", count: emailedLeads ?? 0, color: "#f59e0b" },
    { stage: "4. Đã chat", count: chattedLeads ?? 0, color: "#ff9500" },
    { stage: "5. Đã chốt 🎓", count: convertedLeads ?? 0, color: "#22c55e" },
  ];
}

/**
 * Top campaigns by email volume + conversion correlation
 */
export async function getTopCampaigns(limit = 10) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("fact_touchpoint")
    .select("title, payload, lead_id, event_type")
    .eq("source", "instantly")
    .in("event_type", ["email_sent"])
    .range(0, 9999);
  if (!data) return [];

  const campaignMap = new Map<string, { sent: number; leads: Set<string> }>();
  for (const t of data) {
    const subj = (t.title || "").replace(/^Đã gửi email: /, "").slice(0, 80);
    if (!subj) continue;
    if (!campaignMap.has(subj)) campaignMap.set(subj, { sent: 0, leads: new Set() });
    const c = campaignMap.get(subj)!;
    c.sent++;
    c.leads.add(t.lead_id);
  }

  return [...campaignMap.entries()]
    .map(([subject, c]) => ({ subject, sent: c.sent, uniqueLeads: c.leads.size }))
    .sort((a, b) => b.sent - a.sent)
    .slice(0, limit);
}

/**
 * TVV (assignee) performance
 */
export const getTvvPerformance = unstable_cache(
  async () => _getTvvPerformanceImpl(),
  ["tvv-performance"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["analytics"] }
);

async function _getTvvPerformanceImpl() {
  const supabase = getAnalyticsClient();
  // Top assignees by lead count + their conversion count
  const { data: leads } = await supabase
    .from("dim_lead")
    .select("assignee, conversion_count, chat_staff_count, total_touchpoints, stage")
    .not("assignee", "is", null);
  if (!leads) return [];

  const tvvMap = new Map<string, { leadCount: number; converted: number; replies: number; touchpoints: number }>();
  for (const l of leads) {
    const name = (l.assignee || "—").trim();
    if (!tvvMap.has(name)) tvvMap.set(name, { leadCount: 0, converted: 0, replies: 0, touchpoints: 0 });
    const m = tvvMap.get(name)!;
    m.leadCount++;
    if ((l.conversion_count ?? 0) > 0) m.converted++;
    m.replies += l.chat_staff_count ?? 0;
    m.touchpoints += l.total_touchpoints ?? 0;
  }

  return [...tvvMap.entries()]
    .map(([name, m]) => ({
      name,
      leadCount: m.leadCount,
      converted: m.converted,
      replies: m.replies,
      conversionRate: m.leadCount ? Number((m.converted / m.leadCount * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.leadCount - a.leadCount)
    .slice(0, 15);
}

/**
 * Tier distribution for donut chart — 4 parallel head counts.
 */
export const getTierDistribution = unstable_cache(
  async () => _getTierDistributionImpl(),
  ["tier-distribution"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["analytics"] }
);

async function _getTierDistributionImpl() {
  const supabase = getAnalyticsClient();
  const latestDate = await getLatestScoredAt(supabase);
  const tiers = [
    { name: "NÓNG", min: 70, max: 100, color: "#ff3b30" },
    { name: "ẤM", min: 40, max: 69, color: "#ff9500" },
    { name: "MÁT", min: 20, max: 39, color: "#5ac8fa" },
    { name: "NGỦ ĐÔNG", min: 0, max: 19, color: "#3a3a3c" },
  ];
  return Promise.all(
    tiers.map(async (t) => {
      const { count } = await supabase
        .from("fact_lead_score")
        .select("*", { count: "exact", head: true })
        .eq("scored_at", latestDate)
        .gte("hot_score", t.min)
        .lte("hot_score", t.max);
      return { name: t.name, value: count ?? 0, color: t.color };
    })
  );
}

/**
 * Source distribution — touchpoints + leads per source (parallel)
 */
export const getSourceDistribution = unstable_cache(
  async () => _getSourceDistributionImpl(),
  ["source-distribution"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["analytics"] }
);

async function _getSourceDistributionImpl() {
  const supabase = getAnalyticsClient();
  const sources = [
    { id: "salesforce", name: "Salesforce", color: "#00a1e0" },
    { id: "smax", name: "SMAX", color: "#7c3aed" },
    { id: "instantly", name: "Instantly", color: "#f59e0b" },
    { id: "web", name: "Wix Website", color: "#10b981" },
  ];
  return Promise.all(
    sources.map(async (s) => {
      const [{ count: tpCount }, { count: leadCount }] = await Promise.all([
        supabase.from("fact_touchpoint").select("*", { count: "exact", head: true }).eq("source", s.id),
        supabase.from("dim_lead").select("*", { count: "exact", head: true }).eq("source", s.id),
      ]);
      return {
        name: s.name,
        touchpoints: tpCount ?? 0,
        leads: leadCount ?? 0,
        color: s.color,
      };
    })
  );
}

/**
 * Event type distribution — what TVV is doing
 */
export async function getEventTypeDistribution() {
  const supabase = await createClient();
  const types = [
    { id: "chat", label: "Lead chat đến", color: "#3b82f6" },
    { id: "chat_staff", label: "TVV reply chat", color: "#06b6d4" },
    { id: "email_sent", label: "Email gửi đi", color: "#f59e0b" },
    { id: "email_open", label: "Email mở", color: "#84cc16" },
    { id: "email_click", label: "Email click", color: "#10b981" },
    { id: "conversion", label: "Conversion (mua)", color: "#22c55e" },
    { id: "call", label: "Cuộc gọi", color: "#8b5cf6" },
    { id: "lost", label: "Lost / Pause", color: "#ef4444" },
  ];
  const results: { label: string; value: number; color: string }[] = [];
  for (const t of types) {
    const { count } = await supabase
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("event_type", t.id);
    if ((count ?? 0) > 0) {
      results.push({ label: t.label, value: count ?? 0, color: t.color });
    }
  }
  return results.sort((a, b) => b.value - a.value);
}

/**
 * Conversions over last 12 weeks (line chart)
 */
export async function getConversionTrend() {
  const supabase = await createClient();
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setDate(start.getDate() - 84); // 12 weeks

  const result: { week: string; conversions: number; new_leads: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const weekStart = new Date(today); weekStart.setDate(weekStart.getDate() - (i + 1) * 7);
    const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() - i * 7);
    const { count: convCount } = await supabase
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("event_type", "conversion")
      .gte("occurred_at", weekStart.toISOString())
      .lt("occurred_at", weekEnd.toISOString());
    const { count: leadCount } = await supabase
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("event_type", "lead_created")
      .gte("occurred_at", weekStart.toISOString())
      .lt("occurred_at", weekEnd.toISOString());
    result.push({
      week: `${weekStart.getDate()}/${weekStart.getMonth() + 1}`,
      conversions: convCount ?? 0,
      new_leads: leadCount ?? 0,
    });
    // Suppress unused warning
    void start;
  }
  return result;
}

export async function getRecentActivities(limit = 8) {
  const supabase = await createClient();
  const { data: touchpoints } = await supabase
    .from("fact_touchpoint")
    .select("id, source, event_type, title, occurred_at, lead_id")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (!touchpoints || touchpoints.length === 0) return [];

  const leadIds = [...new Set(touchpoints.map((t) => t.lead_id))];
  const { data: leads } = await supabase
    .from("dim_lead")
    .select("lead_id, full_name, avatar_color")
    .in("lead_id", leadIds);
  const leadMap = new Map((leads ?? []).map((l) => [l.lead_id, l]));

  return touchpoints.map((t) => {
    const lead = leadMap.get(t.lead_id);
    return {
      id: t.id,
      lead: lead?.full_name ?? "Unknown",
      avatarColor: lead?.avatar_color ?? "#f5f5f7",
      action: shortenAction(t.title, t.event_type),
      source: t.source,
      at: new Date(t.occurred_at),
    };
  });
}

function shortenAction(title: string, eventType: string): string {
  const max = 50;
  if (title.length <= max) return title;
  return title.slice(0, max) + "...";
}

export async function getSyncJobs(limit = 20) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sync_job")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((j) => ({
    id: j.id,
    source: j.source,
    startedAt: new Date(j.started_at),
    durationMs: j.finished_at
      ? new Date(j.finished_at).getTime() - new Date(j.started_at).getTime()
      : undefined,
    status: j.status,
    recordsIn: j.records_in,
    recordsMerged: j.records_merged,
    errors: j.error_message ? [j.error_message] : undefined,
  }));
}

export async function getIntegrationsStatus() {
  const supabase = await createClient();

  const SOURCES = [
    { id: "salesforce", name: "Salesforce",     category: "CRM",     description: "Sales Cloud + Service Cloud — deal, contact, hoạt động tư vấn.", authType: "OAuth 2.0" },
    { id: "smax",       name: "SMAX",           category: "Chat",    description: "Chat trên fanpage, bot, auto-message.",                          authType: "API Key" },
    { id: "instantly",  name: "Instantly",      category: "Email",   description: "Email outreach + tracking open/click.",                         authType: "API Key" },
    { id: "web",        name: "Wix Website",    category: "Web",     description: "Contacts CRM + Members + Form submissions từ mastering-da.com.",  authType: "API Key" },
    { id: "lark",       name: "Lark Bot",       category: "Webhook", description: "Gửi cảnh báo urgent đến TVV phụ trách qua DM/group.",            authType: "Webhook URL" },
    { id: "fanpage",    name: "Facebook Fanpage", category: "Social", description: "MasteringDataAnalytics + PhuongThaoAnalytics — đo lead nguồn.", authType: "OAuth 2.0" },
  ];

  const { data: jobs } = await supabase
    .from("sync_job")
    .select("source, status, started_at, finished_at, error_message")
    .order("started_at", { ascending: false });

  // Count leads per source via head:true (exact count, bypass 1000 default limit)
  const countBySource: Record<string, number> = {};
  await Promise.all(
    SOURCES.map(async (s) => {
      const { count } = await supabase
        .from("dim_lead")
        .select("*", { count: "exact", head: true })
        .eq("source", s.id);
      countBySource[s.id] = count ?? 0;
    })
  );

  // Also count touchpoints per source (more accurate signal of activity)
  const touchpointsBySource: Record<string, number> = {};
  await Promise.all(
    SOURCES.map(async (s) => {
      const { count } = await supabase
        .from("fact_touchpoint")
        .select("*", { count: "exact", head: true })
        .eq("source", s.id);
      touchpointsBySource[s.id] = count ?? 0;
    })
  );

  const latestBySrc = new Map<string, { status: string; started_at: string; error_message: string | null }>();
  for (const j of jobs ?? []) {
    if (!latestBySrc.has(j.source)) {
      latestBySrc.set(j.source, { status: j.status, started_at: j.started_at, error_message: j.error_message });
    }
  }

  return SOURCES.map((s) => {
    const latest = latestBySrc.get(s.id);
    let status: "connected" | "error" | "disconnected" | "pending";
    if (!latest && (countBySource[s.id] ?? 0) === 0) {
      status = "disconnected";
    } else if (latest?.status === "failed") {
      status = "error";
    } else if (latest?.status === "running") {
      status = "pending";
    } else {
      status = "connected";
    }
    return {
      ...s,
      status,
      lastSyncAt: latest ? new Date(latest.started_at) : undefined,
      recordCount: countBySource[s.id] ?? 0,
      touchpointCount: touchpointsBySource[s.id] ?? 0,
      errorMessage: latest?.error_message ?? undefined,
    };
  });
}

export async function getTeamMembers() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.full_name ?? p.email,
    email: p.email,
    role: (p.role ?? "tvv").toString().charAt(0).toUpperCase() + (p.role ?? "tvv").toString().slice(1),
    avatarColor: p.avatar_color ?? "#E0E7FF",
    leadCount: 0,
    active: p.active ?? true,
  }));
}

export async function getAuditLog(limit = 50) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_audit")
    .select("*, lead:dim_lead!lead_id(full_name)")
    .order("generated_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((a) => ({
    id: a.id,
    templateName: a.template_name,
    leadName: a.lead?.full_name ?? "Unknown",
    generatedAt: new Date(a.generated_at),
    approvedBy: a.approver_id ?? undefined,
    approvedAt: a.approved_at ? new Date(a.approved_at) : undefined,
    status: a.status,
    preview: a.preview ?? "",
  }));
}

export async function getAlertEvents(limit = 20) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lark_alert")
    .select("*, lead:dim_lead!lead_id(full_name)")
    .order("sent_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((e) => ({
    id: e.id,
    ruleName: e.rule_name,
    leadName: e.lead?.full_name ?? "Unknown",
    reason: e.reason ?? "",
    sentAt: new Date(e.sent_at),
    delivered: e.delivered,
  }));
}

export async function getLeadsBySource() {
  const supabase = await createClient();
  const { data } = await supabase.from("dim_lead").select("source");
  const counts: Record<string, number> = {};
  for (const l of data ?? []) {
    counts[l.source] = (counts[l.source] ?? 0) + 1;
  }
  return counts;
}

export async function getIdentityStats() {
  const supabase = await createClient();
  const { count: total } = await supabase
    .from("dim_lead")
    .select("*", { count: "exact", head: true });
  const { count: withEmail } = await supabase
    .from("dim_lead")
    .select("*", { count: "exact", head: true })
    .not("email", "is", null);
  const { count: withPhone } = await supabase
    .from("dim_lead")
    .select("*", { count: "exact", head: true })
    .not("phone", "is", null);
  const { count: withBoth } = await supabase
    .from("dim_lead")
    .select("*", { count: "exact", head: true })
    .not("email", "is", null)
    .not("phone", "is", null);
  return {
    total: total ?? 0,
    withEmail: withEmail ?? 0,
    withPhone: withPhone ?? 0,
    withBoth: withBoth ?? 0,
    unmergedCount: (total ?? 0) - (withBoth ?? 0),
  };
}

/**
 * Stage distribution — count leads by SF stage (funnel view)
 */
/**
 * List of distinct stages that exist in dim_lead (for filter dropdowns).
 * Only returns stages with at least 1 lead.
 */
export async function getAvailableStages(): Promise<{ value: string; label: string; count: number }[]> {
  const supabase = await createClient();
  const KNOWN = [
    { value: "Mới",            label: "Mới" },
    { value: "Đang tư vấn",    label: "Đang tư vấn" },
    { value: "Đang cân nhắc",  label: "Đang cân nhắc" },
    { value: "Im lặng",        label: "Im lặng" },
    { value: "Đã chốt",        label: "Đã chốt" },
  ];
  const counts = await Promise.all(
    KNOWN.map(async (s) => {
      const { count } = await supabase
        .from("dim_lead")
        .select("*", { count: "exact", head: true })
        .eq("stage", s.value);
      return { ...s, count: count ?? 0 };
    })
  );
  return counts.filter((s) => s.count > 0);
}

export const getStageDistribution = unstable_cache(
  async () => _getStageDistributionImpl(),
  ["stage-distribution"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["analytics"] }
);

async function _getStageDistributionImpl() {
  const supabase = getAnalyticsClient();
  const stages = [
    { id: "Mới",           label: "Mới",           color: "#a1a1aa" },
    { id: "Đang tư vấn",    label: "Đang tư vấn",    color: "#5ac8fa" },
    { id: "Đang cân nhắc",  label: "Đang cân nhắc",  color: "#ff9500" },
    { id: "Im lặng",        label: "Im lặng",        color: "#71717a" },
    { id: "Đã chốt",        label: "Đã chốt",        color: "#22c55e" },
  ];
  return Promise.all(
    stages.map(async (s) => {
      const { count } = await supabase
        .from("dim_lead")
        .select("*", { count: "exact", head: true })
        .eq("stage", s.id);
      return { stage: s.label, count: count ?? 0, color: s.color };
    })
  );
}

/**
 * Source × tier matrix — for segmentation page
 * Strategy: parallel-paginate both tables, merge in JS. Two tables = O(N/1000) queries each.
 */
export const getSourceTierMatrix = unstable_cache(
  async () => _getSourceTierMatrixImpl(),
  ["source-tier-matrix"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["analytics"] }
);

async function _getSourceTierMatrixImpl() {
  const supabase = getAnalyticsClient();
  const latestDate = await getLatestScoredAt(supabase);
  const sources = ["salesforce", "smax", "instantly", "web"];
  const tiers: { name: LeadTier; min: number; max: number }[] = [
    { name: "NÓNG", min: 70, max: 100 },
    { name: "ẤM", min: 40, max: 69 },
    { name: "MÁT", min: 20, max: 39 },
    { name: "NGỦ ĐÔNG", min: 0, max: 19 },
  ];

  // Get total count first to know how many pages
  const [{ count: leadCount }, { count: scoreCount }] = await Promise.all([
    supabase.from("dim_lead").select("*", { count: "exact", head: true }),
    supabase.from("fact_lead_score").select("*", { count: "exact", head: true }).eq("scored_at", latestDate),
  ]);

  const PAGE = 1000;
  const leadPages = Math.ceil((leadCount ?? 0) / PAGE);
  const scorePages = Math.ceil((scoreCount ?? 0) / PAGE);

  // Parallel fetch all pages
  const [leadPagesData, scorePagesData] = await Promise.all([
    Promise.all(
      Array.from({ length: leadPages }, (_, i) =>
        supabase
          .from("dim_lead")
          .select("lead_id, source")
          .range(i * PAGE, i * PAGE + PAGE - 1)
      )
    ),
    Promise.all(
      Array.from({ length: scorePages }, (_, i) =>
        supabase
          .from("fact_lead_score")
          .select("lead_id, hot_score")
          .eq("scored_at", latestDate)
          .range(i * PAGE, i * PAGE + PAGE - 1)
      )
    ),
  ]);

  const sourceByLead = new Map<string, string>();
  for (const p of leadPagesData) {
    for (const l of p.data ?? []) sourceByLead.set(l.lead_id, l.source);
  }

  const matrix: Record<string, Record<string, number>> = {};
  for (const s of sources) {
    matrix[s] = {};
    for (const t of tiers) matrix[s][t.name] = 0;
  }
  for (const p of scorePagesData) {
    for (const s of p.data ?? []) {
      const src = sourceByLead.get(s.lead_id);
      if (!src || !matrix[src]) continue;
      const tier = tiers.find((t) => s.hot_score >= t.min && s.hot_score <= t.max);
      if (tier) matrix[src][tier.name]++;
    }
  }

  return { sources, tiers: tiers.map((t) => t.name), matrix };
}

/**
 * Cohort by first_seen_at month — last 12 months only.
 * Limits to ~12 months of data + parallel pagination.
 */
export const getCohortByMonth = unstable_cache(
  async () => _getCohortByMonthImpl(),
  ["cohort-by-month"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["analytics"] }
);

async function _getCohortByMonthImpl() {
  const supabase = getAnalyticsClient();
  // Only pull last 13 months of leads (one extra for partial-month edge)
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 13);
  const cutoffIso = cutoff.toISOString();

  // Get total in range
  const { count: total } = await supabase
    .from("dim_lead")
    .select("*", { count: "exact", head: true })
    .gte("first_seen_at", cutoffIso);

  const PAGE = 1000;
  const pages = Math.ceil((total ?? 0) / PAGE);

  const pageResults = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      supabase
        .from("dim_lead")
        .select("first_seen_at, total_touchpoints, conversion_count")
        .gte("first_seen_at", cutoffIso)
        .order("first_seen_at", { ascending: true })
        .range(i * PAGE, i * PAGE + PAGE - 1)
    )
  );

  const cohortMap = new Map<string, { total: number; engaged: number; converted: number }>();
  for (const p of pageResults) {
    for (const l of p.data ?? []) {
      if (!l.first_seen_at) continue;
      const month = l.first_seen_at.slice(0, 7);
      if (!cohortMap.has(month)) {
        cohortMap.set(month, { total: 0, engaged: 0, converted: 0 });
      }
      const c = cohortMap.get(month)!;
      c.total++;
      if ((l.total_touchpoints ?? 0) > 1) c.engaged++;
      if ((l.conversion_count ?? 0) > 0) c.converted++;
    }
  }

  return [...cohortMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, c]) => ({
      month,
      total: c.total,
      engaged: c.engaged,
      converted: c.converted,
      engagementRate: c.total ? Number((c.engaged / c.total * 100).toFixed(1)) : 0,
      conversionRate: c.total ? Number((c.converted / c.total * 100).toFixed(2)) : 0,
    }));
}

/**
 * SMAX channel breakdown by page_pid → human-readable platform
 * Uses N parallel head:true counts (1 per known page_pid) instead of pulling all rows.
 * Lookup of `uniqueLeads` is skipped — too expensive without a DB function.
 */
export const getSmaxChannelBreakdown = unstable_cache(
  async () => _getSmaxChannelBreakdownImpl(),
  ["smax-channel-breakdown"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["analytics"] }
);

async function _getSmaxChannelBreakdownImpl() {
  const supabase = getAnalyticsClient();
  const CHANNELS = [
    { pid: "fb102323788540150",     label: "Facebook Brand",      color: "#1877f2" },
    { pid: "fb107203051058856",     label: "Facebook KOL",        color: "#0084ff" },
    { pid: "zlw543187459113764384", label: "Zalo Main",           color: "#0068ff" },
    { pid: "zl2235256473219383054", label: "Zalo Other",          color: "#0095f6" },
    { pid: "ctm68188e11779d16c0779c018c", label: "Website Live Chat", color: "#22c55e" },
    { pid: "ig17841446528067260",   label: "Instagram Brand",     color: "#E1306C" },
    { pid: "ig17841460097450702",   label: "Instagram KOL",       color: "#06b6d4" },
  ];

  const counts = await Promise.all(
    CHANNELS.map(async (c) => {
      const { count } = await supabase
        .from("fact_touchpoint")
        .select("*", { count: "exact", head: true })
        .eq("source", "smax")
        .eq("payload->>page_pid", c.pid);
      return { ...c, touchpoints: count ?? 0 };
    })
  );

  return counts
    .filter((c) => c.touchpoints > 0)
    .sort((a, b) => b.touchpoints - a.touchpoints)
    .map((c) => ({
      label: c.label,
      touchpoints: c.touchpoints,
      uniqueLeads: 0, // skipped — would require pulling rows or DB function
      color: c.color,
    }));
}

/**
 * Outlier segments — find combos (source × engagement bucket × stage) that
 * convert at >= LIFT_THRESHOLD × baseline. These are "high-value patterns"
 * to mine for lookalike audiences (spec ref 5.3).
 *
 * Strategy: Pull aggregate counts grouped by (source, engagement_bucket)
 * from dim_lead, compute conversion rate per cell, compare to baseline.
 */
type OutlierSegmentsResult = {
  baseline_conversion_rate_pct: number;
  total_leads: number;
  total_students: number;
  segments: Array<{
    source: string;
    engagement_label: string;
    engagement_min: number;
    engagement_max: number | null;
    leads: number;
    students: number;
    conversion_rate_pct: number;
    lift: number;
  }>;
};

export const getOutlierSegments = unstable_cache(
  async (): Promise<OutlierSegmentsResult> => _getOutlierSegmentsImpl(),
  ["outlier-segments"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["analytics"] }
);

async function _getOutlierSegmentsImpl(): Promise<OutlierSegmentsResult> {
  const supabase = getAnalyticsClient();

  // 1) Baseline counts
  const { count: totalLeads } = await supabase
    .from("dim_lead")
    .select("*", { count: "exact", head: true });
  const { count: totalStudents } = await supabase
    .from("dim_lead")
    .select("*", { count: "exact", head: true })
    .gt("conversion_count", 0);

  const baseline = totalLeads ? (totalStudents ?? 0) / totalLeads : 0;
  const baselinePct = baseline * 100;

  const sources = ["salesforce", "smax", "instantly", "web"];
  const buckets = [
    { label: "Lurker (1 touch)",       min: 0,  max: 1 },
    { label: "Low (2-4 touches)",      min: 2,  max: 4 },
    { label: "Active (5-14 touches)",  min: 5,  max: 14 },
    { label: "Power (≥15 touches)",    min: 15, max: null as number | null },
  ];

  // Build query per (source, bucket) cell — get leads count + students count
  type Cell = {
    source: string;
    engagement_label: string;
    engagement_min: number;
    engagement_max: number | null;
    leads: number;
    students: number;
  };

  const cells = await Promise.all(
    sources.flatMap((src) =>
      buckets.map(async (b): Promise<Cell> => {
        let baseQ = supabase
          .from("dim_lead")
          .select("*", { count: "exact", head: true })
          .eq("source", src)
          .gte("total_touchpoints", b.min);
        if (b.max !== null) baseQ = baseQ.lte("total_touchpoints", b.max);

        let convQ = supabase
          .from("dim_lead")
          .select("*", { count: "exact", head: true })
          .eq("source", src)
          .gte("total_touchpoints", b.min)
          .gt("conversion_count", 0);
        if (b.max !== null) convQ = convQ.lte("total_touchpoints", b.max);

        const [{ count: leads }, { count: students }] = await Promise.all([baseQ, convQ]);
        return {
          source: src,
          engagement_label: b.label,
          engagement_min: b.min,
          engagement_max: b.max,
          leads: leads ?? 0,
          students: students ?? 0,
        };
      })
    )
  );

  // Compute conversion rate + lift per cell
  // Lift = (cell_conv_rate / baseline_conv_rate); >1 means outperforms baseline
  const segments = cells
    .filter((c) => c.leads >= 5) // need minimum sample
    .map((c) => {
      const rate = c.leads > 0 ? c.students / c.leads : 0;
      const lift = baseline > 0 ? rate / baseline : 0;
      return {
        ...c,
        conversion_rate_pct: Number((rate * 100).toFixed(2)),
        lift: Number(lift.toFixed(2)),
      };
    })
    .sort((a, b) => b.lift - a.lift);

  return {
    baseline_conversion_rate_pct: Number(baselinePct.toFixed(2)),
    total_leads: totalLeads ?? 0,
    total_students: totalStudents ?? 0,
    segments,
  };
}

/**
 * Cohort by month × source — for funnel page enrichment
 */
type CohortBySourceMonthResult = {
  sources: string[];
  months: string[];
  matrix: Record<string, Record<string, { total: number; converted: number; conv_rate_pct: number }>>;
};

export const getCohortBySourceMonth = unstable_cache(
  async (): Promise<CohortBySourceMonthResult> => _getCohortBySourceMonthImpl(),
  ["cohort-by-source-month"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["analytics"] }
);

async function _getCohortBySourceMonthImpl(): Promise<CohortBySourceMonthResult> {
  const supabase = getAnalyticsClient();
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 13);

  // Fetch all leads with first_seen_at + source + conversion_count
  const { count: total } = await supabase
    .from("dim_lead")
    .select("*", { count: "exact", head: true })
    .gte("first_seen_at", cutoff.toISOString());
  const PAGE = 1000;
  const pages = Math.ceil((total ?? 0) / PAGE);

  const pageResults = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      supabase
        .from("dim_lead")
        .select("first_seen_at, source, conversion_count")
        .gte("first_seen_at", cutoff.toISOString())
        .range(i * PAGE, i * PAGE + PAGE - 1)
    )
  );

  const sources = ["salesforce", "smax", "instantly", "web"];
  const matrix: Record<string, Record<string, { total: number; converted: number; conv_rate_pct: number }>> = {};

  for (const p of pageResults) {
    for (const l of p.data ?? []) {
      if (!l.first_seen_at) continue;
      const month = l.first_seen_at.slice(0, 7);
      const src = sources.includes(l.source) ? l.source : "other";
      if (!matrix[src]) matrix[src] = {};
      if (!matrix[src][month]) matrix[src][month] = { total: 0, converted: 0, conv_rate_pct: 0 };
      matrix[src][month].total++;
      if ((l.conversion_count ?? 0) > 0) matrix[src][month].converted++;
    }
  }

  // Compute conversion rates + collect month list
  const monthSet = new Set<string>();
  for (const src of Object.keys(matrix)) {
    for (const month of Object.keys(matrix[src])) {
      monthSet.add(month);
      const cell = matrix[src][month];
      cell.conv_rate_pct = cell.total > 0 ? Number(((cell.converted / cell.total) * 100).toFixed(2)) : 0;
    }
  }
  const months = [...monthSet].sort().slice(-12);

  return { sources, months, matrix };
}

/**
 * Engagement segments — 4 parallel bucket counts.
 */
export const getEngagementSegments = unstable_cache(
  async () => _getEngagementSegmentsImpl(),
  ["engagement-segments"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["analytics"] }
);

async function _getEngagementSegmentsImpl() {
  const supabase = getAnalyticsClient();
  const [lurkers, low, mid, high] = await Promise.all([
    supabase.from("dim_lead").select("*", { count: "exact", head: true }).lte("total_touchpoints", 1),
    supabase.from("dim_lead").select("*", { count: "exact", head: true }).gte("total_touchpoints", 2).lte("total_touchpoints", 4),
    supabase.from("dim_lead").select("*", { count: "exact", head: true }).gte("total_touchpoints", 5).lte("total_touchpoints", 14),
    supabase.from("dim_lead").select("*", { count: "exact", head: true }).gte("total_touchpoints", 15),
  ]);
  return [
    { label: "Lurker (≤1 touch)",      count: lurkers.count ?? 0, color: "#a1a1aa" },
    { label: "Low (2-4 touches)",      count: low.count ?? 0,     color: "#5ac8fa" },
    { label: "Active (5-14 touches)",  count: mid.count ?? 0,     color: "#ff9500" },
    { label: "Power (≥15 touches)",    count: high.count ?? 0,    color: "#ff3b30" },
  ];
}

/**
 * Top lead_source values (specific campaign/UTM)
 * Parallel pagination over leads with non-null lead_source.
 */
export const getTopLeadSources = unstable_cache(
  async (limit = 12) => _getTopLeadSourcesImpl(limit),
  ["top-lead-sources"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["analytics"] }
);

async function _getTopLeadSourcesImpl(limit = 12) {
  const supabase = getAnalyticsClient();
  const { count: total } = await supabase
    .from("dim_lead")
    .select("*", { count: "exact", head: true })
    .not("lead_source", "is", null);
  const PAGE = 1000;
  const pages = Math.ceil((total ?? 0) / PAGE);

  const pageResults = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      supabase
        .from("dim_lead")
        .select("lead_source")
        .not("lead_source", "is", null)
        .range(i * PAGE, i * PAGE + PAGE - 1)
    )
  );

  const counts = new Map<string, number>();
  for (const p of pageResults) {
    for (const l of p.data ?? []) {
      const src = (l.lead_source || "—").trim();
      if (!src) continue;
      counts.set(src, (counts.get(src) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

/**
 * Stale leads — dormant >30 days, useful for AI Planner recommendation
 */
export const getStaleLeadsCount = unstable_cache(
  async (days = 30) => _getStaleLeadsCountImpl(days),
  ["stale-leads-count"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["analytics"] }
);

async function _getStaleLeadsCountImpl(days = 30) {
  const supabase = getAnalyticsClient();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const { count } = await supabase
    .from("dim_lead")
    .select("*", { count: "exact", head: true })
    .lt("last_engagement_at", cutoff.toISOString());
  return count ?? 0;
}

export async function getScoringRules() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("scoring_rule")
    .select("*")
    .order("variant")
    .order("weight", { ascending: false });
  return (data ?? []).map((r) => ({
    id: r.id as string,
    variant: r.variant as "hot" | "cold",
    signal: r.signal as string,
    signalLabel: r.signal_label as string,
    operator: r.operator as ">" | ">=" | "<" | "<=" | "=",
    threshold: Number(r.threshold),
    weight: r.weight as number,
    window: r.time_window as "24h" | "7d" | "30d",
    enabled: r.enabled as boolean,
  }));
}
