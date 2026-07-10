import { admin } from "../lib/supabase-admin";

async function main() {
  const t0 = Date.now();
  console.log("Test 1: count dim_lead (should be fast)");
  const { count: cLead, error: e1 } = await admin.from("dim_lead").select("*", { count: "exact", head: true });
  console.log(`  ${Date.now() - t0}ms  count=${cLead}  err=${e1?.message}`);

  const t1 = Date.now();
  console.log("\nTest 2: 5 latest SMAX touchpoints (previously timed out)");
  const { data, error: e2 } = await admin.from("fact_touchpoint")
    .select("occurred_at, event_type")
    .eq("source", "smax")
    .order("occurred_at", { ascending: false })
    .limit(5);
  console.log(`  ${Date.now() - t1}ms  rows=${data?.length ?? 0}  err=${e2?.message}`);
  data?.forEach(r => console.log(`    ${r.occurred_at}  [${r.event_type}]`));
}
main().catch(e => { console.error(e); process.exit(1); });
