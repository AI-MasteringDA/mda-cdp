import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateLeadInsight, type LeadContext } from "@/lib/ai/claude";
import { scoreToTier } from "@/types/lead";

export const dynamic = "force-dynamic";

const KNOWN_MDA_PAGE_PIDS = new Set([
  "fb102323788540150",
  "fb107203051058856",
  "zlw543187459113764384",
  "zl2235256473219383054",
  "ctm68188e11779d16c0779c018c",
  "ig17841446528067260",
  "ig17841460097450702",
]);

function inferSender(t: {
  event_type: string;
  source: string;
  payload?: { sender_is_staff?: boolean; sender_pid?: string; page_pid?: string } | null;
}): "LEAD" | "TVV" | "MDA" | "—" {
  const p = t.payload || {};
  // SMAX events with explicit sender
  if (p.sender_is_staff === true) return "TVV";
  if (p.sender_is_staff === false) return "LEAD";
  if (p.sender_pid && p.page_pid) {
    if (p.sender_pid === p.page_pid || KNOWN_MDA_PAGE_PIDS.has(p.sender_pid)) return "TVV";
    return "LEAD";
  }
  // Event-type heuristics
  if (t.event_type === "chat_staff") return "TVV";
  if (t.event_type === "chat") return "LEAD";
  if (t.event_type === "email_sent") return "MDA";
  if (
    t.event_type === "email_open" ||
    t.event_type === "email_click" ||
    t.event_type === "email_reply"
  ) {
    return "LEAD";
  }
  if (t.event_type === "lead_created") return "—";
  return "—";
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  return Math.floor(diff / (24 * 3600_000));
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: lead } = await supabase
    .from("dim_lead")
    .select("*")
    .eq("lead_id", id)
    .single();
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  // Latest score
  const { data: score } = await supabase
    .from("fact_lead_score")
    .select("*")
    .eq("lead_id", id)
    .order("scored_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fetch ALL touchpoints (up to 100) with payload for sender info
  const { data: touchpoints } = await supabase
    .from("fact_touchpoint")
    .select("source, event_type, title, detail, occurred_at, payload")
    .eq("lead_id", id)
    .order("occurred_at", { ascending: false })
    .limit(100);

  const tps = (touchpoints ?? []).map((t) => ({
    ...t,
    sender: inferSender(t as Parameters<typeof inferSender>[0]),
  }));

  // ─── Pre-compute exact metrics ───
  let emails_sent_by_mda = 0;
  let emails_opened = 0;
  let emails_clicked = 0;
  let emails_replied = 0;
  let chats_from_lead = 0;
  let chats_from_tvv = 0;
  let attachments_from_lead = 0;
  let attachments_from_tvv = 0;
  let attachments_unknown = 0;
  let calls_logged = 0;
  let lastLeadActionAt: string | null = null;
  let lastMdaActionAt: string | null = null;
  let firstTouchAt: string | null = null;

  for (const t of tps) {
    if (t.event_type === "email_sent") emails_sent_by_mda++;
    else if (t.event_type === "email_open") emails_opened++;
    else if (t.event_type === "email_click") emails_clicked++;
    else if (t.event_type === "email_reply") emails_replied++;
    else if (t.event_type === "chat") {
      if (t.sender === "LEAD") chats_from_lead++;
      else if (t.sender === "TVV") chats_from_tvv++;
    } else if (t.event_type === "chat_staff") chats_from_tvv++;
    else if (t.event_type === "attachment") {
      if (t.sender === "LEAD") attachments_from_lead++;
      else if (t.sender === "TVV") attachments_from_tvv++;
      else attachments_unknown++;
    } else if (t.event_type === "call") calls_logged++;

    // Track recency
    if (t.sender === "LEAD" && !lastLeadActionAt) lastLeadActionAt = t.occurred_at;
    if (
      (t.sender === "TVV" || t.sender === "MDA" || t.event_type === "email_sent" || t.event_type === "chat_staff") &&
      !lastMdaActionAt
    ) lastMdaActionAt = t.occurred_at;
  }

  if (tps.length > 0) {
    firstTouchAt = tps[tps.length - 1].occurred_at;
  }

  // Parse reasons
  type Reason = { sign: string; label: string; points: number };
  const reasons: Reason[] = Array.isArray(score?.hot_reasons)
    ? (score!.hot_reasons as Reason[])
    : [];

  const ctx: LeadContext = {
    name: lead.full_name || "Khách",
    email: lead.email || "",
    phone: lead.phone || "",
    stage: lead.stage || "Mới",
    score: score?.hot_score ?? 0,
    tier: scoreToTier(score?.hot_score ?? 0),
    reasons,
    company: lead.company,
    leadSource: lead.lead_source,
    source: lead.source,
    precomputed: {
      total_touchpoints: tps.length,
      emails_sent_by_mda,
      emails_opened,
      emails_clicked,
      emails_replied,
      chats_from_lead,
      chats_from_tvv,
      attachments_from_lead,
      attachments_from_tvv,
      attachments_unknown,
      calls_logged,
      days_since_first_touch: daysSince(firstTouchAt),
      days_since_last_lead_action: daysSince(lastLeadActionAt),
      days_since_last_mda_action: daysSince(lastMdaActionAt),
    },
    timeline: tps.map((t) => ({
      date: new Date(t.occurred_at).toISOString().slice(0, 10),
      source: t.source,
      type: t.event_type,
      sender: t.sender,
      title: t.title || "",
      detail: t.detail || undefined,
    })),
  };

  try {
    const insight = await generateLeadInsight(ctx);
    return NextResponse.json({ insight });
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[AI Insights] Error for lead ${id}:`, msg);
    return NextResponse.json(
      { error: msg.slice(0, 500) },
      { status: 500 }
    );
  }
}
