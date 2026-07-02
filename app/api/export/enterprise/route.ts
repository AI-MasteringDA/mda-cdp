import { getAnalyticsClient, toCSV, csvResponse } from "../_shared";

// Enterprise leads = business email domain (not gmail/yahoo/etc)
export async function GET() {
  const s = getAnalyticsClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await s
    .from("fact_lead_score")
    .select("hot_score, hot_reasons, dim_lead!inner(full_name, email, phone, company, stage, email_open_count, email_click_count, email_reply_count, form_submit_count, chat_count, source_count, lifetime_value, customer_lifecycle_stage, months_since_last_purchase)")
    .eq("scored_at", today)
    .order("hot_score", { ascending: false })
    .limit(2000);

  const personalDomains = new Set([
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
    "live.com", "yahoo.com.vn", "hotmail.com.vn",
  ]);

  const rows = (data || [])
    .map((r) => {
      const l = r.dim_lead as unknown as {
        full_name: string; email: string; phone: string | null;
        company: string | null; stage: string;
        email_open_count: number; email_click_count: number; email_reply_count: number;
        form_submit_count: number; chat_count: number; source_count: number;
        lifetime_value: number | null; customer_lifecycle_stage: string | null;
        months_since_last_purchase: number | null;
      };
      const domain = (l.email?.includes("@") ? l.email.split("@")[1] : "").toLowerCase();
      const isEnterprise = domain && !personalDomains.has(domain);
      return {
        isEnterprise,
        score: r.hot_score,
        name: l.full_name,
        email: l.email,
        domain,
        company_guess: l.company || domain.split(".")[0],
        stage: l.stage,
        lifecycle: l.customer_lifecycle_stage || "prospect",
        ltv_vnd: l.lifetime_value || 0,
        months_ago: l.months_since_last_purchase || "",
        email_opens: l.email_open_count,
        email_clicks: l.email_click_count,
        email_replies: l.email_reply_count,
        form_submits: l.form_submit_count,
        chat_lead: l.chat_count,
        sources_engaged: l.source_count,
      };
    })
    .filter(r => r.isEnterprise)
    .slice(0, 500)
    .map(({ isEnterprise: _isEnterprise, ...rest }) => rest);

  return csvResponse(toCSV(rows));
}
