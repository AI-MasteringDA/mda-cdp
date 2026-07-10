import { admin } from "../lib/supabase-admin";

async function main() {
  const merged = await admin.from("dim_lead")
    .select("lead_id, full_name, email, phone, source, smax_tags")
    .eq("lead_id", "79832859-e1a3-4bef-abc7-169ad2ee2f40")
    .maybeSingle();
  console.log("Hiếu Phạm merged lead:");
  console.log(JSON.stringify(merged.data, null, 2));

  const orphan = await admin.from("dim_lead")
    .select("lead_id")
    .eq("lead_id", "3b3e44aa-a760-4375-b81c-761edc9fca80")
    .maybeSingle();
  console.log("\nĐức Hiếu orphan (should be null):", orphan.data);

  // How many touchpoints now on Hiếu Phạm lead?
  const { count } = await admin.from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("lead_id", "79832859-e1a3-4bef-abc7-169ad2ee2f40")
    .eq("source", "smax");
  console.log(`\nSMAX touchpoints on Hiếu Phạm: ${count}`);
}
main().catch(e => { console.error(e); process.exit(1); });
