import { admin } from "../lib/supabase-admin";

async function main() {
  console.log("=== SMAX fact_touchpoint date audit ===");

  const { data: newest } = await admin
    .from("fact_touchpoint")
    .select("occurred_at, event_type, title, lead_id")
    .eq("source", "smax")
    .order("occurred_at", { ascending: false })
    .limit(5);

  const { data: oldest } = await admin
    .from("fact_touchpoint")
    .select("occurred_at, event_type, title")
    .eq("source", "smax")
    .order("occurred_at", { ascending: true })
    .limit(3);

  console.log("\n🆕 5 rows NEWEST:");
  newest?.forEach((r, i) => console.log(`  ${i + 1}. ${r.occurred_at}  [${r.event_type}]  ${(r.title || "").slice(0, 60)}`));

  console.log("\n📜 3 rows OLDEST:");
  oldest?.forEach((r, i) => console.log(`  ${i + 1}. ${r.occurred_at}  [${r.event_type}]`));

  const nowMs = Date.now();
  const y2025start = new Date("2025-01-01").toISOString();
  const y2026start = new Date("2026-01-01").toISOString();
  const jun2026 = new Date("2026-06-01").toISOString();
  const jul2026 = new Date("2026-07-01").toISOString();

  const { count: c2025 } = await admin
    .from("fact_touchpoint").select("*", { count: "exact", head: true })
    .eq("source", "smax")
    .gte("occurred_at", y2025start).lt("occurred_at", y2026start);

  const { count: c2026 } = await admin
    .from("fact_touchpoint").select("*", { count: "exact", head: true })
    .eq("source", "smax")
    .gte("occurred_at", y2026start);

  const { count: cJun2026 } = await admin
    .from("fact_touchpoint").select("*", { count: "exact", head: true })
    .eq("source", "smax")
    .gte("occurred_at", jun2026).lt("occurred_at", jul2026);

  const { count: cJul2026 } = await admin
    .from("fact_touchpoint").select("*", { count: "exact", head: true })
    .eq("source", "smax")
    .gte("occurred_at", jul2026);

  const { count: cTotal } = await admin
    .from("fact_touchpoint").select("*", { count: "exact", head: true })
    .eq("source", "smax");

  console.log("\n📊 Counts (source=smax):");
  console.log(`   Total:      ${cTotal}`);
  console.log(`   2025:       ${c2025}`);
  console.log(`   2026:       ${c2026}`);
  console.log(`   Jun 2026:   ${cJun2026}`);
  console.log(`   Jul 2026+:  ${cJul2026}`);

  const last7d = new Date(nowMs - 7 * 86400_000).toISOString();
  const { count: c7d } = await admin
    .from("fact_touchpoint").select("*", { count: "exact", head: true })
    .eq("source", "smax").gte("occurred_at", last7d);
  console.log(`   Last 7d:    ${c7d}`);

  const { data: jobs } = await admin
    .from("sync_job")
    .select("started_at, finished_at, status, records_in, records_merged, error_message")
    .eq("source", "smax")
    .order("started_at", { ascending: false })
    .limit(5);
  console.log("\n🔧 5 latest SMAX sync_jobs:");
  jobs?.forEach((j, i) => console.log(`  ${i + 1}. ${j.started_at?.slice(0, 19)} → ${j.status}  in=${j.records_in} merged=${j.records_merged}  ${j.error_message?.slice(0, 80) || ""}`));

  console.log("\n=== END ===");
}

main().catch(e => { console.error("ERR:", e); process.exit(1); });
