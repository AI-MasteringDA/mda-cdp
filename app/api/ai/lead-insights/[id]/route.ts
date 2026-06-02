import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateLeadInsight, type LeadContext } from "@/lib/ai/claude";
import { scoreToTier } from "@/types/lead";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  // Auth check
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch lead (RLS will filter by account)
  const { data: lead } = await supabase
    .from("dim_lead")
    .select("*")
    .eq("lead_id", id)
    .single();
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  // Fetch latest score
  const { data: score } = await supabase
    .from("fact_lead_score")
    .select("*")
    .eq("lead_id", id)
    .eq("scored_at", new Date().toISOString().slice(0, 10))
    .maybeSingle();

  // Fetch touchpoints (50 most recent)
  const { data: touchpoints } = await supabase
    .from("fact_touchpoint")
    .select("source, event_type, title, detail, occurred_at")
    .eq("lead_id", id)
    .order("occurred_at", { ascending: false })
    .limit(50);

  // Parse reasons from hot_reasons JSON
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
    timeline: (touchpoints ?? []).map((t) => ({
      date: new Date(t.occurred_at).toLocaleDateString("vi-VN"),
      source: t.source,
      type: t.event_type,
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
      { error: msg.slice(0, 300) },
      { status: 500 }
    );
  }
}
