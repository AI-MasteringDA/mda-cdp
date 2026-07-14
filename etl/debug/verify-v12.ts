import { admin } from "../lib/supabase-admin";

const norm = (t: string) => t.toLowerCase().replace(/[\s_-]/g, "");

async function main() {
  const { data: latest } = await admin.from("fact_lead_score")
    .select("scored_at").order("scored_at", { ascending: false }).limit(1);
  const scoredAt = latest?.[0]?.scored_at;
  console.log(`Scoring ngày: ${scoredAt}\n`);

  // Lead NÓNG
  const hot: string[] = [];
  let from = 0;
  while (from < 20000) {
    const { data } = await admin.from("fact_lead_score")
      .select("lead_id").eq("scored_at", scoredAt).gte("hot_score", 70).range(from, from + 999);
    if (!data?.length) break;
    hot.push(...data.map(d => d.lead_id));
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Tổng lead NÓNG: ${hot.length}`);

  // Trong đó: bao nhiêu do tag SMAX, bao nhiêu có hành vi thật
  let smaxTagged = 0, sfTagged = 0, engaged = 0, silentTagged = 0;
  for (let i = 0; i < hot.length; i += 100) {
    const batch = hot.slice(i, i + 100);
    const { data } = await admin.from("dim_lead")
      .select("smax_tags, sf_rating, chat_count, email_click_count, email_reply_count, form_submit_count, conversion_count")
      .in("lead_id", batch);
    for (const l of data ?? []) {
      const tags = (l.smax_tags as string[]) ?? [];
      const isSmaxHot = tags.some(t => norm(t) === "hotlead");
      const isSfHot = l.sf_rating === "Hot";
      const hasBehavior = (l.chat_count ?? 0) + (l.email_click_count ?? 0) + (l.email_reply_count ?? 0)
        + (l.form_submit_count ?? 0) + (l.conversion_count ?? 0) > 0;
      if (isSmaxHot) smaxTagged++;
      if (isSfHot) sfTagged++;
      if (hasBehavior) engaged++;
      if ((isSmaxHot || isSfHot) && !hasBehavior) silentTagged++;
    }
  }
  console.log(`   ├─ tag SMAX "Hot Lead":     ${smaxTagged}`);
  console.log(`   ├─ SF Rating = Hot:         ${sfTagged}`);
  console.log(`   ├─ ✅ CÓ hành vi thật:       ${engaged}   ← bộ lọc "Có hành vi"`);
  console.log(`   └─ ⚠️  tag NÓNG nhưng im lặng: ${silentTagged}   ← bộ lọc "Chỉ có tag"`);
}
main().catch(e => { console.error(e); process.exit(1); });
