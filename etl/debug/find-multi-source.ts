import { admin } from "../lib/supabase-admin";

async function main() {
  console.log("=== Tìm lead xuất hiện ở >= 2 sources (proof of identity merge) ===\n");

  // Bước 1: paginated full pull
  const tpBySource = new Map<string, Set<string>>(); // lead_id -> Set<source>
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from("fact_touchpoint")
      .select("lead_id, source")
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    for (const t of data) {
      if (!t.lead_id || !t.source) continue;
      if (!tpBySource.has(t.lead_id)) tpBySource.set(t.lead_id, new Set());
      tpBySource.get(t.lead_id)!.add(t.source);
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Total leads with at least 1 touchpoint: ${tpBySource.size}`);

  // Distribution
  const distribution: Record<string, number> = {};
  const multiLeadIds: string[] = [];
  for (const [lid, srcs] of tpBySource.entries()) {
    const key = [...srcs].sort().join(" + ");
    distribution[key] = (distribution[key] ?? 0) + 1;
    if (srcs.size >= 2) multiLeadIds.push(lid);
  }

  console.log("\n--- Source coverage distribution ---");
  for (const [k, v] of Object.entries(distribution).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(45)} ${v.toLocaleString("vi-VN")}`);
  }

  console.log(`\n=== ${multiLeadIds.length} lead có data từ >= 2 sources ===\n`);

  // Lấy 10 ví dụ "đẹp nhất" — ưu tiên có SMAX + Salesforce (vì Instantly chưa pull full)
  const examples = multiLeadIds.slice(0, 100);
  const { data: leads } = await admin
    .from("dim_lead")
    .select("lead_id, full_name, email, phone, source, stage, company, lead_source")
    .in("lead_id", examples);

  // Sort by multi-source quality
  const enriched = (leads ?? []).map((l) => ({
    ...l,
    sources: [...(tpBySource.get(l.lead_id) || [])].sort(),
    touchCount: tpBySource.get(l.lead_id)?.size || 0,
  }));

  // Show 10 examples with SMAX + Salesforce or Instantly + Salesforce
  const top10 = enriched
    .filter((l) => l.sources.length >= 2)
    .sort((a, b) => b.touchCount - a.touchCount)
    .slice(0, 10);

  for (const l of top10) {
    // Get full touchpoint count
    const { count } = await admin
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("lead_id", l.lead_id);

    console.log(`\n📋 ${l.full_name} [${l.stage}]`);
    console.log(`   📧 ${l.email || "—"}  📞 ${l.phone || "—"}`);
    console.log(`   🚪 Origin: ${l.source}${l.lead_source ? ` (${l.lead_source})` : ""}`);
    console.log(`   🔀 Sources merged: ${l.sources.join(" + ")}`);
    console.log(`   📊 ${count} touchpoints tổng`);
    console.log(`   🔗 https://mda-cdp.vercel.app/lead/${l.lead_id}`);
  }
}

main().catch(console.error);
