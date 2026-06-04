import { config } from "dotenv";
import { resolve } from "path";
import { readFileSync } from "fs";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  // ─── Step 1: Snapshot BEFORE
  console.log("📊 BEFORE FIX:\n");

  const { count: chatBefore } = await admin
    .from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("event_type", "chat");
  const { count: emptyChats } = await admin
    .from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("event_type", "chat")
    .or("title.ilike.Đã gửi tệp%,title.ilike.📎%,title.ilike.Chat: 📎%,title.ilike.Chat: Đã gửi tệp%,detail.ilike.Không có nội dung text%");
  const { count: hotBefore } = await admin
    .from("fact_lead_score")
    .select("*", { count: "exact", head: true })
    .gte("hot_score", 70);

  console.log(`   Total chat events:                 ${chatBefore}`);
  console.log(`   Empty/file-only chat (will reclassify): ${emptyChats}`);
  console.log(`   NÓNG leads:                        ${hotBefore}`);

  // ─── Step 2: Reclassify empty chats → attachment (batch update)
  console.log(`\n🔄 Reclassifying empty chat events to attachment...`);
  // Fetch IDs in batches (Supabase update has issues with .or filter for bulk update)
  const idsToUpdate: { id: string; title: string }[] = [];
  let from = 0;
  while (true) {
    const { data } = await admin
      .from("fact_touchpoint")
      .select("id, title")
      .eq("event_type", "chat")
      .or("title.ilike.Đã gửi tệp%,title.ilike.📎%,title.ilike.Chat: 📎%,title.ilike.Chat: Đã gửi tệp%,detail.ilike.Không có nội dung text%")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    idsToUpdate.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`   Found ${idsToUpdate.length} events to reclassify`);

  // Batch update — use raw SQL via a simple update per chunk
  const BATCH = 200;
  let updated = 0;
  for (let i = 0; i < idsToUpdate.length; i += BATCH) {
    const batch = idsToUpdate.slice(i, i + BATCH).map((r) => r.id);
    const { error } = await admin
      .from("fact_touchpoint")
      .update({ event_type: "attachment" })
      .in("id", batch);
    if (error) {
      console.error(`   ❌ Batch ${i}: ${error.message}`);
    } else {
      updated += batch.length;
    }
    if (i % (BATCH * 10) === 0 && i > 0) {
      console.log(`   Progress: ${updated}/${idsToUpdate.length}`);
    }
  }
  console.log(`   ✅ Reclassified ${updated} events`);

  // ─── Step 3: Apply tightened recompute_lead_aggregates function via SQL
  console.log(`\n🔧 Updating recompute_lead_aggregates() function...`);
  const sqlPath = resolve(process.cwd(), "supabase/fix-empty-chat-classification.sql");
  const fullSql = readFileSync(sqlPath, "utf8");
  // Extract just the CREATE OR REPLACE FUNCTION block
  const fnMatch = fullSql.match(/CREATE OR REPLACE FUNCTION recompute_lead_aggregates[\s\S]*?LANGUAGE plpgsql SECURITY DEFINER;/);
  if (!fnMatch) {
    console.error("   ❌ Could not find function in SQL file");
    process.exit(1);
  }
  // Supabase admin client doesn't support raw DDL via .rpc unless we wrap.
  // Use the supabase-js raw query via REST API (postgres feature)
  const { error: fnError } = await admin.rpc("exec_sql", { sql: fnMatch[0] }).single();
  if (fnError) {
    console.warn(`   ⚠️ exec_sql RPC not available: ${fnError.message}`);
    console.warn(`   → Function update SKIPPED. You must run supabase/fix-empty-chat-classification.sql manually in Supabase SQL editor.`);
  } else {
    console.log(`   ✅ Function updated`);
  }

  // ─── Step 4: Recompute aggregates + scores
  console.log(`\n♻️  Recomputing aggregates...`);
  const { data: aggResult, error: aggErr } = await admin.rpc("recompute_lead_aggregates");
  if (aggErr) {
    console.error(`   ❌ ${aggErr.message}`);
  } else {
    console.log(`   ✅ Updated ${aggResult} leads`);
  }

  console.log(`\n♻️  Recomputing scores...`);
  const { data: scoreResult, error: scoreErr } = await admin.rpc("recompute_lead_scores");
  if (scoreErr) {
    console.error(`   ❌ ${scoreErr.message}`);
  } else {
    console.log(`   ✅ Scored ${(scoreResult as unknown[])?.length ?? 0} leads`);
  }

  // ─── Step 5: AFTER snapshot
  console.log(`\n📊 AFTER FIX:\n`);
  const { count: chatAfter } = await admin
    .from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("event_type", "chat");
  const { count: hotAfter } = await admin
    .from("fact_lead_score")
    .select("*", { count: "exact", head: true })
    .gte("hot_score", 70);

  console.log(`   Total chat events:    ${chatAfter}  (was ${chatBefore})`);
  console.log(`   NÓNG leads:           ${hotAfter}   (was ${hotBefore})`);
  console.log(`   Δ Chat events:        ${(chatBefore ?? 0) - (chatAfter ?? 0)} reclassified`);
  console.log(`   Δ NÓNG leads:         ${(hotBefore ?? 0) - (hotAfter ?? 0)} demoted to ẤM/MÁT`);

  // Tier distribution
  console.log(`\n📊 New tier distribution:`);
  for (const tier of [
    { name: "NÓNG", min: 70, max: 100 },
    { name: "ẤM", min: 40, max: 69 },
    { name: "MÁT", min: 20, max: 39 },
    { name: "NGỦ ĐÔNG", min: 0, max: 19 },
  ]) {
    const { count } = await admin
      .from("fact_lead_score")
      .select("*", { count: "exact", head: true })
      .gte("hot_score", tier.min)
      .lte("hot_score", tier.max);
    console.log(`   ${tier.name.padEnd(10)}: ${count}`);
  }

  // Verify Thúy An
  console.log(`\n🎯 Lead Thúy An verification:`);
  const { data: lead } = await admin
    .from("dim_lead")
    .select("full_name, chat_count, chat_staff_count, last_chat_at")
    .eq("lead_id", "eaf1252d-ac68-47f3-9779-a5df9600ee22")
    .single();
  const { data: score } = await admin
    .from("fact_lead_score")
    .select("hot_score, hot_reasons")
    .eq("lead_id", "eaf1252d-ac68-47f3-9779-a5df9600ee22")
    .order("scored_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  console.log(`   Name:             ${lead?.full_name}`);
  console.log(`   chat_count:       ${lead?.chat_count} (was 1)`);
  console.log(`   chat_staff_count: ${lead?.chat_staff_count}`);
  console.log(`   last_chat_at:     ${lead?.last_chat_at}`);
  console.log(`   hot_score:        ${score?.hot_score} (was 100)`);
  console.log(`   reasons:`);
  for (const r of (score?.hot_reasons as { sign: string; label: string; points: number }[] | undefined) ?? []) {
    console.log(`     ${r.sign}${r.points} ${r.label}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
