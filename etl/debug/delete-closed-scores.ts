import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  // Get all lead_ids that are Đã chốt
  const closedIds = new Set<string>();
  let from = 0;
  while (true) {
    const { data } = await admin
      .from("dim_lead")
      .select("lead_id")
      .eq("stage", "Đã chốt")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const r of data) closedIds.add(r.lead_id);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Found ${closedIds.size} closed leads`);

  // Delete their score rows in batches of 100
  const ids = [...closedIds];
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const { error } = await admin
      .from("fact_lead_score")
      .delete()
      .in("lead_id", batch);
    if (error) { console.error(`   ❌ ${error.message}`); break; }
    deleted += batch.length;
  }
  console.log(`✅ Deleted ${deleted} old score rows for closed leads`);

  // Verify top 5 hot leads now
  console.log("\n⭐ Top 5 hot leads FINAL:");
  const today = new Date().toISOString().slice(0, 10);
  const { data: top } = await admin
    .from("fact_lead_score")
    .select("hot_score, dim_lead!inner(full_name, email, stage, conversion_count, chat_count, chat_staff_count, email_open_count, source_count)")
    .eq("scored_at", today)
    .order("hot_score", { ascending: false })
    .limit(5);
  top?.forEach((s: any, i) => {
    const l = s.dim_lead;
    console.log(`   ${i+1}. ${(l?.full_name || '—').padEnd(25)} score=${s.hot_score} stage=${(l?.stage || '').padEnd(12)} conv=${l?.conversion_count} chat=${l?.chat_count}+${l?.chat_staff_count}TVV open=${l?.email_open_count} sources=${l?.source_count}`);
  });

  // Tier distribution
  const { data: all } = await admin
    .from("fact_lead_score").select("hot_score").eq("scored_at", today);
  const NONG = all?.filter(s => s.hot_score >= 70).length ?? 0;
  const AM = all?.filter(s => s.hot_score >= 40 && s.hot_score < 70).length ?? 0;
  const LANH = all?.filter(s => s.hot_score < 40).length ?? 0;
  console.log(`\n🔥 Tier distribution: NÓNG=${NONG} | ẤM=${AM} | LẠNH=${LANH}`);
}

main().catch(console.error);
