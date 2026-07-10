import { admin } from "../lib/supabase-admin";

async function main() {
  const jul10start = "2026-07-10T00:00:00Z";
  const jul9start = "2026-07-09T00:00:00Z";
  const { count: c10 } = await admin.from("fact_touchpoint").select("*", { count: "exact", head: true }).eq("source", "smax").gte("occurred_at", jul10start);
  const { count: c9 } = await admin.from("fact_touchpoint").select("*", { count: "exact", head: true }).eq("source", "smax").gte("occurred_at", jul9start).lt("occurred_at", jul10start);

  console.log(`SMAX fact_touchpoint counts:`);
  console.log(`  2026-07-09:  ${c9}`);
  console.log(`  2026-07-10:  ${c10}`);

  const { data: newest } = await admin.from("fact_touchpoint")
    .select("occurred_at, event_type, title, lead_id")
    .eq("source", "smax")
    .order("occurred_at", { ascending: false })
    .limit(5);
  console.log(`\n5 newest SMAX touchpoints:`);
  newest?.forEach((r, i) => console.log(`  ${i+1}. ${r.occurred_at}  [${r.event_type}]  ${(r.title || "").slice(0, 60)}`));

  const { data: jobs } = await admin.from("sync_job")
    .select("started_at, finished_at, status, records_in, records_merged, error_message")
    .eq("source", "smax")
    .order("started_at", { ascending: false })
    .limit(5);
  console.log(`\n5 latest SMAX sync_jobs:`);
  jobs?.forEach((j, i) => console.log(`  ${i+1}. ${j.started_at?.slice(0,19)}→${j.finished_at?.slice(11,19) || "..."} ${j.status.padEnd(8)}  in=${j.records_in} merged=${j.records_merged}  ${(j.error_message || "").slice(0, 60)}`));
}
main().catch(e => { console.error(e); process.exit(1); });
