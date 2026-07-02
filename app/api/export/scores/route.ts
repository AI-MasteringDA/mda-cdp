import { getAnalyticsClient, toCSV, csvResponse } from "../_shared";

// All scores today ranked
export async function GET() {
  const s = getAnalyticsClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await s
    .from("fact_lead_score")
    .select("hot_score, dim_lead!inner(full_name, email, stage)")
    .eq("scored_at", today)
    .order("hot_score", { ascending: false })
    .limit(1000);

  const rows = (data || []).map((r) => {
    const l = r.dim_lead as unknown as { full_name: string; email: string; stage: string };
    return {
      rank: 0,
      score: r.hot_score,
      tier: r.hot_score >= 70 ? "NÓNG" : r.hot_score >= 40 ? "ẤM" : r.hot_score >= 20 ? "MÁT" : "NGỦ ĐÔNG",
      name: l.full_name,
      email: l.email,
      stage: l.stage,
    };
  });
  rows.forEach((r, i) => (r.rank = i + 1));
  return csvResponse(toCSV(rows));
}
