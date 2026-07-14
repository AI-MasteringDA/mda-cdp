import { admin } from "../lib/supabase-admin";

async function main() {
  console.log("=== Số dòng fact_touchpoint theo source ===");
  for (const s of ["smax", "salesforce", "instantly", "web"]) {
    const { count } = await admin.from("fact_touchpoint")
      .select("*", { count: "exact", head: true }).eq("source", s);
    const { data: oldest } = await admin.from("fact_touchpoint")
      .select("occurred_at").eq("source", s)
      .order("occurred_at", { ascending: true }).limit(1);
    console.log(`  ${s.padEnd(11)} ${String(count ?? 0).padStart(6)} rows   cũ nhất: ${oldest?.[0]?.occurred_at?.slice(0, 10) ?? "-"}`);
  }

  const { count: leads } = await admin.from("dim_lead").select("*", { count: "exact", head: true });
  const { count: smaxLeads } = await admin.from("dim_lead").select("*", { count: "exact", head: true }).eq("source", "smax");
  console.log(`\ndim_lead: ${leads} tổng · ${smaxLeads} source=smax`);

  console.log("\n=== sync_job 4 ngày qua (theo source) ===");
  const since = new Date(Date.now() - 4 * 86400_000).toISOString();
  const { data: jobs } = await admin.from("sync_job")
    .select("source, status, started_at, records_in, records_merged, error_message")
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(400);
  const bySource: Record<string, { n: number; ok: number; fail: number; lastIn: number }> = {};
  for (const j of jobs ?? []) {
    const k = j.source ?? "?";
    bySource[k] ??= { n: 0, ok: 0, fail: 0, lastIn: 0 };
    bySource[k].n++;
    if (j.status === "success") bySource[k].ok++;
    if (j.status === "failed") bySource[k].fail++;
  }
  for (const [s, v] of Object.entries(bySource)) {
    console.log(`  ${s.padEnd(11)} ${v.n} runs (${v.ok} ok / ${v.fail} fail)`);
  }
  console.log("\n  5 job gần nhất:");
  (jobs ?? []).slice(0, 5).forEach(j =>
    console.log(`    ${j.started_at?.slice(0, 19)} ${String(j.source).padEnd(10)} ${String(j.status).padEnd(8)} in=${j.records_in} merged=${j.records_merged} ${(j.error_message ?? "").slice(0, 60)}`));

  console.log("\n=== SMAX touchpoint theo tháng ===");
  const byMonth: Record<string, number> = {};
  let from = 0;
  while (from < 30000) {
    const { data } = await admin.from("fact_touchpoint")
      .select("occurred_at").eq("source", "smax").range(from, from + 999);
    if (!data?.length) break;
    for (const r of data) {
      const m = String(r.occurred_at ?? "").slice(0, 7);
      if (m) byMonth[m] = (byMonth[m] ?? 0) + 1;
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  Object.entries(byMonth).sort().forEach(([m, n]) => console.log(`  ${m}: ${n}`));
}
main().catch(e => { console.error(e); process.exit(1); });
