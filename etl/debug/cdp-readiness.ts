/** Kiểm tra 4 nguồn đã sẵn sàng cho CDP journey tracking chưa. */
import { admin } from "../lib/supabase-admin";

const SOURCES = ["smax", "salesforce", "instantly", "web"] as const;

async function main() {
  const now = Date.now();

  console.log("═".repeat(78));
  console.log("1. TÌNH TRẠNG TỪNG NGUỒN");
  console.log("═".repeat(78));
  for (const s of SOURCES) {
    const { count: tp } = await admin.from("fact_touchpoint")
      .select("*", { count: "exact", head: true }).eq("source", s);
    const { data: newest } = await admin.from("fact_touchpoint")
      .select("occurred_at").eq("source", s)
      .order("occurred_at", { ascending: false }).limit(1);
    const { data: oldest } = await admin.from("fact_touchpoint")
      .select("occurred_at").eq("source", s)
      .order("occurred_at", { ascending: true }).limit(1);
    const { count: leads } = await admin.from("dim_lead")
      .select("*", { count: "exact", head: true }).eq("source", s);
    const last = newest?.[0]?.occurred_at;
    const hoursAgo = last ? Math.round((now - Date.parse(last)) / 3600_000) : null;
    const fresh = hoursAgo == null ? "❓" : hoursAgo <= 24 ? "🟢" : hoursAgo <= 72 ? "🟡" : "🔴";
    console.log(`\n${fresh} ${s.toUpperCase()}`);
    console.log(`   touchpoints: ${String(tp ?? 0).padStart(6)}   leads(source): ${leads ?? 0}`);
    console.log(`   khoảng data: ${oldest?.[0]?.occurred_at?.slice(0, 10) ?? "-"} → ${last?.slice(0, 10) ?? "-"}`);
    console.log(`   mới nhất cách đây: ${hoursAgo != null ? hoursAgo + " giờ" : "-"}`);
  }

  console.log("\n" + "═".repeat(78));
  console.log("2. EVENT TYPES (nguyên liệu dựng journey)");
  console.log("═".repeat(78));
  for (const s of SOURCES) {
    const counts: Record<string, number> = {};
    let from = 0;
    while (from < 80000) {
      const { data } = await admin.from("fact_touchpoint")
        .select("event_type").eq("source", s).range(from, from + 999);
      if (!data?.length) break;
      for (const r of data) counts[r.event_type ?? "?"] = (counts[r.event_type ?? "?"] ?? 0) + 1;
      if (data.length < 1000) break;
      from += 1000;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(`\n${s}: ${top.map(([e, n]) => `${e}(${n})`).join("  ")}`);
  }

  console.log("\n" + "═".repeat(78));
  console.log("3. IDENTITY — lead xuất hiện ở MẤY NGUỒN? (chìa khoá journey)");
  console.log("═".repeat(78));
  const srcByLead = new Map<string, Set<string>>();
  for (const s of SOURCES) {
    let from = 0;
    while (from < 80000) {
      const { data } = await admin.from("fact_touchpoint")
        .select("lead_id").eq("source", s).range(from, from + 999);
      if (!data?.length) break;
      for (const r of data) {
        if (!r.lead_id) continue;
        let set = srcByLead.get(r.lead_id);
        if (!set) { set = new Set(); srcByLead.set(r.lead_id, set); }
        set.add(s);
      }
      if (data.length < 1000) break;
      from += 1000;
    }
  }
  const dist: Record<number, number> = {};
  const comboCount: Record<string, number> = {};
  for (const set of srcByLead.values()) {
    dist[set.size] = (dist[set.size] ?? 0) + 1;
    if (set.size > 1) {
      const key = [...set].sort().join(" + ");
      comboCount[key] = (comboCount[key] ?? 0) + 1;
    }
  }
  console.log(`\nTổng lead có touchpoint: ${srcByLead.size}`);
  for (const n of [1, 2, 3, 4]) {
    const v = dist[n] ?? 0;
    const pct = ((v / Math.max(srcByLead.size, 1)) * 100).toFixed(1);
    console.log(`   ${n} nguồn: ${String(v).padStart(6)}  (${pct}%)`);
  }
  console.log(`\nCác kết hợp đa nguồn (journey thật sự):`);
  Object.entries(comboCount).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .forEach(([k, v]) => console.log(`   ${k.padEnd(34)} ${v}`));

  console.log("\n" + "═".repeat(78));
  console.log("4. CHẤT LƯỢNG IDENTITY (dựa vào gì để nối journey)");
  console.log("═".repeat(78));
  const { count: total } = await admin.from("dim_lead").select("*", { count: "exact", head: true });
  const { count: withEmail } = await admin.from("dim_lead")
    .select("*", { count: "exact", head: true }).not("email", "is", null);
  const { count: withPhone } = await admin.from("dim_lead")
    .select("*", { count: "exact", head: true }).not("phone", "is", null);
  const { count: withBoth } = await admin.from("dim_lead")
    .select("*", { count: "exact", head: true })
    .not("email", "is", null).not("phone", "is", null);
  const pct = (n: number) => ((n / Math.max(total ?? 1, 1)) * 100).toFixed(1) + "%";
  console.log(`\ndim_lead: ${total} leads`);
  console.log(`   có email:      ${withEmail}  (${pct(withEmail ?? 0)})   ← khoá nối chính`);
  console.log(`   có phone:      ${withPhone}  (${pct(withPhone ?? 0)})`);
  console.log(`   có cả hai:     ${withBoth}  (${pct(withBoth ?? 0)})`);
  console.log(`   KHÔNG có gì:   ${(total ?? 0) - (withEmail ?? 0) - (withPhone ?? 0) + (withBoth ?? 0)}  ← không nối journey được`);

  console.log("\n" + "═".repeat(78));
  console.log("5. SCORING / AGGREGATE có chạy không");
  console.log("═".repeat(78));
  const { count: scores } = await admin.from("fact_lead_score").select("*", { count: "exact", head: true });
  const { data: lastScore } = await admin.from("fact_lead_score")
    .select("scored_at").order("scored_at", { ascending: false }).limit(1);
  console.log(`\nfact_lead_score: ${scores} dòng · mới nhất: ${lastScore?.[0]?.scored_at ?? "-"}`);
  const { data: aggSample } = await admin.from("dim_lead")
    .select("last_chat_at, last_email_at, last_engagement_at, total_touchpoints")
    .not("last_engagement_at", "is", null).limit(1);
  console.log(`Cột aggregate trên dim_lead: ${aggSample?.[0] ? "✅ có dữ liệu" : "⚠️ rỗng — recompute chưa chạy"}`);
}
main().catch(e => { console.error(e); process.exit(1); });
