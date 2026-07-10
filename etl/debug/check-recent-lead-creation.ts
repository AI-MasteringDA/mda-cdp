import { admin } from "../lib/supabase-admin";

async function main() {
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const oneDayAgo = new Date(Date.now() - 86400_000).toISOString();

  const { count: cLastHour } = await admin.from("dim_lead")
    .select("*", { count: "exact", head: true })
    .gte("first_seen_at", oneHourAgo);
  const { count: cLastDay } = await admin.from("dim_lead")
    .select("*", { count: "exact", head: true })
    .gte("first_seen_at", oneDayAgo);
  const { count: cTotal } = await admin.from("dim_lead").select("*", { count: "exact", head: true });
  const { count: cSmaxTotal } = await admin.from("dim_lead").select("*", { count: "exact", head: true }).eq("source", "smax");

  console.log(`Total dim_lead:       ${cTotal}`);
  console.log(`SMAX-source total:    ${cSmaxTotal}`);
  console.log(`Created last 1h:      ${cLastHour}`);
  console.log(`Created last 24h:     ${cLastDay}`);

  // Look at 10 most recent SMAX-source leads
  const { data: recent } = await admin.from("dim_lead")
    .select("lead_id, full_name, email, phone, smax_customer_id, external_platform, first_seen_at, source")
    .eq("source", "smax")
    .order("first_seen_at", { ascending: false })
    .limit(10);
  console.log("\n10 most recent SMAX leads:");
  recent?.forEach(r => console.log(`  ${r.first_seen_at?.slice(0,19)}  ${r.full_name?.slice(0,25).padEnd(25)}  smax_cust=${r.smax_customer_id}  email=${r.email || "-"}  phone=${r.phone || "-"}`));

  // Check for duplicates via smax_customer_id (should be unique per SMAX customer)
  const { data: dupCheck } = await admin.rpc("count_duplicate_smax_customer_ids").catch(() => ({ data: null }));
  if (dupCheck) console.log("\nDuplicate smax_customer_id:", dupCheck);
  else {
    // Manual check: pull 500 recent SMAX leads and check if smax_customer_id duplicates
    const { data: all } = await admin.from("dim_lead")
      .select("smax_customer_id")
      .eq("source", "smax")
      .not("smax_customer_id", "is", null)
      .order("first_seen_at", { ascending: false })
      .limit(2000);
    const counts = new Map<string, number>();
    for (const r of all ?? []) counts.set(r.smax_customer_id!, (counts.get(r.smax_customer_id!) || 0) + 1);
    let dups = 0, samples: string[] = [];
    for (const [k, v] of counts) {
      if (v > 1) {
        dups++;
        if (samples.length < 5) samples.push(`${k} (×${v})`);
      }
    }
    console.log(`\nDuplicate smax_customer_id in recent 2000: ${dups}`);
    if (samples.length) console.log(`  Samples: ${samples.join(", ")}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
