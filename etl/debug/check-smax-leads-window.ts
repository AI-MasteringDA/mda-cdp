import { admin } from "../lib/supabase-admin";

async function main() {
  const DAYS = 365;
  const cutoffMs = Date.now() - DAYS * 86400_000;
  const cutoff = new Date(cutoffMs).toISOString();
  console.log(`Window: last ${DAYS} days (since ${cutoff})`);

  // Unique lead_ids with SMAX touchpoints in window
  const ids = new Set<string>();
  let from = 0;
  while (from < 50000) {
    const { data } = await admin
      .from("fact_touchpoint")
      .select("lead_id, occurred_at")
      .eq("source", "smax")
      .gte("occurred_at", cutoff)
      .range(from, from + 999);
    if (!data?.length) break;
    for (const r of data) if (r.lead_id) ids.add(r.lead_id);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Unique SMAX leads in window: ${ids.size}`);

  const idsArr = Array.from(ids);

  // How many have dim_lead metadata?
  let hasInfo = 0;
  const missingSample: string[] = [];
  for (let i = 0; i < idsArr.length; i += 500) {
    const batch = idsArr.slice(i, i + 500);
    const { data } = await admin
      .from("dim_lead")
      .select("lead_id")
      .in("lead_id", batch);
    const foundSet = new Set((data ?? []).map(r => r.lead_id));
    for (const id of batch) {
      if (foundSet.has(id)) hasInfo++;
      else if (missingSample.length < 3) missingSample.push(id);
    }
  }
  console.log(`Has dim_lead metadata: ${hasInfo}`);
  console.log(`Missing metadata: ${idsArr.length - hasInfo}  (sample: ${missingSample.join(", ")})`);
}
main().catch(e => { console.error(e); process.exit(1); });
