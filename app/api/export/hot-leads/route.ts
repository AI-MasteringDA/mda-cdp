import { getAnalyticsClient, toCSV, csvResponse } from "../_shared";

export async function GET() {
  const s = getAnalyticsClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await s
    .from("fact_lead_score")
    .select("hot_score, hot_reasons, dim_lead!inner(full_name, email, phone, company, stage, assignee, chat_count, chat_staff_count, form_submit_count, email_open_count, email_click_count, email_reply_count, source_count, last_engagement_at)")
    .eq("scored_at", today)
    .gte("hot_score", 70)
    .order("hot_score", { ascending: false })
    .limit(500);

  const rows = (data || []).map((r) => {
    const l = r.dim_lead as unknown as {
      full_name: string; email: string; phone: string | null;
      company: string | null; stage: string; assignee: string | null;
      chat_count: number; chat_staff_count: number; form_submit_count: number;
      email_open_count: number; email_click_count: number; email_reply_count: number;
      source_count: number; last_engagement_at: string | null;
    };
    const reasons = (r.hot_reasons as Array<{ sign: string; label: string; points: number }> | null) || [];
    return {
      score: r.hot_score,
      name: l.full_name,
      email: l.email,
      phone: l.phone || "",
      company: l.company || (l.email?.includes("@") ? l.email.split("@")[1] : ""),
      stage: l.stage,
      tvv: l.assignee || "",
      chat_lead: l.chat_count,
      chat_tvv: l.chat_staff_count,
      form_submits: l.form_submit_count,
      email_opens: l.email_open_count,
      email_clicks: l.email_click_count,
      email_replies: l.email_reply_count,
      sources_engaged: l.source_count,
      last_engagement: l.last_engagement_at?.slice(0, 19) || "",
      reasons: reasons.map(x => `${x.sign}${x.points} ${x.label}`).join(" | "),
    };
  });
  return csvResponse(toCSV(rows));
}
