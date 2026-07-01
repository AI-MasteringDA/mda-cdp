import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  console.log("📊 FINAL DB STATE VERIFY\n");

  // 1. Totals per source × event_type
  console.log("Touchpoints breakdown:");
  for (const src of ["salesforce", "smax", "instantly", "web"]) {
    const types = ["email_sent", "email_open", "email_click", "email_reply",
                   "chat", "chat_staff", "lead_created", "conversion", "lost", "form_submit", "page_view"];
    const counts: Record<string, number> = {};
    for (const t of types) {
      const { count } = await admin.from("fact_touchpoint")
        .select("*", { count: "exact", head: true })
        .eq("source", src).eq("event_type", t);
      if (count && count > 0) counts[t] = count;
    }
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    console.log(`  ${src.padEnd(12)} (total ${total.toLocaleString("vi-VN")}):`);
    for (const [t, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`     ${t.padEnd(15)}: ${c.toLocaleString("vi-VN")}`);
    }
  }

  // 2. Total leads
  const { count: leadCount } = await admin.from("dim_lead")
    .select("*", { count: "exact", head: true });
  console.log(`\n👥 dim_lead: ${leadCount?.toLocaleString("vi-VN")} unique leads`);

  // 3. Lead tier distribution
  console.log("\n🔥 Tier distribution (today):");
  const { data: tiers } = await admin.from("fact_lead_score")
    .select("hot_score").eq("scored_at", new Date().toISOString().slice(0, 10));
  if (tiers) {
    const NÓNG = tiers.filter(t => t.hot_score >= 70).length;
    const ẤM = tiers.filter(t => t.hot_score >= 40 && t.hot_score < 70).length;
    const LẠNH = tiers.filter(t => t.hot_score < 40).length;
    console.log(`   🔥 NÓNG (>=70):   ${NÓNG}`);
    console.log(`   ☀️  ẤM (40-69):   ${ẤM}`);
    console.log(`   ❄️  LẠNH (<40):   ${LẠNH}`);
  }

  // 4. Top 5 hot leads
  console.log("\n⭐ Top 5 hot leads:");
  const { data: topHot } = await admin.from("fact_lead_score")
    .select("hot_score, lead_id, dim_lead(full_name, email, chat_count, email_open_count, conversion_count)")
    .eq("scored_at", new Date().toISOString().slice(0, 10))
    .order("hot_score", { ascending: false })
    .limit(5);
  topHot?.forEach((s: any, i) => {
    const l = s.dim_lead;
    console.log(`   ${i+1}. ${(l?.full_name || '—').padEnd(25)} score=${s.hot_score} | chats=${l?.chat_count}, opens=${l?.email_open_count}, convs=${l?.conversion_count}`);
  });

  // 5. Tuan Ngoc verification
  console.log("\n🎯 Tuấn Ngọc verification:");
  const { data: tuan } = await admin.from("dim_lead")
    .select("lead_id, full_name, email_received_count, email_open_count, chat_count, total_touchpoints")
    .eq("email", "jeanwork2012@gmail.com").maybeSingle();
  if (tuan) {
    console.log(`   ${tuan.full_name}: ${tuan.total_touchpoints} touchpoints (was 172+ in old DB)`);
    console.log(`   emails received: ${tuan.email_received_count} (was 132 dups in old DB)`);
    console.log(`   chats: ${tuan.chat_count}, opens: ${tuan.email_open_count}`);
  } else {
    console.log("   (Tuấn Ngọc not in new DB — may not be in last 30 days)");
  }
}

main().catch(console.error);
