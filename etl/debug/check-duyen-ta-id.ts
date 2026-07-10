import { admin } from "../lib/supabase-admin";

async function main() {
  // Search by phone 0909612171 first
  const { data: byPhone } = await admin.from("dim_lead")
    .select("lead_id, full_name, phone, email, smax_customer_id, external_platform, external_profile_id, source")
    .eq("phone", "0909612171");
  console.log("By phone 0909612171:");
  console.log(JSON.stringify(byPhone, null, 2));

  // Search by name
  const { data: byName } = await admin.from("dim_lead")
    .select("lead_id, full_name, phone, smax_customer_id, external_platform, external_profile_id, source")
    .ilike("full_name", "%Duyen Ta%");
  console.log("\nBy name 'Duyen Ta%':");
  console.log(JSON.stringify(byName, null, 2));

  // Also grab 5 sample SMAX-source leads to see external_profile_id format
  const { data: samples } = await admin.from("dim_lead")
    .select("full_name, external_platform, external_profile_id, smax_customer_id")
    .eq("source", "smax")
    .not("external_profile_id", "is", null)
    .limit(10);
  console.log("\n10 sample SMAX leads with external_profile_id:");
  samples?.forEach(r => console.log(`  ${r.full_name?.slice(0, 30).padEnd(30)}  platform=${r.external_platform}  pid=${r.external_profile_id}`));
}
main().catch(e => { console.error(e); process.exit(1); });
