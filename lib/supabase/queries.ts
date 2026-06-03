import { createClient } from "./server";
import type { Lead, LeadTier, ScoreReason, Touchpoint } from "@/types/lead";
import { scoreToTier } from "@/types/lead";

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
  last_touch_at: string;
  first_seen_at: string;
  company?: string | null;
  assignee?: string | null;
  lead_source?: string | null;
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
    lastContactAt: new Date(row.last_touch_at ?? row.first_seen_at),
    firstSeenAt: new Date(row.first_seen_at),
    stage: row.stage as Lead["stage"],
    assignee: row.assignee || "—",
    company: row.company || null,
    leadSource: row.lead_source || null,
    touchpoints: touchpoints.map<Touchpoint>((t) => ({
      id: t.id,
      source: t.source as Touchpoint["source"],
      type: t.event_type as Touchpoint["type"],
      title: t.title,
      detail: t.detail ?? undefined,
      occurredAt: new Date(t.occurred_at),
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

async function fetchLeadsByScoreRange(
  minScore: number,
  maxScore: number,
  limit: number,
  offset: number,
  scoreAsc = false // for cold/dormant, ascending = "most dormant first"
): Promise<Lead[]> {
  const supabase = await createClient();
  const latestDate = await getLatestScoredAt(supabase);
  let query = supabase
    .from("fact_lead_score")
    .select("*")
    .eq("scored_at", latestDate)
    .gte("hot_score", minScore)
    .lte("hot_score", maxScore);
  query = scoreAsc
    ? query.order("hot_score", { ascending: true })
    : query.order("hot_score", { ascending: false });
  const { data: scores } = await query.range(offset, offset + limit - 1);
  if (!scores || scores.length === 0) return [];

  const leadIds = scores.map((s) => s.lead_id);
  const { data: leads } = await supabase
    .from("dim_lead")
    .select("*")
    .in("lead_id", leadIds);
  if (!leads) return [];

  const leadMap = new Map(leads.map((l) => [l.lead_id, l]));
  return scores
    .map((s) => {
      const lead = leadMap.get(s.lead_id);
      return lead ? mergeToLead(lead, s) : null;
    })
    .filter((x): x is Lead => x !== null);
}

async function countLeadsByScoreRange(min: number, max: number): Promise<number> {
  const supabase = await createClient();
  const latestDate = await getLatestScoredAt(supabase);
  const { count } = await supabase
    .from("fact_lead_score")
    .select("*", { count: "exact", head: true })
    .eq("scored_at", latestDate)
    .gte("hot_score", min)
    .lte("hot_score", max);
  return count ?? 0;
}

export const getHotLeads = (limit = 50, offset = 0) =>
  fetchLeadsByScoreRange(70, 100, limit, offset);
export const getHotLeadsCount = () => countLeadsByScoreRange(70, 100);

export const getWarmLeads = (limit = 100, offset = 0) =>
  fetchLeadsByScoreRange(40, 69, limit, offset);
export const getWarmLeadsCount = () => countLeadsByScoreRange(40, 69);

export const getCoolLeads = (limit = 100, offset = 0) =>
  fetchLeadsByScoreRange(20, 39, limit, offset);
export const getCoolLeadsCount = () => countLeadsByScoreRange(20, 39);

export const getDormantLeads = (limit = 100, offset = 0) =>
  fetchLeadsByScoreRange(0, 19, limit, offset, true); // ascending so 0 first = most dormant
export const getDormantLeadsCount = () => countLeadsByScoreRange(0, 19);

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
    .gte("hot_score", 70);

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

  // Conversions in range vs prev range
  const conv = await countEvent("conversion", from, to);
  const convPrev = await countEvent("conversion", prevFrom, prevTo);

  // New leads
  const newLeads = await countEvent("lead_created", from, to);
  const newLeadsPrev = await countEvent("lead_created", prevFrom, prevTo);

  // Emails sent
  const emailsSent = await countEvent("email_sent", from, to);
  const emailsSentPrev = await countEvent("email_sent", prevFrom, prevTo);

  // Email opens
  const emailOpens = await countEvent("email_open", from, to);

  // Chats received
  const chatsReceived = await countEvent("chat", from, to);
  const chatsReceivedPrev = await countEvent("chat", prevFrom, prevTo);

  // TVV replies
  const tvvReplies = await countEvent("chat_staff", from, to);

  // Distinct engaged leads
  const { data: engaged } = await supabase
    .from("fact_touchpoint")
    .select("lead_id")
    .in("event_type", ["chat", "chat_staff", "call", "meeting"])
    .gte("occurred_at", from.toISOString())
    .lt("occurred_at", to.toISOString());
  const engagedSet = new Set((engaged || []).map((r) => r.lead_id));

  const { data: engagedPrev } = await supabase
    .from("fact_touchpoint")
    .select("lead_id")
    .in("event_type", ["chat", "chat_staff", "call", "meeting"])
    .gte("occurred_at", prevFrom.toISOString())
    .lt("occurred_at", prevTo.toISOString());
  const engagedPrevSet = new Set((engagedPrev || []).map((r) => r.lead_id));

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
    engagedLeads: { value: engagedSet.size, ...pctDelta(engagedSet.size, engagedPrevSet.size) },
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
 */
export async function getConversionBySource() {
  const supabase = await createClient();
  // Get all conversion events with lead_id (paginated)
  const convLeads = new Set<string>();
  let fromRow = 0;
  while (true) {
    const { data } = await supabase
      .from("fact_touchpoint")
      .select("lead_id")
      .eq("event_type", "conversion")
      .range(fromRow, fromRow + 999);
    if (!data || data.length === 0) break;
    for (const t of data) convLeads.add(t.lead_id);
    if (data.length < 1000) break;
    fromRow += 1000;
  }

  // For each source, count leads with conversion vs total leads
  const sources = ["salesforce", "smax", "instantly", "web"];
  const result: { source: string; converted: number; total: number; rate: number; color: string }[] = [];
  const colorMap: Record<string, string> = {
    salesforce: "#00a1e0", smax: "#7c3aed", instantly: "#f59e0b", web: "#10b981",
  };
  for (const src of sources) {
    const { count: totalCount } = await supabase
      .from("dim_lead")
      .select("*", { count: "exact", head: true })
      .eq("source", src);
    // Count leads in this source that have at least one conversion
    let converted = 0;
    if (convLeads.size > 0) {
      const convArr = Array.from(convLeads);
      // Paginate IN clause
      for (let i = 0; i < convArr.length; i += 100) {
        const batch = convArr.slice(i, i + 100);
        const { count } = await supabase
          .from("dim_lead")
          .select("*", { count: "exact", head: true })
          .eq("source", src)
          .in("lead_id", batch);
        converted += count ?? 0;
      }
    }
    result.push({
      source: src,
      converted,
      total: totalCount ?? 0,
      rate: totalCount ? Number((converted / totalCount * 100).toFixed(2)) : 0,
      color: colorMap[src],
    });
  }
  return result;
}

/**
 * Conversion funnel: total leads → engaged → emailed → opened → converted
 */
export async function getConversionFunnel() {
  const supabase = await createClient();

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
export async function getTvvPerformance() {
  const supabase = await createClient();
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
 * Tier distribution for donut chart
 */
export async function getTierDistribution() {
  const supabase = await createClient();
  const latestDate = await getLatestScoredAt(supabase);
  const tiers = [
    { name: "NÓNG", min: 70, max: 100, color: "#ff3b30" },
    { name: "ẤM", min: 40, max: 69, color: "#ff9500" },
    { name: "MÁT", min: 20, max: 39, color: "#5ac8fa" },
    { name: "NGỦ ĐÔNG", min: 0, max: 19, color: "#3a3a3c" },
  ];
  const results: { name: string; value: number; color: string }[] = [];
  for (const t of tiers) {
    const { count } = await supabase
      .from("fact_lead_score")
      .select("*", { count: "exact", head: true })
      .eq("scored_at", latestDate)
      .gte("hot_score", t.min)
      .lte("hot_score", t.max);
    results.push({ name: t.name, value: count ?? 0, color: t.color });
  }
  return results;
}

/**
 * Source distribution — touchpoints + leads per source
 */
export async function getSourceDistribution() {
  const supabase = await createClient();
  const sources = [
    { id: "salesforce", name: "Salesforce", color: "#00a1e0" },
    { id: "smax", name: "SMAX", color: "#7c3aed" },
    { id: "instantly", name: "Instantly", color: "#f59e0b" },
    { id: "web", name: "Wix Website", color: "#10b981" },
  ];
  const results: { name: string; touchpoints: number; leads: number; color: string }[] = [];
  for (const s of sources) {
    const { count: tpCount } = await supabase
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("source", s.id);
    const { count: leadCount } = await supabase
      .from("dim_lead")
      .select("*", { count: "exact", head: true })
      .eq("source", s.id);
    results.push({
      name: s.name,
      touchpoints: tpCount ?? 0,
      leads: leadCount ?? 0,
      color: s.color,
    });
  }
  return results;
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
