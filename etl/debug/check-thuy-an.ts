import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  // Find by email
  const { data: lead } = await admin
    .from("dim_lead")
    .select("*")
    .eq("email", "annguyen9210@gmail.com")
    .maybeSingle();
  if (!lead) { console.log("Not found"); return; }

  console.log(`📋 Lead: ${lead.full_name}`);
  console.log(`   ID: ${lead.lead_id}`);
  console.log(`   chat_count (lead chat):        ${lead.chat_count}`);
  console.log(`   chat_staff_count (TVV chat):   ${lead.chat_staff_count}`);
  console.log(`   email_received_count:          ${lead.email_received_count}`);
  console.log(`   email_open_count:              ${lead.email_open_count}`);
  console.log(`   last_chat_at:                  ${lead.last_chat_at}`);
  console.log(`   last_chat_staff_at:            ${lead.last_chat_staff_at}`);
  console.log(`   last_email_at:                 ${lead.last_email_at}`);
  console.log(`   last_engagement_at:            ${lead.last_engagement_at}`);

  // Breakdown of touchpoints by type
  const { data: tps } = await admin
    .from("fact_touchpoint")
    .select("event_type, source, title, occurred_at")
    .eq("lead_id", lead.lead_id)
    .order("occurred_at", { ascending: false })
    .limit(40);

  console.log(`\n📦 Touchpoints (${tps?.length}):`);
  const byType: Record<string, number> = {};
  for (const t of tps ?? []) {
    byType[t.event_type] = (byType[t.event_type] ?? 0) + 1;
  }
  for (const [k, v] of Object.entries(byType)) {
    console.log(`   ${k.padEnd(20)}: ${v}`);
  }

  // Check what's in last 3 days
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600_000);
  console.log(`\n📅 Events trong 3 ngày qua (since ${threeDaysAgo.toISOString().slice(0, 10)}):`);
  const recent = (tps ?? []).filter((t) => new Date(t.occurred_at) > threeDaysAgo);
  for (const t of recent) {
    console.log(`   [${t.occurred_at.slice(0, 16)}] ${t.event_type.padEnd(14)} | ${t.title?.slice(0, 70)}`);
  }
  const chatStaffRecent = recent.filter((t) => t.event_type === "chat_staff").length;
  const chatRecent = recent.filter((t) => t.event_type === "chat").length;
  console.log(`\n🔢 Summary trong 3 ngày:`);
  console.log(`   chat (lead nhắn):       ${chatRecent}`);
  console.log(`   chat_staff (TVV nhắn):  ${chatStaffRecent}`);
}

main().catch(console.error);
