import { admin } from "../lib/supabase-admin";

async function main() {
  console.log("=== Verify Scoring V2 ===\n");

  // 1. Distribution
  const today = new Date().toISOString().slice(0, 10);
  const { count: total } = await admin
    .from("fact_lead_score")
    .select("*", { count: "exact", head: true })
    .eq("scored_at", today);
  console.log(`Total scored today: ${total?.toLocaleString("vi-VN")}`);

  console.log("\n--- HOT distribution ---");
  for (const [min, max, label] of [[90,100,"90-100"],[70,89,"70-89"],[50,69,"50-69"],[30,49,"30-49"],[1,29,"1-29"],[0,0,"0"]] as [number,number,string][]) {
    const { count } = await admin
      .from("fact_lead_score")
      .select("*", { count: "exact", head: true })
      .eq("scored_at", today)
      .gte("hot_score", min)
      .lte("hot_score", max);
    console.log(`  ${label.padEnd(8)} ${count?.toLocaleString("vi-VN") || 0}`);
  }

  console.log("\n--- COLD distribution ---");
  for (const [min, max, label] of [[90,100,"90-100"],[70,89,"70-89"],[50,69,"50-69"],[30,49,"30-49"],[1,29,"1-29"],[0,0,"0"]] as [number,number,string][]) {
    const { count } = await admin
      .from("fact_lead_score")
      .select("*", { count: "exact", head: true })
      .eq("scored_at", today)
      .gte("cold_score", min)
      .lte("cold_score", max);
    console.log(`  ${label.padEnd(8)} ${count?.toLocaleString("vi-VN") || 0}`);
  }

  // 2. Check Nguyễn Tuấn Ngọc
  const ngocId = "0aea7800-51ec-4881-a08a-f4443a80968c";
  console.log("\n=== Lead VÀNG: Nguyễn Tuấn Ngọc ===");
  const { data: ngoc } = await admin
    .from("fact_lead_score")
    .select("hot_score, cold_score, hot_reasons, cold_reasons")
    .eq("lead_id", ngocId)
    .eq("scored_at", today)
    .single();
  if (ngoc) {
    console.log(`🔥 Hot:  ${ngoc.hot_score}`);
    console.log(`🧊 Cold: ${ngoc.cold_score}`);
    console.log(`   Hot reasons:  ${JSON.stringify(ngoc.hot_reasons)}`);
    console.log(`   Cold reasons: ${JSON.stringify(ngoc.cold_reasons)}`);
  }

  // 3. Top 10 hottest
  console.log("\n=== Top 10 HOTTEST leads (hot_score DESC) ===");
  const { data: hot } = await admin
    .from("fact_lead_score")
    .select("lead_id, hot_score, hot_reasons")
    .eq("scored_at", today)
    .order("hot_score", { ascending: false })
    .limit(10);
  for (const h of hot ?? []) {
    const { data: lead } = await admin
      .from("dim_lead")
      .select("full_name, stage")
      .eq("lead_id", h.lead_id)
      .single();
    console.log(`  🔥${String(h.hot_score).padStart(3)} | ${(lead?.full_name || "—").padEnd(35)} [${lead?.stage}]`);
    console.log(`         reasons: ${JSON.stringify(h.hot_reasons)}`);
  }

  // 4. Top 5 coldest (action: skip or revive)
  console.log("\n=== Top 5 COLDEST leads ===");
  const { data: cold } = await admin
    .from("fact_lead_score")
    .select("lead_id, cold_score, cold_reasons")
    .eq("scored_at", today)
    .order("cold_score", { ascending: false })
    .limit(5);
  for (const c of cold ?? []) {
    const { data: lead } = await admin
      .from("dim_lead")
      .select("full_name, stage")
      .eq("lead_id", c.lead_id)
      .single();
    console.log(`  🧊${String(c.cold_score).padStart(3)} | ${(lead?.full_name || "—").padEnd(35)} [${lead?.stage}]`);
    console.log(`         reasons: ${JSON.stringify(c.cold_reasons)}`);
  }
}

main().catch(console.error);
