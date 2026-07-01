import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  const { data: lead } = await admin
    .from("dim_lead")
    .select("lead_id")
    .eq("email", "jeanwork2012@gmail.com")
    .single();

  const { data: emails } = await admin
    .from("fact_touchpoint")
    .select("title, occurred_at, payload")
    .eq("lead_id", lead!.lead_id)
    .eq("event_type", "email_sent")
    .order("occurred_at", { ascending: false });

  console.log(`📧 Total email_sent rows trong DB: ${emails?.length}`);

  // Group by task_id (SF unique ID)
  const byTaskId: Record<string, { count: number; title: string; firstDate: string }> = {};
  for (const e of emails ?? []) {
    const tid = (e.payload as { task_id?: string })?.task_id || "(no task_id)";
    if (!byTaskId[tid]) byTaskId[tid] = { count: 0, title: e.title, firstDate: e.occurred_at };
    byTaskId[tid].count++;
  }

  console.log(`\n🔍 Số UNIQUE task_id (= email thật): ${Object.keys(byTaskId).length}`);
  console.log(`\n📋 Detail từng email thật:`);
  for (const [tid, info] of Object.entries(byTaskId).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`\n   task_id: ${tid}`);
    console.log(`   Date:     ${info.firstDate.slice(0, 16)}`);
    console.log(`   Subject:  "${info.title.slice(0, 70)}"`);
    console.log(`   Inserted ${info.count} times ← DUPLICATE ${info.count > 1 ? "❌" : "✅"}`);
  }

  // Global view: across ALL leads, how bad is duplication?
  console.log(`\n\n📊 Global salesforce email_sent stats:`);
  const { count: totalSfEmails } = await admin
    .from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("event_type", "email_sent")
    .eq("source", "salesforce");
  console.log(`   Total SF email_sent rows: ${totalSfEmails}`);

  // Sample 5000 SF emails to count unique task_ids
  const { data: sample } = await admin
    .from("fact_touchpoint")
    .select("payload")
    .eq("event_type", "email_sent")
    .eq("source", "salesforce")
    .limit(5000);
  const uniqueTaskIds = new Set<string>();
  let withTaskId = 0;
  for (const e of sample ?? []) {
    const tid = (e.payload as { task_id?: string })?.task_id;
    if (tid) {
      uniqueTaskIds.add(tid);
      withTaskId++;
    }
  }
  console.log(`   Sample 5000 rows → ${uniqueTaskIds.size} unique task_ids`);
  console.log(`   Duplication ratio: ${(withTaskId / Math.max(uniqueTaskIds.size, 1)).toFixed(1)}x`);
  console.log(`   → Estimated real unique SF emails: ~${Math.round((totalSfEmails ?? 0) * uniqueTaskIds.size / withTaskId)}`);
}

main().catch(console.error);
