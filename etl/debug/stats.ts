import { admin } from "../lib/supabase-admin";

async function main() {
  console.log("\n=== MDA CDP — Data Stats ===\n");

  const { count: leadCount } = await admin
    .from("dim_lead")
    .select("*", { count: "exact", head: true });
  console.log(`dim_lead:        ${leadCount?.toLocaleString("vi-VN")}`);

  // Stage distribution
  for (const stage of ["Mới", "Đang tư vấn", "Đang cân nhắc", "Im lặng", "Đã chốt"]) {
    const { count } = await admin
      .from("dim_lead")
      .select("*", { count: "exact", head: true })
      .eq("stage", stage);
    console.log(`  ↳ ${stage.padEnd(15)} ${count?.toLocaleString("vi-VN") || 0}`);
  }
  // Sources
  console.log("Source distribution:");
  for (const src of ["instantly", "smax", "salesforce", "fanpage", "web"]) {
    const { count } = await admin
      .from("dim_lead")
      .select("*", { count: "exact", head: true })
      .eq("source", src);
    if (count) console.log(`  ↳ ${src.padEnd(15)} ${count?.toLocaleString("vi-VN")}`);
  }

  // Event type distribution
  console.log("\nEvent type distribution:");
  for (const evt of ["lead_created", "conversion", "lost", "chat", "chat_staff", "call", "meeting", "note", "email_sent", "email_open"]) {
    const { count } = await admin
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("event_type", evt);
    if (count) console.log(`  ↳ ${evt.padEnd(15)} ${count?.toLocaleString("vi-VN")}`);
  }

  const { count: tpCount } = await admin
    .from("fact_touchpoint")
    .select("*", { count: "exact", head: true });
  console.log(`fact_touchpoint: ${tpCount?.toLocaleString("vi-VN")}`);

  // Per source breakdown
  for (const src of ["instantly", "smax", "salesforce"]) {
    const { count } = await admin
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("source", src);
    console.log(`  ↳ ${src.padEnd(12)} ${count?.toLocaleString("vi-VN") || 0}`);
  }

  const { count: hotCount } = await admin
    .from("fact_lead_score")
    .select("*", { count: "exact", head: true })
    .eq("scored_at", new Date().toISOString().slice(0, 10))
    .gte("hot_score", 70);
  console.log(`\nfact_lead_score:`);
  console.log(`  ↳ Hot (>=70):  ${hotCount?.toLocaleString("vi-VN")}`);

  const { count: coldCount } = await admin
    .from("fact_lead_score")
    .select("*", { count: "exact", head: true })
    .eq("scored_at", new Date().toISOString().slice(0, 10))
    .gte("cold_score", 70);
  console.log(`  ↳ Cold (>=70): ${coldCount?.toLocaleString("vi-VN")}`);

  const { count: syncCount } = await admin
    .from("sync_job")
    .select("*", { count: "exact", head: true });
  console.log(`\nsync_job:        ${syncCount?.toLocaleString("vi-VN")}`);

  console.log("\n");
}

main().catch(console.error);
