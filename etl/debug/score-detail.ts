import { admin } from "../lib/supabase-admin";

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  console.log("\n=== HOT score exact distribution ===");
  const hotBuckets = [
    [70, 100, "70-100 (HOT)"],
    [60, 69, "60-69"],
    [50, 59, "50-59"],
    [40, 49, "40-49"],
    [35, 39, "35-39"],
    [30, 34, "30-34"],
    [20, 29, "20-29"],
    [10, 19, "10-19"],
    [1, 9, "1-9"],
    [0, 0, "0"],
  ] as [number, number, string][];

  for (const [min, max, label] of hotBuckets) {
    const { count } = await admin
      .from("fact_lead_score")
      .select("*", { count: "exact", head: true })
      .eq("scored_at", today)
      .gte("hot_score", min)
      .lte("hot_score", max);
    console.log(`  ${label.padEnd(20)} ${(count ?? 0).toLocaleString("vi-VN")}`);
  }

  console.log("\n=== COLD score exact distribution ===");
  for (const [min, max, label] of hotBuckets) {
    const { count } = await admin
      .from("fact_lead_score")
      .select("*", { count: "exact", head: true })
      .eq("scored_at", today)
      .gte("cold_score", min)
      .lte("cold_score", max);
    console.log(`  ${label.padEnd(20)} ${(count ?? 0).toLocaleString("vi-VN")}`);
  }

  console.log("\n=== Sample at hot=30 to see what reasons fire ===");
  const { data: at30 } = await admin
    .from("fact_lead_score")
    .select("lead_id, hot_score, hot_reasons")
    .eq("scored_at", today)
    .eq("hot_score", 30)
    .limit(3);
  for (const r of at30 ?? []) {
    console.log(`  ${r.lead_id} hot=${r.hot_score} reasons=${JSON.stringify(r.hot_reasons)}`);
  }

  console.log("\n=== Sample at hot=20 ===");
  const { data: at20 } = await admin
    .from("fact_lead_score")
    .select("lead_id, hot_score, hot_reasons")
    .eq("scored_at", today)
    .eq("hot_score", 20)
    .limit(3);
  for (const r of at20 ?? []) {
    console.log(`  ${r.lead_id} hot=${r.hot_score} reasons=${JSON.stringify(r.hot_reasons)}`);
  }

  console.log("\n=== Sample at cold=25 ===");
  const { data: c25 } = await admin
    .from("fact_lead_score")
    .select("lead_id, cold_score, cold_reasons, hot_score")
    .eq("scored_at", today)
    .eq("cold_score", 25)
    .limit(3);
  for (const r of c25 ?? []) {
    console.log(`  ${r.lead_id} cold=${r.cold_score} hot=${r.hot_score} reasons=${JSON.stringify(r.cold_reasons)}`);
  }
}
main().catch(console.error);
