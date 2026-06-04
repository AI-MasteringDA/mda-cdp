import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  // 1) Sample attachment events to see structure
  const { data: attachments } = await admin
    .from("fact_touchpoint")
    .select("*")
    .eq("event_type", "attachment")
    .limit(10);

  console.log(`📎 Sample attachment events:\n`);
  for (const a of attachments ?? []) {
    console.log(`[${a.occurred_at.slice(0, 16)}] source=${a.source}`);
    console.log(`   title:   "${a.title?.slice(0, 80)}"`);
    console.log(`   payload: ${JSON.stringify(a.payload).slice(0, 200)}`);
    console.log();
  }

  // 2) Check Thúy An's attachments specifically
  const { data: thuyAnAttach } = await admin
    .from("fact_touchpoint")
    .select("*")
    .eq("lead_id", "eaf1252d-ac68-47f3-9779-a5df9600ee22")
    .eq("event_type", "attachment")
    .order("occurred_at", { ascending: false })
    .limit(5);

  console.log(`\n🎯 Thúy An's attachments:`);
  for (const a of thuyAnAttach ?? []) {
    console.log(`[${a.occurred_at.slice(0, 16)}]`);
    console.log(`   title:   "${a.title}"`);
    console.log(`   payload.sender_is_staff: ${(a.payload as { sender_is_staff?: boolean })?.sender_is_staff}`);
    console.log(`   payload.last_msg_at: ${(a.payload as { last_msg_at?: string })?.last_msg_at}`);
    console.log(`   payload.last_customer_msg_at: ${(a.payload as { last_customer_msg_at?: string })?.last_customer_msg_at}`);
    console.log(`   payload.thread_id: ${(a.payload as { thread_id?: string })?.thread_id}`);
    console.log();
  }

  // 3) Count attachments by source + by classification possibility
  const { count: totalAttach } = await admin
    .from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("event_type", "attachment");
  console.log(`\n📊 Total attachments: ${totalAttach}`);

  // Sample 200 attachments to check payload fields
  const { data: sample } = await admin
    .from("fact_touchpoint")
    .select("payload")
    .eq("event_type", "attachment")
    .limit(500);
  let withSenderField = 0;
  let staffAttach = 0;
  let leadAttach = 0;
  let unknown = 0;
  for (const a of sample ?? []) {
    const p = a.payload as { sender_is_staff?: boolean; last_msg_at?: string; last_customer_msg_at?: string };
    if (p?.sender_is_staff !== undefined) {
      withSenderField++;
      if (p.sender_is_staff) staffAttach++;
      else leadAttach++;
    } else if (p?.last_msg_at && p?.last_customer_msg_at) {
      // Can be classified by timestamp comparison
      const staff = new Date(p.last_msg_at) > new Date(p.last_customer_msg_at);
      if (staff) staffAttach++;
      else leadAttach++;
    } else {
      unknown++;
    }
  }
  console.log(`\nClassification possibility (sample 500):`);
  console.log(`   With sender_is_staff field: ${withSenderField}`);
  console.log(`   → STAFF attachments:        ${staffAttach}`);
  console.log(`   → LEAD attachments:         ${leadAttach}`);
  console.log(`   ⚠ Unknown (no metadata):    ${unknown}`);
}

main().catch(console.error);
