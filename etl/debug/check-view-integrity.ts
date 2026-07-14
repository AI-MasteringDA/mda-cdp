import { admin } from "../lib/supabase-admin";

async function main() {
  const { count: viewTotal } = await admin
    .from("v_smax_lead_snapshot").select("*", { count: "exact", head: true });
  console.log(`v_smax_lead_snapshot TỔNG số dòng: ${viewTotal}`);

  const { count: tpTotal } = await admin
    .from("fact_touchpoint").select("*", { count: "exact", head: true }).eq("source", "smax");
  console.log(`fact_touchpoint (smax) tổng: ${tpTotal}`);

  // Phân bố occurred_at của view
  const buckets: Record<string, number> = {};
  let from = 0, oldest = "9999", newest = "0";
  while (from < 30000) {
    const { data } = await admin
      .from("v_smax_lead_snapshot").select("occurred_at").range(from, from + 999);
    if (!data?.length) break;
    for (const r of data) {
      const o = String(r.occurred_at ?? "");
      if (!o) continue;
      if (o < oldest) oldest = o;
      if (o > newest) newest = o;
      const ym = o.slice(0, 7);
      buckets[ym] = (buckets[ym] ?? 0) + 1;
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`\nCũ nhất: ${oldest.slice(0, 10)}   Mới nhất: ${newest.slice(0, 10)}`);
  console.log(`\nPhân bố theo tháng (latest touchpoint của mỗi lead):`);
  Object.entries(buckets).sort().forEach(([m, n]) => console.log(`   ${m}: ${n}`));
}
main().catch(e => { console.error(e); process.exit(1); });
