import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  console.log("🔧 Fix converted leads → mark stage = 'Đã chốt'\n");

  // 1. First ensure stage constraint allows 'Đã chốt'
  //    (Attempt update — if constraint blocks, error will show)

  // 2. Get all lead_ids with conversion events
  const convertedLeadIds = new Set<string>();
  let from = 0;
  while (true) {
    const { data } = await admin
      .from("fact_touchpoint")
      .select("lead_id")
      .eq("event_type", "conversion")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const r of data) convertedLeadIds.add(r.lead_id);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Found ${convertedLeadIds.size} leads with conversion events`);

  // 3. Update stage in batches of 100
  const ids = [...convertedLeadIds];
  let updated = 0;
  let failed = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const { error } = await admin
      .from("dim_lead")
      .update({ stage: "Đã chốt" })
      .in("lead_id", batch);
    if (error) {
      console.error(`   ❌ Batch ${i}: ${error.message.slice(0, 100)}`);
      failed += batch.length;
      // Try SQL constraint fix (in case user hasn't run it)
      if (i === 0 && error.message.includes("constraint")) {
        console.log("\n⚠️  Stage constraint chặn. Bạn cần chạy SQL này trước:");
        console.log("   ALTER TABLE dim_lead DROP CONSTRAINT IF EXISTS dim_lead_stage_check;");
        console.log("   ALTER TABLE dim_lead ADD CONSTRAINT dim_lead_stage_check");
        console.log("     CHECK (stage IN ('Mới','Đang tư vấn','Đang cân nhắc','Im lặng','Đã chốt','Ghi danh'));");
        return;
      }
    } else {
      updated += batch.length;
    }
  }
  console.log(`   ✅ Updated ${updated} | Failed ${failed}`);

  // 4. Recompute scores (converted leads now excluded)
  console.log("\n⚙️  Recompute scores...");
  await admin.rpc("recompute_lead_scores");
  console.log("   ✅ Done");

  // 5. New tier distribution
  console.log("\n🔥 New tier distribution:");
  const today = new Date().toISOString().slice(0, 10);
  const { data: scores } = await admin
    .from("fact_lead_score").select("hot_score").eq("scored_at", today);
  if (scores) {
    const NONG = scores.filter(s => s.hot_score >= 70).length;
    const AM = scores.filter(s => s.hot_score >= 40 && s.hot_score < 70).length;
    const LANH = scores.filter(s => s.hot_score < 40).length;
    console.log(`   🔥 NÓNG: ${NONG} | ☀️ ẤM: ${AM} | ❄️ LẠNH: ${LANH}`);
  }

  // 6. Verify: top 5 hot leads should NOT have conversion
  console.log("\n⭐ Top 5 hot leads AFTER fix:");
  const { data: top } = await admin
    .from("fact_lead_score")
    .select("hot_score, dim_lead!inner(full_name, email, stage, conversion_count, chat_count, email_open_count)")
    .eq("scored_at", today)
    .order("hot_score", { ascending: false })
    .limit(5);
  top?.forEach((s: any, i) => {
    const l = s.dim_lead;
    console.log(`   ${i+1}. ${(l?.full_name || '—').padEnd(25)} score=${s.hot_score} stage=${l?.stage} conv=${l?.conversion_count} chat=${l?.chat_count} open=${l?.email_open_count}`);
  });
}

main().catch(console.error);
