import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  // Get Linh
  const { data: lead } = await admin
    .from("dim_lead")
    .select("*")
    .eq("email", "linhlt2@bsc.com.vn")
    .maybeSingle();

  if (!lead) { console.log("Lead not found"); return; }

  console.log("👤 LEAD PROFILE:");
  console.log(`   Name:        ${lead.full_name}`);
  console.log(`   Email:       ${lead.email}`);
  console.log(`   Phone:       ${lead.phone}`);
  console.log(`   Source:      ${lead.source}`);
  console.log(`   Lead source: ${lead.lead_source}`);
  console.log(`   Company:     ${lead.company}`);
  console.log(`   Assignee:    ${lead.assignee}`);
  console.log(`   Stage:       ${lead.stage}`);
  console.log(`   First seen:  ${lead.first_seen_at}`);

  console.log("\n📊 AGGREGATES (cached on dim_lead):");
  console.log(`   total_touchpoints:     ${lead.total_touchpoints}`);
  console.log(`   email_received_count:  ${lead.email_received_count}`);
  console.log(`   email_open_count:      ${lead.email_open_count}`);
  console.log(`   email_click_count:     ${lead.email_click_count}`);
  console.log(`   chat_count (lead):     ${lead.chat_count}`);
  console.log(`   chat_staff_count(TVV): ${lead.chat_staff_count}`);
  console.log(`   engagement_count:      ${lead.engagement_count}`);
  console.log(`   conversion_count:      ${lead.conversion_count}`);
  console.log(`   source_count (real):   ${lead.source_count}`);
  console.log(`   last_chat_at:          ${lead.last_chat_at}`);
  console.log(`   last_chat_staff_at:    ${lead.last_chat_staff_at}`);
  console.log(`   last_email_at:         ${lead.last_email_at}`);
  console.log(`   last_engagement_at:    ${lead.last_engagement_at}`);

  console.log("\n📅 ALL TOUCHPOINTS (timeline):");
  const { data: tps } = await admin
    .from("fact_touchpoint")
    .select("source, event_type, title, occurred_at, payload")
    .eq("lead_id", lead.lead_id)
    .order("occurred_at", { ascending: false });
  tps?.forEach((t, i) => {
    const p = t.payload as any;
    console.log(`   ${i+1}. [${t.source}/${t.event_type}] ${t.occurred_at?.slice(0, 19)}`);
    console.log(`      title: ${t.title?.slice(0, 80)}`);
    if (p?.platform) console.log(`      platform: ${p.platform}, sender_is_staff: ${p.sender_is_staff}`);
  });

  console.log("\n🎯 SCORE BREAKDOWN:");
  const { data: score } = await admin
    .from("fact_lead_score")
    .select("hot_score, hot_reasons")
    .eq("lead_id", lead.lead_id)
    .eq("scored_at", new Date().toISOString().slice(0, 10))
    .maybeSingle();
  if (score) {
    console.log(`   Total: ${score.hot_score}/100`);
    console.log(`   Reasons:`);
    (score.hot_reasons as any[])?.forEach((r) => {
      console.log(`     ${r.sign} ${r.points} pts — ${r.label}`);
    });
  }

  // Analyze WHY hot
  console.log("\n🤔 ANALYSIS:");
  const now = Date.now();
  const lastChatStaff = lead.last_chat_staff_at ? new Date(lead.last_chat_staff_at).getTime() : 0;
  const daysAgo = lastChatStaff ? ((now - lastChatStaff) / 86400000).toFixed(1) : "—";
  console.log(`   TVV chat lần cuối: ${daysAgo} ngày trước → ${Number(daysAgo) <= 3 ? "✅ trigger +20" : "❌ ngoài 3 ngày"}`);

  const sources = new Set();
  tps?.forEach(t => {
    if (["chat","chat_staff","email_open","email_click","call","meeting","form_submit","page_view","conversion"].includes(t.event_type)) {
      sources.add(t.source);
    }
  });
  console.log(`   Engaged sources (>= 2 cần): ${[...sources].join(", ")} = ${sources.size} → ${sources.size >= 2 ? "✅ trigger +20" : "❌ chỉ 1 nguồn"}`);
}

main().catch(console.error);
