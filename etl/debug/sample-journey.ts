/** Lấy 1 lead có mặt ở cả 4 nguồn → in timeline để xem journey có dựng được không. */
import { admin } from "../lib/supabase-admin";

const SOURCES = ["smax", "salesforce", "instantly", "web"];

async function main() {
  // Tìm lead xuất hiện ở nhiều nguồn nhất
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
  const quad = [...srcByLead.entries()].filter(([, s]) => s.size === 4).map(([id]) => id);
  console.log(`Lead có đủ 4 nguồn: ${quad.length}`);
  if (quad.length === 0) return;

  for (const leadId of quad.slice(0, 2)) {
    const { data: lead } = await admin.from("dim_lead")
      .select("full_name, email, phone, source, stage, smax_tags, first_seen_at, last_engagement_at")
      .eq("lead_id", leadId).maybeSingle();
    const { data: tps } = await admin.from("fact_touchpoint")
      .select("source, event_type, title, occurred_at")
      .eq("lead_id", leadId)
      .order("occurred_at", { ascending: true });

    console.log("\n" + "═".repeat(76));
    console.log(`👤 ${lead?.full_name}  ·  ${lead?.email ?? "-"}  ·  ${lead?.phone ?? "-"}`);
    console.log(`   nguồn gốc: ${lead?.source} · stage: ${lead?.stage} · ${tps?.length} touchpoints`);
    console.log(`   tag SMAX: ${JSON.stringify(lead?.smax_tags ?? [])}`);
    console.log("─".repeat(76));
    const icon: Record<string, string> = { smax: "💬", salesforce: "🏢", instantly: "📧", web: "🌐" };
    // In gọn: gộp email_sent/open liên tiếp
    let lastKey = "";
    let run = 0;
    const flush = () => { if (run > 1) console.log(`      … ×${run}`); run = 0; };
    for (const t of tps ?? []) {
      const key = `${t.source}|${t.event_type}`;
      if (key === lastKey) { run++; continue; }
      flush();
      lastKey = key; run = 1;
      console.log(`   ${String(t.occurred_at).slice(0, 10)}  ${icon[t.source] ?? "•"} ${String(t.source).padEnd(11)} ${String(t.event_type).padEnd(14)} ${String(t.title ?? "").slice(0, 40)}`);
    }
    flush();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
