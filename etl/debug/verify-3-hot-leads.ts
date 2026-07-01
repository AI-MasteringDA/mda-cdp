import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  const { data: hot } = await admin
    .from("fact_lead_score")
    .select("hot_score, hot_reasons, dim_lead!inner(lead_id, full_name, email, stage, assignee, lead_source, chat_count, chat_staff_count, source_count, last_chat_at, last_chat_staff_at, last_engagement_at)")
    .eq("scored_at", today)
    .gte("hot_score", 70)
    .order("hot_score", { ascending: false });

  console.log(`\n🔥 Total NÓNG leads (score >= 70): ${hot?.length ?? 0}\n`);
  hot?.forEach((s: any, i) => {
    const l = s.dim_lead;
    console.log(`─── ${i+1}. Score ${s.hot_score} ───────────────────`);
    console.log(`  Name:     ${l?.full_name}`);
    console.log(`  Email:    ${l?.email}`);
    console.log(`  Stage:    ${l?.stage}`);
    console.log(`  Source:   ${l?.lead_source} · TVV: ${l?.assignee}`);
    console.log(`  Chat:     lead=${l?.chat_count} staff=${l?.chat_staff_count}`);
    console.log(`  Sources:  ${l?.source_count} kênh engaged`);
    console.log(`  Last chat:      ${l?.last_chat_at || '—'}`);
    console.log(`  Last TVV chat:  ${l?.last_chat_staff_at || '—'}`);
    console.log(`  Reasons:`);
    (s.hot_reasons as any[])?.forEach(r => {
      console.log(`     ${r.sign}${r.points} — ${r.label}`);
    });
    console.log("");
  });

  // Broader stats
  const { data: all } = await admin.from("fact_lead_score")
    .select("hot_score").eq("scored_at", today);
  const buckets = { NONG: 0, AM_high: 0, AM_low: 0, LANH_high: 0, LANH_low: 0 };
  all?.forEach(s => {
    if (s.hot_score >= 70) buckets.NONG++;
    else if (s.hot_score >= 55) buckets.AM_high++;
    else if (s.hot_score >= 40) buckets.AM_low++;
    else if (s.hot_score >= 25) buckets.LANH_high++;
    else buckets.LANH_low++;
  });
  console.log(`📊 Score distribution:`);
  console.log(`   🔥 NÓNG (70+):        ${buckets.NONG}`);
  console.log(`   ☀️  ẤM cao (55-69):   ${buckets.AM_high}`);
  console.log(`   ☀️  ẤM thấp (40-54):  ${buckets.AM_low}`);
  console.log(`   ❄️  LẠNH mát (25-39): ${buckets.LANH_high}`);
  console.log(`   ❄️  LẠNH đông (<25):  ${buckets.LANH_low}`);
}

main().catch(console.error);
