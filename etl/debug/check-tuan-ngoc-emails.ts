import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  const { data: lead } = await admin
    .from("dim_lead")
    .select("*")
    .eq("email", "jeanwork2012@gmail.com")
    .maybeSingle();
  if (!lead) { console.log("Not found"); return; }

  console.log(`📋 Lead: ${lead.full_name} (${lead.lead_id})`);
  console.log(`   email_received_count:  ${lead.email_received_count}  (dim_lead aggregate)`);
  console.log(`   email_open_count:      ${lead.email_open_count}`);
  console.log(`   email_click_count:     ${lead.email_click_count}`);
  console.log(`   chat_count:            ${lead.chat_count}`);
  console.log(`   chat_staff_count:      ${lead.chat_staff_count}`);
  console.log(`   total_touchpoints:     ${lead.total_touchpoints}`);
  console.log();

  // Pull ALL touchpoints
  const { data: tps } = await admin
    .from("fact_touchpoint")
    .select("event_type, source, title, occurred_at, payload")
    .eq("lead_id", lead.lead_id)
    .order("occurred_at", { ascending: false });

  console.log(`📦 Total touchpoints in fact_touchpoint: ${tps?.length}`);

  // Group by event_type
  const byType: Record<string, number> = {};
  for (const t of tps ?? []) {
    byType[t.event_type] = (byType[t.event_type] ?? 0) + 1;
  }
  console.log(`\nBreakdown by event_type:`);
  for (const [k, v] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${k.padEnd(20)}: ${v}`);
  }

  // Email events specifically
  const emails = (tps ?? []).filter((t) => t.event_type === "email_sent");
  console.log(`\n📧 Email_sent events (${emails.length}):`);

  // Check if titles are identical (sign of duplicates)
  const titleCounts: Record<string, number> = {};
  for (const e of emails) {
    titleCounts[e.title] = (titleCounts[e.title] ?? 0) + 1;
  }
  console.log(`\n🔍 Distinct email subjects:`);
  for (const [title, count] of Object.entries(titleCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${count}× "${title.slice(0, 80)}"`);
  }

  // Show timestamps to see if these are duplicates or real over time
  console.log(`\n📅 First 10 email timestamps (most recent):`);
  for (const e of emails.slice(0, 10)) {
    console.log(`   ${e.occurred_at.slice(0, 19)}  source=${e.source}`);
  }

  // Check payload for raw_id (Instantly) — dedup signal
  console.log(`\n🆔 Sample payload of first 3 emails:`);
  for (const e of emails.slice(0, 3)) {
    console.log(`   ${e.occurred_at.slice(0, 19)}`);
    console.log(`      payload: ${JSON.stringify(e.payload).slice(0, 200)}`);
  }
}

main().catch(console.error);
