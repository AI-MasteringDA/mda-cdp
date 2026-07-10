import { admin } from "../lib/supabase-admin";

async function main() {
  // Find lead by smax_customer_id
  const scid = "6a4ca1c99dfa73a50749b864";
  const { data: lead } = await admin.from("dim_lead")
    .select("lead_id, full_name, email, phone, source, smax_customer_id, smax_tags")
    .eq("smax_customer_id", scid)
    .maybeSingle();
  console.log("Đức Hiếu (restored SMAX-source lead):");
  console.log(JSON.stringify(lead, null, 2));

  // Also check Hiếu Phạm
  const hp = await admin.from("dim_lead")
    .select("lead_id, full_name, email, phone, source, smax_tags")
    .eq("lead_id", "79832859-e1a3-4bef-abc7-169ad2ee2f40")
    .maybeSingle();
  console.log("\nHiếu Phạm (SF lead, still exists):");
  console.log(JSON.stringify(hp.data, null, 2));

  // Total unique SMAX leads in window
  const cutoff = new Date(Date.now() - 365 * 86400_000).toISOString();
  const ids = new Set<string>();
  let from = 0;
  while (from < 200000) {
    const { data } = await admin.from("fact_touchpoint").select("lead_id").eq("source", "smax").gte("occurred_at", cutoff).range(from, from + 999);
    if (!data?.length) break;
    for (const r of data) if (r.lead_id) ids.add(r.lead_id);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`\nUnique SMAX leads in 365d window: ${ids.size} (expected in next Lark push)`);
}
main().catch(e => { console.error(e); process.exit(1); });
