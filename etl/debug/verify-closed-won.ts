import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  console.log("🔍 Verify 972 leads marked 'Đã chốt' vs Salesforce raw data\n");

  // 1. Count conversion events per lead — are there any leads with MULTIPLE Closed Won ops?
  const { data: allConversions } = await admin
    .from("fact_touchpoint")
    .select("lead_id, title, occurred_at, payload")
    .eq("event_type", "conversion")
    .eq("source", "salesforce");

  console.log(`📊 Total conversion events: ${allConversions?.length}\n`);

  // Group by lead
  const byLead = new Map<string, any[]>();
  allConversions?.forEach(c => {
    const arr = byLead.get(c.lead_id) ?? [];
    arr.push(c);
    byLead.set(c.lead_id, arr);
  });

  const multiConv = [...byLead.entries()].filter(([, arr]) => arr.length > 1);
  console.log(`Leads with 1 conversion:  ${[...byLead.entries()].filter(([, a]) => a.length === 1).length}`);
  console.log(`Leads with 2+ conversions: ${multiConv.length}\n`);

  // 2. Sample 10 conversion events — check payload structure
  console.log("📋 Sample 10 conversion events (verify Salesforce reality):\n");
  const sample = allConversions?.slice(0, 10) ?? [];
  for (let i = 0; i < sample.length; i++) {
    const c = sample[i];
    const { data: lead } = await admin
      .from("dim_lead")
      .select("full_name, email, phone, source, lead_source, assignee")
      .eq("lead_id", c.lead_id).maybeSingle();
    const p = c.payload as any;
    console.log(`── ${i+1} ──────────────────────────────────`);
    console.log(`  Lead:         ${lead?.full_name} (${lead?.email || '—'})`);
    console.log(`  Phone:        ${lead?.phone || '—'}`);
    console.log(`  Source:       ${lead?.source} · Assignee: ${lead?.assignee}`);
    console.log(`  Event title:  ${c.title}`);
    console.log(`  Closed at:    ${c.occurred_at?.slice(0, 10)}`);
    console.log(`  SF Opp ID:    ${p?.opportunity_id}`);
    console.log(`  SF Stage:     ${p?.stage_name}`);
    console.log(`  Amount:       ${p?.amount ? Number(p.amount).toLocaleString('vi-VN') + ' VND' : '—'}`);
    console.log(`  Owner:        ${p?.owner_name || '—'}`);
    console.log("");
  }

  // 3. Count by stage_name in payload
  console.log("📦 Breakdown by stage_name in SF payload:");
  const stageCounts: Record<string, number> = {};
  allConversions?.forEach(c => {
    const st = (c.payload as any)?.stage_name || 'null';
    stageCounts[st] = (stageCounts[st] || 0) + 1;
  });
  for (const [st, c] of Object.entries(stageCounts).sort((a,b) => b[1]-a[1])) {
    console.log(`   ${st.padEnd(30)}: ${c}`);
  }

  // 4. Total amount from all Closed Won
  const totalAmount = (allConversions ?? [])
    .filter(c => (c.payload as any)?.stage_name?.toLowerCase().includes("won"))
    .reduce((sum, c) => sum + (Number((c.payload as any)?.amount) || 0), 0);
  console.log(`\n💰 Total Closed Won amount: ${totalAmount.toLocaleString('vi-VN')} VND`);
}

main().catch(console.error);
