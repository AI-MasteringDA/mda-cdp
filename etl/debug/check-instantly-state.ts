import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  // 1) Current data counts
  const { count: leads } = await admin
    .from("dim_lead")
    .select("*", { count: "exact", head: true })
    .eq("source", "instantly");
  const { count: tps } = await admin
    .from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("source", "instantly");
  console.log(`📊 Current Instantly data:`);
  console.log(`   Leads: ${leads?.toLocaleString("vi-VN")}`);
  console.log(`   Touchpoints: ${tps?.toLocaleString("vi-VN")}`);

  // 2) Cursor + fail counter
  const { data: state } = await admin
    .from("etl_state")
    .select("*")
    .eq("source", "instantly");
  console.log(`\n🔧 ETL state:`);
  for (const s of state ?? []) {
    console.log(`   ${s.key} = ${s.value}`);
  }

  // 3) Most recent touchpoint timestamp
  const { data: latest } = await admin
    .from("fact_touchpoint")
    .select("occurred_at")
    .eq("source", "instantly")
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  console.log(`\n⏰ Latest Instantly touchpoint: ${latest?.occurred_at}`);
}

main().catch(console.error);
