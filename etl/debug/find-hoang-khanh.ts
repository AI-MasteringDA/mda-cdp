import { admin } from "../lib/supabase-admin";

async function main() {
  // Who chatted around 2026-07-10 06:08Z (13:08 VN) per the snapshot view?
  const { data } = await admin
    .from("v_smax_lead_snapshot")
    .select("lead_id, full_name, fallback_name, occurred_at, phone, email")
    .gte("occurred_at", "2026-07-10T05:55:00Z")
    .lte("occurred_at", "2026-07-10T06:20:00Z")
    .order("occurred_at", { ascending: false });
  console.log(`Leads with latest activity 12:55–13:20 VN today: ${data?.length ?? 0}`);
  data?.forEach(r => console.log(`  ${String(r.occurred_at).slice(11, 19)}Z  ${r.full_name || r.fallback_name}  ${r.phone || ""} ${r.email || ""}`));

  // And any lead whose name matches Khanh
  const { data: byName } = await admin
    .from("v_smax_lead_snapshot")
    .select("full_name, fallback_name, occurred_at")
    .or("full_name.ilike.%khanh%,fallback_name.ilike.%khanh%")
    .order("occurred_at", { ascending: false })
    .limit(8);
  console.log(`\nTop 'khanh' leads by latest activity:`);
  byName?.forEach(r => console.log(`  ${String(r.occurred_at).slice(0, 19)}  ${r.full_name || r.fallback_name}`));
}
main().catch(e => { console.error(e); process.exit(1); });
