import { admin } from "../lib/supabase-admin";

async function main() {
  console.log("=== Tìm các lead có STORY phong phú để demo ===\n");

  // Bước 1: Tìm lead_ids có nhiều touchpoint nhất
  const { data: leadCounts } = await admin
    .from("fact_touchpoint")
    .select("lead_id");
  const countMap = new Map<string, number>();
  for (const t of leadCounts ?? []) {
    countMap.set(t.lead_id, (countMap.get(t.lead_id) ?? 0) + 1);
  }
  const top = Array.from(countMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);
  console.log(`Top 50 lead có nhiều touchpoint nhất: ${top[0][1]} → ${top[49][1]} touchpoints`);

  // Bước 2: Lấy chi tiết 10 lead top
  const topLeadIds = top.slice(0, 10).map((t) => t[0]);
  const { data: leads } = await admin
    .from("dim_lead")
    .select("lead_id, full_name, email, phone, source, stage, company, assignee, lead_source")
    .in("lead_id", topLeadIds);

  console.log(`\n=== 10 lead có timeline đa dạng nhất ===\n`);

  for (const lead of leads ?? []) {
    const tpCount = countMap.get(lead.lead_id) ?? 0;

    // Get touchpoint breakdown
    const { data: touches } = await admin
      .from("fact_touchpoint")
      .select("source, event_type, title, occurred_at")
      .eq("lead_id", lead.lead_id)
      .order("occurred_at", { ascending: false });

    const eventBreakdown: Record<string, number> = {};
    const sourceBreakdown: Record<string, number> = {};
    for (const t of touches ?? []) {
      eventBreakdown[t.event_type] = (eventBreakdown[t.event_type] ?? 0) + 1;
      sourceBreakdown[t.source] = (sourceBreakdown[t.source] ?? 0) + 1;
    }

    const sources = Object.entries(sourceBreakdown).map(([k, v]) => `${k}(${v})`).join(", ");
    const events = Object.entries(eventBreakdown).map(([k, v]) => `${k}(${v})`).join(", ");

    console.log(`\n📋 ${lead.full_name} [${lead.stage}]`);
    console.log(`   📧 ${lead.email || "—"}`);
    console.log(`   📞 ${lead.phone || "—"}`);
    console.log(`   🏢 ${lead.company || "—"}`);
    console.log(`   👤 TVV: ${lead.assignee || "—"}`);
    console.log(`   🚪 Source: ${lead.source}${lead.lead_source ? ` (${lead.lead_source})` : ""}`);
    console.log(`   📊 ${tpCount} touchpoints`);
    console.log(`      Sources: ${sources}`);
    console.log(`      Events:  ${events}`);
    console.log(`   🔗 https://mda-cdp.vercel.app/lead/${lead.lead_id}`);

    // Show first 5 touchpoints
    console.log(`   ⏱ Latest 5 events:`);
    for (const t of (touches ?? []).slice(0, 5)) {
      const date = new Date(t.occurred_at).toLocaleDateString("vi-VN");
      console.log(`      ${date}  ${t.event_type.padEnd(15)} ${(t.title || "").slice(0, 70)}`);
    }
  }
}

main().catch(console.error);
