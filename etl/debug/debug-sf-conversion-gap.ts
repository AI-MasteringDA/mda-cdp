import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

/**
 * Debug: SF Reports show 1,135 Closed Won trong 30 ngày.
 * MDA CDP show 972 leads đã Đã chốt.
 * Gap: 163 leads/opps.
 *
 * Break down WHERE opps got lost.
 */
async function main() {
  console.log("🔍 DEBUG: Salesforce Closed Won → MDA CDP flow\n");

  // 1. Count conversion events in DB
  const { count: convCount } = await admin.from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("event_type", "conversion").eq("source", "salesforce");
  console.log(`📊 fact_touchpoint conversion events: ${convCount}`);

  // 2. Unique opportunity_ids
  const oppIds = new Set<string>();
  let from = 0;
  while (true) {
    const { data } = await admin.from("fact_touchpoint")
      .select("payload").eq("event_type", "conversion").eq("source", "salesforce")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const r of data) {
      const oid = (r.payload as any)?.opportunity_id;
      if (oid) oppIds.add(oid);
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`   Unique opportunity_ids: ${oppIds.size}`);

  // 3. Unique leads with conversion
  const leadIds = new Set<string>();
  from = 0;
  while (true) {
    const { data } = await admin.from("fact_touchpoint")
      .select("lead_id").eq("event_type", "conversion").eq("source", "salesforce")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const r of data) leadIds.add(r.lead_id);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`   Unique leads with conversion: ${leadIds.size}`);

  // 4. Show payload sample to verify field names
  const { data: sample } = await admin.from("fact_touchpoint")
    .select("title, detail, payload").eq("event_type", "conversion")
    .eq("source", "salesforce").limit(3);
  console.log("\n📋 Sample payload structure:");
  sample?.forEach((r, i) => {
    console.log(`   ${i+1}. title:   ${r.title}`);
    console.log(`      detail:  ${r.detail}`);
    console.log(`      payload: ${JSON.stringify(r.payload)}`);
  });

  // 5. Amount stats (from `amount` field in payload)
  const { data: allConv } = await admin.from("fact_touchpoint")
    .select("payload, occurred_at").eq("event_type", "conversion").eq("source", "salesforce");
  const amounts = (allConv ?? []).map(r => Number((r.payload as any)?.amount) || 0);
  const totalRev = amounts.reduce((a, b) => a + b, 0);
  const avgRev = amounts.length ? Math.round(totalRev / amounts.length) : 0;
  console.log(`\n💰 Revenue stats:`);
  console.log(`   Total: ${totalRev.toLocaleString('vi-VN')} VND`);
  console.log(`   Avg:   ${avgRev.toLocaleString('vi-VN')} VND / opp`);
  console.log(`   Min:   ${Math.min(...amounts).toLocaleString('vi-VN')} VND`);
  console.log(`   Max:   ${Math.max(...amounts).toLocaleString('vi-VN')} VND`);

  // 6. Timeline distribution — closed dates
  const dates: Record<string, number> = {};
  (allConv ?? []).forEach(r => {
    const d = r.occurred_at?.slice(0, 10) || 'unknown';
    dates[d] = (dates[d] || 0) + 1;
  });
  console.log(`\n📅 Closed dates distribution (last 15 dates):`);
  Object.entries(dates).sort().slice(-15).forEach(([d, c]) => {
    console.log(`   ${d}: ${'█'.repeat(Math.min(c, 40))} ${c}`);
  });

  // 7. Gap analysis: why 163 opps missing from CDP?
  console.log(`\n🔍 GAP ANALYSIS: SF reports 1,135 Closed Won vs CDP ${oppIds.size} opps`);
  console.log(`   Missing: ${1135 - oppIds.size} opps`);
  console.log(`   Possible reasons:`);
  console.log(`   1. Opportunity không có Contact/Lead relationship (org-level opp)`);
  console.log(`   2. Contact linked bị deleted khỏi SF sau khi opp tạo`);
  console.log(`   3. ETL LIMIT 10000 leads/contacts → contact không được pull`);
  console.log(`   4. Identity resolve fail (email/phone not extractable)`);
  console.log(`   5. Opp có ngày CloseDate ngoài range 30 ngày (edge case timezone)`);
  console.log(`\n   ➡️  Kiểm tra Salesforce Report với filter:`);
  console.log(`       StageName = 'Closed Won'`);
  console.log(`       CloseDate = LAST N DAYS 30`);
  console.log(`       AND HasOpportunityContactRole = false  ← số này ~= 163 dự đoán`);
}

main().catch(console.error);
