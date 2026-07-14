/** Đo thời gian các query của trang /hot-leads sau khi V12 nâng số lead NÓNG lên 2,709. */
import { admin } from "../lib/supabase-admin";

async function main() {
  const t0 = Date.now();
  const { data: latest } = await admin.from("fact_lead_score")
    .select("scored_at").order("scored_at", { ascending: false }).limit(1);
  const scoredAt = latest?.[0]?.scored_at;
  console.log(`getLatestScoredAt: ${Date.now() - t0}ms`);

  // 1. Lấy toàn bộ score NÓNG
  let t = Date.now();
  const scores: { lead_id: string }[] = [];
  let from = 0;
  while (from < 10000) {
    const { data } = await admin.from("fact_lead_score")
      .select("*").eq("scored_at", scoredAt).gte("hot_score", 70).lte("hot_score", 100)
      .order("hot_score", { ascending: false }).range(from, from + 999);
    if (!data?.length) break;
    scores.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`fetch ${scores.length} scores: ${Date.now() - t}ms`);

  // 2. joinLeads — select("*") theo batch 500
  t = Date.now();
  const ids = scores.map(s => s.lead_id);
  let rows = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await admin.from("dim_lead").select("*").in("lead_id", ids.slice(i, i + 500));
    rows += data?.length ?? 0;
  }
  console.log(`joinLeads ${rows} rows (select *): ${Date.now() - t}ms`);

  // 3. getTopHotProducts
  t = Date.now();
  for (let i = 0; i < ids.length; i += 500) {
    await admin.from("dim_lead").select("sf_product").in("lead_id", ids.slice(i, i + 500)).not("sf_product", "is", null);
  }
  console.log(`getTopHotProducts: ${Date.now() - t}ms`);

  // 4. getHotListViews — vòng lặp qua từng view
  t = Date.now();
  const { data: views } = await admin.from("dim_list_view")
    .select("view_id, view_name").eq("sf_object_type", "Lead");
  console.log(`   số list view: ${views?.length ?? 0}`);
  let memberQueries = 0;
  for (const v of views ?? []) {
    let f = 0;
    while (true) {
      const { data: mem } = await admin.from("fact_list_view_member")
        .select("lead_id").eq("view_id", v.view_id).range(f, f + 999);
      memberQueries++;
      if (!mem?.length || mem.length < 1000) break;
      f += 1000;
    }
  }
  console.log(`getHotListViews (${memberQueries} queries): ${Date.now() - t}ms`);

  console.log(`\nTỔNG: ${Date.now() - t0}ms   (Vercel timeout mặc định ~10-15s)`);
}
main().catch(e => { console.error(e); process.exit(1); });
