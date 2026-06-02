import { createClient } from "./server";
import type { Lead, Touchpoint } from "@/types/lead";

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

function mergeToLead(row: LeadRow, score?: ScoreRow, touchpoints: TouchRow[] = []): Lead {
  return {
    id: row.lead_id,
    name: row.full_name,
    email: row.email,
    phone: row.phone,
    source: row.source as Lead["source"],
    avatarColor: row.avatar_color,
    hotScore: score?.hot_score ?? 0,
    coldScore: score?.cold_score ?? 0,
    hotReasons: score?.hot_reasons ?? [],
    coldReasons: score?.cold_reasons ?? [],
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

export async function getWarmLeads(limit = 200): Promise<Lead[]> {
  const supabase = await createClient();

  const { data: scores } = await supabase
    .from("fact_lead_score")
    .select("*")
    .eq("scored_at", new Date().toISOString().slice(0, 10))
    .gte("hot_score", 30)
    .lt("hot_score", 70)
    .order("hot_score", { ascending: false })
    .limit(limit);
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

export async function getHotLeads(limit = 50): Promise<Lead[]> {
  const supabase = await createClient();

  // 1. Query top scores TRƯỚC (chỉ vài rows)
  const { data: scores } = await supabase
    .from("fact_lead_score")
    .select("*")
    .eq("scored_at", new Date().toISOString().slice(0, 10))
    .gte("hot_score", 70)
    .order("hot_score", { ascending: false })
    .limit(limit);
  if (!scores || scores.length === 0) return [];

  // 2. Query leads theo lead_id (chính xác, nhanh)
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

export async function getColdLeads(limit = 50): Promise<Lead[]> {
  const supabase = await createClient();

  const { data: scores } = await supabase
    .from("fact_lead_score")
    .select("*")
    .eq("scored_at", new Date().toISOString().slice(0, 10))
    .gte("cold_score", 70)
    .order("cold_score", { ascending: false })
    .limit(limit);
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
  const today = new Date().toISOString().slice(0, 10);

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

  const { data: score } = await supabase
    .from("fact_lead_score")
    .select("*")
    .eq("lead_id", id)
    .eq("scored_at", new Date().toISOString().slice(0, 10))
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
  const today = new Date().toISOString().slice(0, 10);
  const { count: hotCount } = await supabase
    .from("fact_lead_score")
    .select("*", { count: "exact", head: true })
    .eq("scored_at", today)
    .gte("hot_score", 70);
  const { count: coldCount } = await supabase
    .from("fact_lead_score")
    .select("*", { count: "exact", head: true })
    .eq("scored_at", today)
    .gte("cold_score", 70);

  return {
    hotToday: { value: hotCount ?? 0, deltaPct: 12, deltaPositive: true },
    coldToRescue: { value: coldCount ?? 0, deltaPct: 8, deltaPositive: false },
    consultedWeek: { value: 156, deltaPct: 4, deltaPositive: true },
    conversionRate: { value: 18.4, deltaPct: 1.2, deltaPositive: true },
  };
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
    { id: "lark",       name: "Lark Bot",       category: "Webhook", description: "Gửi cảnh báo urgent đến TVV phụ trách qua DM/group.",            authType: "Webhook URL" },
    { id: "fanpage",    name: "Facebook Fanpage", category: "Social", description: "MasteringDataAnalytics + PhuongThaoAnalytics — đo lead nguồn.", authType: "OAuth 2.0" },
    { id: "web",        name: "Website + Ads",  category: "Web",     description: "Pageview, blog reads, click bảng giá.",                          authType: "Webhook URL" },
  ];

  const { data: jobs } = await supabase
    .from("sync_job")
    .select("source, status, started_at, finished_at, error_message")
    .order("started_at", { ascending: false });

  const { data: leadsBySrc } = await supabase
    .from("dim_lead")
    .select("source");
  const countBySource: Record<string, number> = {};
  for (const l of leadsBySrc ?? []) {
    countBySource[l.source] = (countBySource[l.source] ?? 0) + 1;
  }

  const latestBySrc = new Map<string, { status: string; started_at: string; error_message: string | null }>();
  for (const j of jobs ?? []) {
    if (!latestBySrc.has(j.source)) {
      latestBySrc.set(j.source, { status: j.status, started_at: j.started_at, error_message: j.error_message });
    }
  }

  return SOURCES.map((s) => {
    const latest = latestBySrc.get(s.id);
    let status: "connected" | "error" | "disconnected" | "pending";
    if (!latest) {
      status = "disconnected";
    } else if (latest.status === "failed") {
      status = "error";
    } else if (latest.status === "running") {
      status = "pending";
    } else {
      status = "connected";
    }
    return {
      ...s,
      status,
      lastSyncAt: latest ? new Date(latest.started_at) : undefined,
      recordCount: countBySource[s.id] ?? 0,
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
