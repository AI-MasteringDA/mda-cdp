import { admin } from "../lib/supabase-admin";

async function main() {
  // Find the touchpoint at 2026-07-07 14:29 with "Đức Hiếu" name
  console.log("=== Investigate 'Đức Hiếu' data gap ===\n");

  const { data: tps } = await admin
    .from("fact_touchpoint")
    .select("lead_id, event_type, title, detail, occurred_at, payload")
    .eq("source", "smax")
    .gte("occurred_at", "2026-07-07T00:00:00Z")
    .lt("occurred_at", "2026-07-08T00:00:00Z")
    .order("occurred_at", { ascending: false });

  const matches = (tps ?? []).filter(t =>
    (t.title || "").toLowerCase().includes("hiếu") ||
    (t.title || "").toLowerCase().includes("hieu") ||
    ((t.payload as { customer_name?: string })?.customer_name || "").toLowerCase().includes("hiếu") ||
    ((t.payload as { customer_name?: string })?.customer_name || "").toLowerCase().includes("hieu")
  );

  console.log(`Found ${matches.length} touchpoints on 2026-07-07 with "Hiếu"/"Hieu" in name:`);
  for (const t of matches.slice(0, 5)) {
    const pl = t.payload as Record<string, unknown>;
    console.log(`\n  📍 ${t.occurred_at?.slice(0, 19)}`);
    console.log(`     lead_id: ${t.lead_id}`);
    console.log(`     event:   ${t.event_type}`);
    console.log(`     title:   ${(t.title || "").slice(0, 80)}`);
    console.log(`     detail:  ${(t.detail || "").slice(0, 80)}`);
    console.log(`     payload.customer_name:    ${pl.customer_name}`);
    console.log(`     payload.smax_customer_id: ${pl.smax_customer_id}`);
    console.log(`     payload.thread_id:        ${pl.thread_id}`);
    console.log(`     payload.platform:         ${pl.platform}`);
    console.log(`     payload.source_endpoint:  ${pl.source_endpoint}`);
    console.log(`     payload keys: ${Object.keys(pl).join(", ")}`);

    if (t.lead_id) {
      const { data: lead } = await admin.from("dim_lead").select("*").eq("lead_id", t.lead_id).maybeSingle();
      console.log(`     ↳ dim_lead.full_name:   ${lead?.full_name}`);
      console.log(`     ↳ dim_lead.email:       ${lead?.email}`);
      console.log(`     ↳ dim_lead.phone:       ${lead?.phone}`);
      console.log(`     ↳ dim_lead.source:      ${lead?.source}`);
      console.log(`     ↳ dim_lead.smax_customer_id: ${lead?.smax_customer_id}`);
      console.log(`     ↳ dim_lead.smax_tags:   ${JSON.stringify(lead?.smax_tags)}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
