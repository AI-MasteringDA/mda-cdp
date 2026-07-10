import { admin } from "../lib/supabase-admin";

async function main() {
  console.log("=== SMAX orphan-lead investigation ===\n");

  // Total dim_lead rows
  const { count: totalDimLead } = await admin
    .from("dim_lead").select("*", { count: "exact", head: true });
  console.log(`dim_lead total rows:                ${totalDimLead}`);

  const { count: smaxDimLead } = await admin
    .from("dim_lead").select("*", { count: "exact", head: true })
    .eq("source", "smax");
  console.log(`dim_lead with source='smax':        ${smaxDimLead}`);

  // Distinct lead_ids in fact_touchpoint(source=smax)
  const distinctLeadIds = new Set<string>();
  let from = 0;
  while (from < 100000) {
    const { data } = await admin
      .from("fact_touchpoint")
      .select("lead_id")
      .eq("source", "smax")
      .range(from, from + 999);
    if (!data?.length) break;
    for (const r of data) if (r.lead_id) distinctLeadIds.add(r.lead_id);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`fact_touchpoint distinct lead_ids:  ${distinctLeadIds.size}`);

  // Which of those exist in dim_lead?
  const idsArr = Array.from(distinctLeadIds);
  const foundIds = new Set<string>();
  for (let i = 0; i < idsArr.length; i += 100) {
    const batch = idsArr.slice(i, i + 100);
    const { data } = await admin.from("dim_lead").select("lead_id").in("lead_id", batch);
    for (const r of data ?? []) foundIds.add(r.lead_id);
  }
  console.log(`fact_touchpoint lead_ids IN dim_lead:  ${foundIds.size}`);
  console.log(`Orphan lead_ids (not in dim_lead):     ${distinctLeadIds.size - foundIds.size}`);

  // Sample orphan lead_ids + their fact_touchpoint payload for clues
  const orphans = idsArr.filter(id => !foundIds.has(id)).slice(0, 5);
  console.log(`\n🔍 Sample 5 orphan lead_ids + their SMAX touchpoints:`);
  for (const oid of orphans) {
    const { data } = await admin
      .from("fact_touchpoint")
      .select("lead_id, event_type, occurred_at, payload")
      .eq("source", "smax")
      .eq("lead_id", oid)
      .order("occurred_at", { ascending: false })
      .limit(1);
    if (data?.[0]) {
      const tp = data[0];
      const pl = tp.payload as Record<string, unknown> | null;
      console.log(`   • lead_id: ${oid}`);
      console.log(`     latest: ${tp.occurred_at?.slice(0, 19)} [${tp.event_type}]`);
      console.log(`     payload.thread_id:        ${pl?.thread_id}`);
      console.log(`     payload.smax_customer_id: ${pl?.smax_customer_id}`);
      console.log(`     payload.customer_name:    ${pl?.customer_name}`);
      console.log(`     payload.source_endpoint:  ${pl?.source_endpoint}`);
      console.log("");
    }
  }

  // Try 1 orphan lead_id via dim_lead direct lookup (case-sensitive?)
  if (orphans[0]) {
    const oid = orphans[0];
    const { data, error } = await admin.from("dim_lead").select("*").eq("lead_id", oid).maybeSingle();
    console.log(`Direct lookup dim_lead where lead_id='${oid}':`);
    console.log(`   data: ${data ? JSON.stringify(data).slice(0, 150) : "null"}`);
    console.log(`   error: ${error?.message || "none"}`);
  }

  // What's dim_lead's identifier space — sample some
  const { data: dsample } = await admin
    .from("dim_lead").select("lead_id, full_name, source, smax_customer_id").eq("source", "smax").limit(5);
  console.log(`\n📋 dim_lead sample rows (source='smax'):`);
  dsample?.forEach(r => console.log(`   • ${r.lead_id}  name=${r.full_name}  smax_cust=${r.smax_customer_id}`));
}
main().catch(e => { console.error(e); process.exit(1); });
