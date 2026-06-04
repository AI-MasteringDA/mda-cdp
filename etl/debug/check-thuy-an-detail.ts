import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  const { data: tps } = await admin
    .from("fact_touchpoint")
    .select("*")
    .eq("lead_id", "eaf1252d-ac68-47f3-9779-a5df9600ee22")
    .order("occurred_at", { ascending: false });

  console.log(`Total: ${tps?.length} touchpoints\n`);

  // Find the single "chat" (lead chat) event
  const leadChats = (tps ?? []).filter((t) => t.event_type === "chat");
  console.log(`👤 LEAD CHAT events: ${leadChats.length}`);
  for (const t of leadChats) {
    console.log(`   [${t.occurred_at.slice(0, 16)}] event=${t.event_type}`);
    console.log(`   title: "${t.title}"`);
    console.log(`   detail: ${t.detail ? `"${t.detail.slice(0, 100)}"` : "NULL"}`);
    console.log(`   payload sender_is_staff: ${(t.payload as { sender_is_staff?: boolean })?.sender_is_staff}`);
    console.log(`   payload message: "${(t.payload as { message?: string })?.message?.slice(0, 80) ?? "(none)"}"`);
    console.log(`   payload last_msg_at: ${(t.payload as { last_msg_at?: string })?.last_msg_at}`);
    console.log(`   payload last_customer_msg_at: ${(t.payload as { last_customer_msg_at?: string })?.last_customer_msg_at}`);
  }

  console.log(`\n💼 TVV CHAT (chat_staff) events:`);
  const staffChats = (tps ?? []).filter((t) => t.event_type === "chat_staff");
  for (const t of staffChats.slice(0, 3)) {
    console.log(`   [${t.occurred_at.slice(0, 16)}] title: "${t.title?.slice(0, 80)}"`);
  }

  console.log(`\n📎 ATTACHMENT events:`);
  const attachments = (tps ?? []).filter((t) => t.event_type === "attachment");
  console.log(`   Count: ${attachments.length}`);
  for (const t of attachments.slice(0, 3)) {
    console.log(`   [${t.occurred_at.slice(0, 16)}] title: "${t.title}"`);
  }
}

main().catch(console.error);
