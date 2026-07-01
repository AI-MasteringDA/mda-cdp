import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  // Find leads with most SMAX touchpoints
  console.log("🔍 Top 5 leads with most SMAX touchpoints:\n");
  const { data: stats } = await admin
    .from("dim_lead")
    .select("lead_id, full_name, email, chat_staff_count, chat_count")
    .order("chat_staff_count", { ascending: false })
    .limit(5);

  for (const lead of stats || []) {
    const { data: rows } = await admin
      .from("fact_touchpoint")
      .select("title, occurred_at, payload")
      .eq("lead_id", lead.lead_id)
      .eq("source", "smax")
      .order("occurred_at", { ascending: false })
      .limit(10);

    console.log(`👤 ${lead.full_name || '—'} (${lead.email || '—'})`);
    console.log(`   chat_staff_count: ${lead.chat_staff_count}, chat_count: ${lead.chat_count}`);
    console.log(`   Sample 10 SMAX rows:`);

    const messageSig: Record<string, number> = {};
    for (const r of rows || []) {
      const p = r.payload as any;
      const sig = (r.title || '').slice(0, 50);
      messageSig[sig] = (messageSig[sig] || 0) + 1;
      console.log(`     thread_id=${p?.thread_id?.slice(0, 8)}  platform=${p?.platform}  page=${p?.page_pid?.slice(0, 12)}  msg="${(r.title || '').slice(0, 50)}"`);
    }

    // Check if same message appears multiple times across DIFFERENT thread_ids
    const dupMsgs = Object.entries(messageSig).filter(([, c]) => c > 1);
    if (dupMsgs.length > 0) {
      console.log(`   ⚠️ DUPLICATE messages across different thread_ids:`);
      for (const [msg, count] of dupMsgs) {
        console.log(`     "${msg}" × ${count}`);
      }
    }

    // Check unique thread_ids vs total rows
    const { data: allRows } = await admin
      .from("fact_touchpoint")
      .select("payload")
      .eq("lead_id", lead.lead_id)
      .eq("source", "smax");
    const uniqueThreads = new Set();
    for (const r of allRows || []) uniqueThreads.add((r.payload as any)?.thread_id);
    console.log(`   Total SMAX rows: ${allRows?.length} | Unique thread_ids: ${uniqueThreads.size}\n`);
  }
}

main().catch(console.error);
