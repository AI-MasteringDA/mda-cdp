import { admin } from "../lib/supabase-admin";

async function main() {
  const t0 = Date.now();
  const { count: cTotal } = await admin.from("fact_touchpoint")
    .select("*", { count: "exact", head: true }).eq("source", "smax");
  console.log(`1. fact_touchpoint(smax) after dedup: ${cTotal}  (${Date.now() - t0}ms) — was 72k+`);

  const t1 = Date.now();
  const { data: v, error: ev } = await admin.from("v_smax_lead_snapshot")
    .select("*").order("occurred_at", { ascending: false }).limit(3);
  console.log(`2. v_smax_lead_snapshot top-3 (${Date.now() - t1}ms)  err=${ev?.message || "-"}`);
  v?.forEach((r: Record<string, unknown>) =>
    console.log(`   ${String(r.occurred_at).slice(0, 19)}  ${String(r.full_name || r.fallback_name).slice(0, 25)}  chats=${r.total_chats}`));

  const t2 = Date.now();
  const { count: c10 } = await admin.from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("source", "smax").gte("occurred_at", "2026-07-10T00:00:00Z");
  console.log(`3. Jul-10 SMAX touchpoints in DB: ${c10}  (${Date.now() - t2}ms)`);
}
main().catch(e => { console.error(e); process.exit(1); });
