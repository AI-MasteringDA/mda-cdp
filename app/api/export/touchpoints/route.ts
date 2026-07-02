import { NextRequest } from "next/server";
import { getAnalyticsClient, toCSV, csvResponse } from "../_shared";

/**
 * Export recent touchpoints — filter via ?source=X&days=N&limit=N
 * ?source=salesforce|smax|instantly|web (default: all)
 * ?days=7 (default 7)
 * ?limit=500 (default 500, max 2000)
 */
export async function GET(req: NextRequest) {
  const s = getAnalyticsClient();
  const source = req.nextUrl.searchParams.get("source");
  const days = Math.min(30, Math.max(1, Number(req.nextUrl.searchParams.get("days") || 7)));
  const limit = Math.min(2000, Math.max(1, Number(req.nextUrl.searchParams.get("limit") || 500)));
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();

  let q = s.from("fact_touchpoint")
    .select("source, event_type, title, detail, occurred_at, dim_lead(full_name, email, phone, company, stage)")
    .gte("occurred_at", cutoff)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (source && source !== "all") q = q.eq("source", source);
  const { data } = await q;

  const rows = (data || []).map((r) => {
    const l = (r.dim_lead as unknown as {
      full_name: string; email: string; phone: string | null;
      company: string | null; stage: string;
    }) || {};
    return {
      time: r.occurred_at?.slice(0, 19) || "",
      source: r.source,
      event_type: r.event_type,
      lead_name: l.full_name || "",
      lead_email: l.email || "",
      lead_phone: l.phone || "",
      lead_company: l.company || "",
      lead_stage: l.stage || "",
      title: r.title || "",
      detail: (r.detail || "").slice(0, 200),
    };
  });
  return csvResponse(toCSV(rows));
}
