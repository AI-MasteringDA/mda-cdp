import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  const email = process.argv[2] || "hongngoc.nguyen@jollibee.com.vn";

  const { data: lead } = await admin
    .from("dim_lead")
    .select("*")
    .eq("email", email).maybeSingle();

  if (!lead) { console.log("❌ Lead not found"); return; }

  console.log(`\n👤 ${lead.full_name} (${lead.email})`);
  console.log(`   Phone:   ${lead.phone || '—'}`);
  console.log(`   Company: ${lead.company || '—'}`);
  console.log(`   Stage:   ${lead.stage} · TVV: ${lead.assignee}`);

  console.log("\n📊 AGGREGATES (30 ngày data):");
  console.log(`   Chat lead:          ${lead.chat_count} (last: ${lead.last_chat_at?.slice(0,19) || '—'})`);
  console.log(`   TVV chat:           ${lead.chat_staff_count} (last: ${lead.last_chat_staff_at?.slice(0,19) || '—'})`);
  console.log(`   Email received:     ${lead.email_received_count} (last: ${lead.last_email_at?.slice(0,19) || '—'})`);
  console.log(`   Email opens:        ${lead.email_open_count}`);
  console.log(`   Conversions:        ${lead.conversion_count}`);
  console.log(`   Total engagement:   ${lead.engagement_count}`);
  console.log(`   Sources engaged:    ${lead.source_count}`);
  console.log(`   Last engagement:    ${lead.last_engagement_at?.slice(0,19) || '—'}`);

  console.log("\n📅 TIMELINE (30 gần nhất):");
  const { data: tps } = await admin.from("fact_touchpoint")
    .select("source, event_type, title, occurred_at, payload")
    .eq("lead_id", lead.lead_id)
    .order("occurred_at", { ascending: false })
    .limit(30);
  tps?.forEach((t, i) => {
    console.log(`   ${i+1}. [${t.source}/${t.event_type}] ${t.occurred_at?.slice(0,19)}`);
    console.log(`      ${(t.title || '').slice(0,90)}`);
  });

  console.log("\n🎯 SCORE:");
  const today = new Date().toISOString().slice(0,10);
  const { data: score } = await admin.from("fact_lead_score")
    .select("hot_score, hot_reasons").eq("lead_id", lead.lead_id).eq("scored_at", today).maybeSingle();
  if (score) {
    console.log(`   ${score.hot_score}/100`);
    (score.hot_reasons as any[])?.forEach(r => console.log(`     ${r.sign}${r.points} — ${r.label}`));
  }
}

main().catch(console.error);
