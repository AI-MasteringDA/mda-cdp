/** 2,709 lead NÓNG trải dài bao lâu? Phân bố theo lần tương tác cuối. */
import { admin } from "../lib/supabase-admin";

async function main() {
  const { data: latest } = await admin.from("fact_lead_score")
    .select("scored_at").order("scored_at", { ascending: false }).limit(1);
  const scoredAt = latest?.[0]?.scored_at;

  const ids: string[] = [];
  let from = 0;
  while (from < 20000) {
    const { data } = await admin.from("fact_lead_score")
      .select("lead_id").eq("scored_at", scoredAt).gte("hot_score", 70).range(from, from + 999);
    if (!data?.length) break;
    ids.push(...data.map(d => d.lead_id));
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Tổng lead NÓNG: ${ids.length}\n`);

  const buckets = [
    { label: "≤ 3 ngày", max: 3, n: 0 },
    { label: "4-7 ngày", max: 7, n: 0 },
    { label: "8-14 ngày", max: 14, n: 0 },
    { label: "15-30 ngày", max: 30, n: 0 },
    { label: "1-3 tháng", max: 90, n: 0 },
    { label: "3-6 tháng", max: 180, n: 0 },
    { label: "6-12 tháng", max: 365, n: 0 },
    { label: "> 1 năm", max: Infinity, n: 0 },
  ];
  let noActivity = 0;
  const byMonth = new Map<string, number>();

  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await admin.from("dim_lead")
      .select("last_engagement_at, last_chat_at, last_email_at, first_seen_at")
      .in("lead_id", ids.slice(i, i + 100));
    for (const l of data ?? []) {
      const iso = l.last_engagement_at ?? l.last_chat_at ?? l.last_email_at ?? l.first_seen_at;
      if (!iso) { noActivity++; continue; }
      const days = (Date.now() - Date.parse(iso)) / 86400_000;
      for (const b of buckets) {
        if (days <= b.max) { b.n++; break; }
      }
      const m = String(iso).slice(0, 7);
      byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
    }
  }

  console.log("Lần tương tác CUỐI của lead NÓNG:");
  let cum = 0;
  for (const b of buckets) {
    cum += b.n;
    const pct = ((b.n / ids.length) * 100).toFixed(1);
    const cumPct = ((cum / ids.length) * 100).toFixed(0);
    const bar = "█".repeat(Math.round((b.n / ids.length) * 40));
    console.log(`  ${b.label.padEnd(12)} ${String(b.n).padStart(5)}  (${pct.padStart(4)}%)  cộng dồn ${cumPct.padStart(3)}%  ${bar}`);
  }
  if (noActivity) console.log(`  không có mốc nào: ${noActivity}`);

  console.log("\nTheo tháng:");
  [...byMonth.entries()].sort().reverse().slice(0, 14)
    .forEach(([m, n]) => console.log(`  ${m}: ${String(n).padStart(5)}`));
}
main().catch(e => { console.error(e); process.exit(1); });
