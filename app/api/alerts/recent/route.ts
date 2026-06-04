import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lark_alert")
    .select("id, rule_name, reason, sent_at, delivered, lead_id")
    .order("sent_at", { ascending: false })
    .limit(10);

  if (!data || data.length === 0) {
    return NextResponse.json({ alerts: [], unread: 0 });
  }

  // Fetch lead names in one batch
  const leadIds = [...new Set(data.map((a) => a.lead_id).filter(Boolean))];
  let leadMap = new Map<string, string>();
  if (leadIds.length > 0) {
    const { data: leads } = await supabase
      .from("dim_lead")
      .select("lead_id, full_name")
      .in("lead_id", leadIds);
    leadMap = new Map((leads ?? []).map((l) => [l.lead_id, l.full_name]));
  }

  const alerts = data.map((a) => ({
    id: a.id,
    ruleName: a.rule_name,
    reason: a.reason ?? "",
    sentAt: a.sent_at,
    delivered: a.delivered,
    leadId: a.lead_id,
    leadName: leadMap.get(a.lead_id) ?? "Unknown",
  }));

  // Unread = sent in last 24h
  const dayAgo = Date.now() - 24 * 3600_000;
  const unread = alerts.filter((a) => new Date(a.sentAt).getTime() > dayAgo).length;

  return NextResponse.json({ alerts, unread });
}
