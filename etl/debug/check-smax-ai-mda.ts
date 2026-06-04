import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  const { data: lead } = await admin
    .from("dim_lead")
    .select("*")
    .eq("email", "janiedorrisgsd@hotmail.com")
    .maybeSingle();
  if (!lead) { console.log("Not found"); return; }

  console.log(`📋 Lead: ${lead.full_name}`);
  console.log(`   chat_count (LEAD chat):        ${lead.chat_count}`);
  console.log(`   chat_staff_count (TVV chat):   ${lead.chat_staff_count}`);
  console.log(`   last_chat_at (lead nhắn cuối): ${lead.last_chat_at}`);
  console.log(`   last_chat_staff_at (TVV cuối): ${lead.last_chat_staff_at}`);

  const { data: tps } = await admin
    .from("fact_touchpoint")
    .select("event_type, source, title, occurred_at")
    .eq("lead_id", lead.lead_id)
    .order("occurred_at", { ascending: false })
    .limit(30);

  console.log(`\n📦 All touchpoints (most recent first):`);
  for (const t of tps ?? []) {
    const who = t.event_type === "chat" ? "👤 LEAD" :
                t.event_type === "chat_staff" ? "💼 TVV" :
                t.event_type;
    console.log(`   [${t.occurred_at.slice(0, 16)}] ${who.padEnd(10)} | ${t.title?.slice(0, 80)}`);
  }
}

main().catch(console.error);
