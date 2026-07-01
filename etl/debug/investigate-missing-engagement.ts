import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  console.log("🔍 INVESTIGATE: Missing engagement events\n");

  const iso30 = new Date(Date.now() - 30 * 86400_000).toISOString();
  const iso90 = new Date(Date.now() - 90 * 86400_000).toISOString();

  // 1. ALL Instantly event types (not just what we tracked)
  console.log("═══ 1. Instantly event types breakdown (ALL TIME) ═══");
  const { data: allInstantly } = await admin.from("fact_touchpoint")
    .select("event_type", { count: "exact" })
    .eq("source", "instantly");
  const eventTypes: Record<string, number> = {};
  allInstantly?.forEach(t => { eventTypes[t.event_type] = (eventTypes[t.event_type] || 0) + 1; });
  for (const [e, c] of Object.entries(eventTypes).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${e.padEnd(20)}: ${c}`);
  }

  // 2. Web page_view details
  console.log("\n═══ 2. Web page_view breakdown ═══");
  const { data: pageViews } = await admin.from("fact_touchpoint")
    .select("title, occurred_at, payload")
    .eq("source", "web").eq("event_type", "page_view")
    .order("occurred_at", { ascending: false }).limit(10);
  console.log(`   Sample 10 recent page_views:`);
  pageViews?.forEach((p, i) => {
    const activity = (p.payload as any)?.activity_type || 'unknown';
    console.log(`   ${i+1}. ${p.occurred_at?.slice(0,10)} | ${activity} | ${p.title?.slice(0,60)}`);
  });

  // 3. SMAX event breakdown — are we missing chat direction properly?
  console.log("\n═══ 3. SMAX event distribution ═══");
  const { data: smax } = await admin.from("fact_touchpoint")
    .select("event_type, payload")
    .eq("source", "smax");
  const smaxCount: Record<string, number> = {};
  const senderStats: Record<string, number> = {};
  smax?.forEach(t => {
    smaxCount[t.event_type] = (smaxCount[t.event_type] || 0) + 1;
    const isStaff = (t.payload as any)?.sender_is_staff;
    if (isStaff === true) senderStats.staff = (senderStats.staff || 0) + 1;
    else if (isStaff === false) senderStats.customer = (senderStats.customer || 0) + 1;
    else senderStats.unknown = (senderStats.unknown || 0) + 1;
  });
  console.log(`   By event_type:`);
  for (const [e, c] of Object.entries(smaxCount)) console.log(`     ${e.padEnd(15)}: ${c}`);
  console.log(`   By sender_is_staff flag:`);
  for (const [e, c] of Object.entries(senderStats)) console.log(`     ${e.padEnd(15)}: ${c}`);

  // 4. Salesforce email_sent breakdown (TVV emails)
  console.log("\n═══ 4. Salesforce email events ═══");
  const { data: sfEmails } = await admin.from("fact_touchpoint")
    .select("event_type", { count: "exact" })
    .eq("source", "salesforce")
    .in("event_type", ["email_sent", "email_open", "email_reply", "email_click"]);
  const sfEmailCount: Record<string, number> = {};
  sfEmails?.forEach(t => { sfEmailCount[t.event_type] = (sfEmailCount[t.event_type] || 0) + 1; });
  for (const [e, c] of Object.entries(sfEmailCount)) console.log(`   ${e.padEnd(15)}: ${c}`);

  // 5. Compare 30d vs 90d
  console.log("\n═══ 5. Engagement 30d vs 90d comparison ═══");
  for (const src of ["instantly", "smax", "web"]) {
    for (const et of ["email_open", "email_click", "email_reply", "chat", "form_submit", "page_view"]) {
      const q30 = admin.from("fact_touchpoint").select("*", {count:"exact", head:true})
        .eq("source", src).eq("event_type", et).gte("occurred_at", iso30);
      const q90 = admin.from("fact_touchpoint").select("*", {count:"exact", head:true})
        .eq("source", src).eq("event_type", et).gte("occurred_at", iso90);
      const [{count: c30}, {count: c90}] = await Promise.all([q30, q90]);
      if ((c30 ?? 0) + (c90 ?? 0) > 0) {
        console.log(`   ${src}/${et}:  30d=${c30}  90d=${c90}`);
      }
    }
  }

  // 6. Check ETL run history — when was last successful pull?
  console.log("\n═══ 6. ETL sync_job history (last 10) ═══");
  const { data: syncs } = await admin.from("sync_job")
    .select("source, status, started_at, records_in, records_merged, error_message")
    .order("started_at", { ascending: false }).limit(10);
  syncs?.forEach(s => {
    const time = s.started_at?.slice(0, 19);
    console.log(`   ${time} | ${s.source?.padEnd(12)} | ${s.status?.padEnd(8)} | in=${s.records_in} merged=${s.records_merged}${s.error_message ? ' err:' + s.error_message.slice(0, 40) : ''}`);
  });
}

main().catch(console.error);
