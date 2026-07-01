import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  // Count without timeout-prone query: paginate counting head=true
  let total = 0;
  let from = 0;
  while (from < 1_000_000) {
    const { count } = await admin
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("source", "salesforce")
      .range(from, from + 999);
    if (count !== null) {
      total = count;
      break; // count is exact total, no need to paginate
    }
    from += 1000;
  }

  console.log(`📊 Total SF touchpoints: ${total.toLocaleString("vi-VN")}`);

  // Type breakdown using event_type group via raw SQL-like queries
  const types = ["email_sent", "lead_created", "conversion", "lost", "call", "meeting", "note"];
  for (const t of types) {
    const { count } = await admin
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("source", "salesforce")
      .eq("event_type", t);
    if ((count ?? 0) > 0) {
      console.log(`   ${t.padEnd(20)}: ${(count ?? 0).toLocaleString("vi-VN")}`);
    }
  }

  // For Tuan Ngoc specifically
  const { data: lead } = await admin
    .from("dim_lead")
    .select("lead_id")
    .eq("email", "jeanwork2012@gmail.com")
    .single();
  if (lead) {
    const { count: tuanSfCount } = await admin
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("lead_id", lead.lead_id)
      .eq("source", "salesforce");
    const { count: tuanEmailCount } = await admin
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("lead_id", lead.lead_id)
      .eq("source", "salesforce")
      .eq("event_type", "email_sent");
    console.log(`\n🎯 Tuan Ngoc SF touchpoints: ${tuanSfCount} (email_sent: ${tuanEmailCount})`);
  }
}

main().catch(console.error);
