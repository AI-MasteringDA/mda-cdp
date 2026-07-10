import { admin } from "../lib/supabase-admin";

async function main() {
  console.log("Test 1: source=smax + occurred_at range 2026-07-10");
  const { data: d1, error: e1 } = await admin.from("fact_touchpoint")
    .select("occurred_at, event_type, title")
    .eq("source", "smax")
    .gte("occurred_at", "2026-07-10T00:00:00Z")
    .lte("occurred_at", "2026-07-11T00:00:00Z")
    .limit(5);
  console.log("  err:", e1?.message, "rows:", d1?.length);
  d1?.forEach(r => console.log(`    ${r.occurred_at}  [${r.event_type}]  ${(r.title || "").slice(0,50)}`));

  console.log("\nTest 2: source=smax + occurred_at range 2026-07-09");
  const { data: d2, error: e2 } = await admin.from("fact_touchpoint")
    .select("occurred_at, event_type, title")
    .eq("source", "smax")
    .gte("occurred_at", "2026-07-09T00:00:00Z")
    .lte("occurred_at", "2026-07-10T00:00:00Z")
    .order("occurred_at", { ascending: false })
    .limit(5);
  console.log("  err:", e2?.message, "rows:", d2?.length);
  d2?.forEach(r => console.log(`    ${r.occurred_at}  [${r.event_type}]  ${(r.title || "").slice(0,50)}`));

  console.log("\nTest 3: total count fact_touchpoint");
  const { count, error: e3 } = await admin.from("fact_touchpoint")
    .select("*", { count: "exact", head: true });
  console.log("  err:", e3?.message, "count:", count);
}
main().catch(e => { console.error(e); process.exit(1); });
