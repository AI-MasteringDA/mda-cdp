import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  const { data } = await admin
    .from("fact_lead_score")
    .select("hot_score, hot_reasons, dim_lead!inner(full_name, email, stage, chat_count, chat_staff_count, source_count, last_chat_at, last_chat_staff_at, last_engagement_at)")
    .eq("scored_at", today)
    .order("hot_score", { ascending: false })
    .limit(30);

  console.log("\n⭐ Top 30 leads by score:\n");
  data?.forEach((s: any, i) => {
    const l = s.dim_lead;
    const chatDays = l?.last_chat_at ? Math.floor((Date.now() - new Date(l.last_chat_at).getTime()) / 86400000) : '—';
    const replyDays = l?.last_chat_staff_at ? Math.floor((Date.now() - new Date(l.last_chat_staff_at).getTime()) / 86400000) : '—';
    const engageDays = l?.last_engagement_at ? Math.floor((Date.now() - new Date(l.last_engagement_at).getTime()) / 86400000) : '—';
    const reasons = (s.hot_reasons as any[])?.map(r => `${r.sign}${r.points}`).join(' ') || '';
    console.log(`${(i+1).toString().padStart(2)}. ${s.hot_score.toString().padStart(3)} | ${(l?.full_name || '—').slice(0, 25).padEnd(25)} | chat=${l?.chat_count}(${chatDays}d) tvv=${l?.chat_staff_count}(${replyDays}d) src=${l?.source_count} silent=${engageDays}d | ${reasons}`);
  });

  // Distribution by 10-point buckets
  const { data: all } = await admin.from("fact_lead_score")
    .select("hot_score").eq("scored_at", today);
  const buckets: Record<string, number> = {};
  all?.forEach(s => {
    const b = `${Math.floor(s.hot_score / 10) * 10}-${Math.floor(s.hot_score / 10) * 10 + 9}`;
    buckets[b] = (buckets[b] || 0) + 1;
  });
  console.log("\n📊 Distribution by 10-point buckets:");
  Object.entries(buckets).sort((a, b) => Number(b[0].split('-')[0]) - Number(a[0].split('-')[0]))
    .forEach(([b, c]) => {
      console.log(`   ${b.padEnd(6)}: ${'█'.repeat(Math.min(Math.floor(c / 30), 40))} ${c}`);
    });
}

main().catch(console.error);
