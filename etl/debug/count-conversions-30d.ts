import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  const cutoff30 = new Date();
  cutoff30.setDate(cutoff30.getDate() - 30);
  const iso30 = cutoff30.toISOString();

  const { count: last30 } = await admin.from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("event_type", "conversion")
    .eq("source", "salesforce")
    .gte("occurred_at", iso30);

  const { count: all } = await admin.from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("event_type", "conversion")
    .eq("source", "salesforce");

  const { count: last90 } = await admin.from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("event_type", "conversion")
    .eq("source", "salesforce")
    .gte("occurred_at", new Date(Date.now() - 90 * 86400_000).toISOString());

  console.log(`\n📊 MDA CDP fact_touchpoint conversion counts:`);
  console.log(`   All time:       ${all}`);
  console.log(`   Last 90 days:   ${last90}`);
  console.log(`   Last 30 days:   ${last30}  ← compare with SF Report`);
  console.log(`\n   Cutoff 30d:     ${iso30.slice(0, 10)} → today`);
}

main().catch(console.error);
