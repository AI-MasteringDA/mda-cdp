import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

const LEAD_ID = process.argv[2] || "2551c553-c213-4f43-94b1-53f25fae2311";

async function main() {
  console.log(`=== Analyzing lead ${LEAD_ID} ===\n`);

  // 1. Profile + aggregate columns
  const { data: lead } = await admin
    .from("dim_lead")
    .select("*")
    .eq("lead_id", LEAD_ID)
    .single();

  if (!lead) {
    console.log("Lead not found");
    return;
  }

  console.log("--- PROFILE ---");
  console.log(`  Name:    ${lead.full_name}`);
  console.log(`  Email:   ${lead.email}`);
  console.log(`  Phone:   ${lead.phone}`);
  console.log(`  Source:  ${lead.source}`);
  console.log(`  Stage:   ${lead.stage}`);
  console.log(`  Company: ${lead.company || "—"}`);
  console.log(`  Created: ${lead.first_seen_at}`);

  console.log("\n--- AGGREGATE COUNTERS (used by scoring V6) ---");
  console.log(`  total_touchpoints:    ${lead.total_touchpoints}`);
  console.log(`  email_received_count: ${lead.email_received_count}`);
  console.log(`  email_open_count:     ${lead.email_open_count}`);
  console.log(`  email_click_count:    ${lead.email_click_count}`);
  console.log(`  chat_count:           ${lead.chat_count}`);
  console.log(`  chat_staff_count:     ${lead.chat_staff_count}`);
  console.log(`  conversion_count:     ${lead.conversion_count}`);
  console.log(`  source_count:         ${lead.source_count}`);
  console.log(`  last_email_at:        ${lead.last_email_at}`);
  console.log(`  last_chat_at:         ${lead.last_chat_at}`);
  console.log(`  last_chat_staff_at:   ${lead.last_chat_staff_at}`);
  console.log(`  last_engagement_at:   ${lead.last_engagement_at}`);

  // 2. Current score + reasons
  const { data: score } = await admin
    .from("fact_lead_score")
    .select("*")
    .eq("lead_id", LEAD_ID)
    .order("scored_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  console.log("\n--- CURRENT SCORE ---");
  if (score) {
    console.log(`  scored_at:   ${score.scored_at}`);
    console.log(`  hot_score:   ${score.hot_score}/100`);
    console.log(`  cold_score:  ${score.cold_score}/100`);
    console.log(`  Reasons:`);
    const reasons = Array.isArray(score.hot_reasons) ? score.hot_reasons : [];
    for (const r of reasons) {
      const sign = (r as { sign?: string })?.sign || "?";
      const label = (r as { label?: string })?.label || "?";
      const points = (r as { points?: number })?.points || 0;
      console.log(`    ${sign}${points}  ${label}`);
    }
  } else {
    console.log("  (no score row)");
  }

  // 3. Touchpoints breakdown
  console.log("\n--- TOUCHPOINTS by source & type ---");
  const { data: tpAll } = await admin
    .from("fact_touchpoint")
    .select("source, event_type")
    .eq("lead_id", LEAD_ID)
    .limit(5000);
  const byKey = new Map<string, number>();
  for (const t of tpAll || []) {
    const k = `${t.source}/${t.event_type}`;
    byKey.set(k, (byKey.get(k) || 0) + 1);
  }
  const sorted = [...byKey.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sorted) {
    console.log(`  ${k.padEnd(30)} ${v}`);
  }
  console.log(`  TOTAL: ${tpAll?.length || 0}`);

  // 4. Recent timeline (last 20)
  console.log("\n--- LATEST 20 TOUCHPOINTS ---");
  const { data: recent } = await admin
    .from("fact_touchpoint")
    .select("source, event_type, title, occurred_at")
    .eq("lead_id", LEAD_ID)
    .order("occurred_at", { ascending: false })
    .limit(20);
  for (const r of recent || []) {
    const ms = Date.now() - new Date(r.occurred_at).getTime();
    let rel: string;
    if (ms < 3600_000) rel = `${Math.floor(ms / 60_000)}p`;
    else if (ms < 86400_000) rel = `${Math.floor(ms / 3600_000)}h`;
    else rel = `${Math.floor(ms / 86400_000)}d`;
    console.log(`  [${rel.padEnd(4)}] (${r.source}/${r.event_type}) ${(r.title || "").slice(0, 80)}`);
  }
}

main().catch(console.error);
