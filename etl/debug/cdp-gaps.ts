import { admin } from "../lib/supabase-admin";

async function main() {
  // A. SMAX: bao nhiêu lead có thể nối vào journey?
  let smaxTotal = 0, smaxWithContact = 0, smaxAnon = 0;
  let from = 0;
  while (from < 30000) {
    const { data } = await admin.from("dim_lead")
      .select("email, phone").eq("source", "smax").range(from, from + 999);
    if (!data?.length) break;
    for (const l of data) {
      smaxTotal++;
      if (l.email || l.phone) smaxWithContact++; else smaxAnon++;
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log("A. SMAX — khả năng nối journey");
  console.log(`   tổng lead smax:        ${smaxTotal}`);
  console.log(`   có email/phone:        ${smaxWithContact}  (${((smaxWithContact / smaxTotal) * 100).toFixed(1)}%)  → nối được`);
  console.log(`   ẩn danh (chat only):   ${smaxAnon}  (${((smaxAnon / smaxTotal) * 100).toFixed(1)}%)  → KHÔNG nối được`);

  // B. Tag trùng lặp (name vs alias)
  const tagCount = new Map<string, number>();
  from = 0;
  while (from < 30000) {
    const { data } = await admin.from("dim_lead")
      .select("smax_tags").not("smax_tags", "is", null).range(from, from + 999);
    if (!data?.length) break;
    for (const l of data) for (const t of (l.smax_tags as string[]) ?? []) {
      tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  // Cặp trùng: "Hot Lead" vs "hot-lead"
  const norm = (t: string) => t.toLowerCase().replace(/[\s_-]/g, "");
  const groups = new Map<string, string[]>();
  for (const t of tagCount.keys()) {
    const k = norm(t);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const dupes = [...groups.values()].filter(v => v.length > 1);
  console.log(`\nB. Tag SMAX — trùng dạng name vs alias`);
  console.log(`   tổng tag khác nhau:   ${tagCount.size}`);
  console.log(`   nhóm bị trùng:        ${dupes.length}`);
  dupes.slice(0, 8).forEach(v =>
    console.log(`      ${v.map(t => `"${t}"(${tagCount.get(t)})`).join("  ≡  ")}`));

  // C. Instantly 13/07 hàng loạt?
  const { count: jul13 } = await admin.from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("source", "instantly").gte("occurred_at", "2026-07-13T00:00:00Z").lt("occurred_at", "2026-07-14T00:00:00Z");
  const { data: sample } = await admin.from("fact_touchpoint")
    .select("title, detail, payload").eq("source", "instantly")
    .gte("occurred_at", "2026-07-13T00:00:00Z").limit(2);
  console.log(`\nC. Instantly ngày 13/07: ${jul13} touchpoints`);
  sample?.forEach(s => console.log(`   title="${s.title}"  payload=${JSON.stringify(s.payload).slice(0, 110)}`));

  // D. Scoring có tươi không
  const { data: sc } = await admin.from("fact_lead_score")
    .select("scored_at").order("scored_at", { ascending: false }).limit(1);
  const days = sc?.[0] ? Math.round((Date.now() - Date.parse(sc[0].scored_at)) / 86400_000) : null;
  console.log(`\nD. Scoring mới nhất: ${sc?.[0]?.scored_at} (${days} ngày trước)`);
}
main().catch(e => { console.error(e); process.exit(1); });
