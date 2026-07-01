import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  // 1) Snapshot SF data after dedupe
  console.log("📊 SF touchpoints by event_type:");
  const byType: Record<string, number> = {};
  let from = 0;
  while (from < 1_000_000) {
    const { data } = await admin
      .from("fact_touchpoint")
      .select("event_type")
      .eq("source", "salesforce")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const r of data) byType[r.event_type] = (byType[r.event_type] ?? 0) + 1;
    if (data.length < 1000) break;
    from += 1000;
  }
  for (const [k, v] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${k.padEnd(20)}: ${v.toLocaleString("vi-VN")}`);
  }

  // 2) Recompute aggregates
  console.log("\n♻️  Recomputing dim_lead aggregates...");
  const { data: aggResult, error: aggErr } = await admin.rpc("recompute_lead_aggregates");
  if (aggErr) console.error("   ❌", aggErr.message);
  else console.log(`   ✅ Updated ${aggResult} leads`);

  // 3) Recompute scores
  console.log("\n♻️  Recomputing scores...");
  const { data: scoreResult, error: scoreErr } = await admin.rpc("recompute_lead_scores");
  if (scoreErr) console.error("   ❌", scoreErr.message);
  else console.log(`   ✅ Scored ${(scoreResult as unknown[])?.length ?? 0} leads`);

  // 4) Clear AI cache (insights based on old wrong data)
  console.log("\n🗑️  Clearing ai_cache...");
  const { error: clearErr } = await admin
    .from("ai_cache")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (clearErr) console.error("   ❌", clearErr.message);
  else console.log("   ✅ All cached AI insights cleared (next gen uses fresh data)");

  // 5) Verify Nguyễn Tuấn Ngọc
  console.log("\n🎯 Verify lead Nguyễn Tuấn Ngọc:");
  const { data: lead } = await admin
    .from("dim_lead")
    .select("full_name, email_received_count, email_open_count, chat_count, chat_staff_count, total_touchpoints")
    .eq("email", "jeanwork2012@gmail.com")
    .single();
  if (lead) {
    console.log(`   email_received_count:  ${lead.email_received_count}  (was 6 stale, should ~5)`);
    console.log(`   email_open_count:      ${lead.email_open_count}`);
    console.log(`   chat_count:            ${lead.chat_count}`);
    console.log(`   chat_staff_count:      ${lead.chat_staff_count}`);
    console.log(`   total_touchpoints:     ${lead.total_touchpoints}`);
  }

  // 6) Sample 5 hot leads
  console.log("\n🎯 Sample 5 hot leads aggregates:");
  const today = new Date().toISOString().slice(0, 10);
  const { data: hots } = await admin
    .from("fact_lead_score")
    .select("lead_id, hot_score")
    .eq("scored_at", today)
    .gte("hot_score", 70)
    .order("hot_score", { ascending: false })
    .limit(5);
  for (const h of hots ?? []) {
    const { data: l } = await admin
      .from("dim_lead")
      .select("full_name, email_received_count, chat_count, chat_staff_count")
      .eq("lead_id", h.lead_id)
      .single();
    console.log(`   ${(l?.full_name || "—").padEnd(30)} score=${h.hot_score} email=${l?.email_received_count} chat=${l?.chat_count} tvv=${l?.chat_staff_count}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
