import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  const iso3 = new Date(Date.now() - 3 * 86400_000).toISOString();
  const iso7 = new Date(Date.now() - 7 * 86400_000).toISOString();
  const iso30 = new Date(Date.now() - 30 * 86400_000).toISOString();

  console.log("📊 Preview: leads with form_submit or web login recently\n");

  for (const [label, iso] of [["3 ngày", iso3], ["7 ngày", iso7], ["30 ngày", iso30]]) {
    const { data: form } = await admin.from("fact_touchpoint")
      .select("lead_id").eq("source", "web").eq("event_type", "form_submit").gte("occurred_at", iso);
    const { data: login } = await admin.from("fact_touchpoint")
      .select("lead_id").eq("source", "web").eq("event_type", "page_view").gte("occurred_at", iso);
    const leads = new Set<string>();
    form?.forEach(f => leads.add(f.lead_id));
    login?.forEach(l => leads.add(l.lead_id));
    console.log(`   ${label}:  form=${form?.length}, login=${login?.length}, unique_leads=${leads.size}`);
  }

  // Sample 5 recent form_submit leads
  console.log("\n📋 5 leads form_submit gần nhất:");
  const { data: samples } = await admin.from("fact_touchpoint")
    .select("lead_id, occurred_at, dim_lead!inner(full_name, email, company)")
    .eq("source", "web").eq("event_type", "form_submit")
    .order("occurred_at", { ascending: false }).limit(5);
  samples?.forEach((s: any, i) => {
    const l = s.dim_lead;
    console.log(`   ${i+1}. ${(l.full_name || '—').padEnd(25)} ${(l.email || '—').padEnd(35)} ${s.occurred_at?.slice(0,10)}`);
  });
}
main().catch(console.error);
