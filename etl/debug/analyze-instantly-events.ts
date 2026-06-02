import { admin } from "../lib/supabase-admin";

async function main() {
  console.log("=== Instantly Event Analysis ===\n");

  // 1. Event type distribution
  console.log("--- Touchpoints by event_type (Instantly source) ---");
  const eventTypes = ["email_sent", "email_open", "email_click", "email_reply", "lead_created"];
  for (const evt of eventTypes) {
    const { count } = await admin
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("source", "instantly")
      .eq("event_type", evt);
    console.log(`  ${evt.padEnd(15)} ${(count ?? 0).toLocaleString("vi-VN")}`);
  }

  // 2. Distribution of touchpoints per lead (top 10 leads with most emails)
  console.log("\n--- Top 10 leads với nhiều email Instantly nhất ---");
  const { data: allInstantly } = await admin
    .from("fact_touchpoint")
    .select("lead_id")
    .eq("source", "instantly")
    .limit(50000); // raise just in case
  const byLead = new Map<string, number>();
  for (const t of allInstantly ?? []) {
    byLead.set(t.lead_id, (byLead.get(t.lead_id) ?? 0) + 1);
  }
  const top = [...byLead.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [leadId, count] of top) {
    const { data: lead } = await admin
      .from("dim_lead")
      .select("full_name, email")
      .eq("lead_id", leadId)
      .maybeSingle();
    console.log(`  ${count.toString().padStart(4)} emails | ${lead?.full_name?.slice(0, 30) || "—"} | ${lead?.email || "—"}`);
  }

  // 3. Histogram: how many leads have N emails?
  console.log("\n--- Histogram: số lead theo email count ---");
  const buckets: Record<string, number> = {
    "1": 0, "2-5": 0, "6-10": 0, "11-20": 0, "21-50": 0, "51-100": 0, "100+": 0
  };
  for (const count of byLead.values()) {
    if (count === 1) buckets["1"]++;
    else if (count <= 5) buckets["2-5"]++;
    else if (count <= 10) buckets["6-10"]++;
    else if (count <= 20) buckets["11-20"]++;
    else if (count <= 50) buckets["21-50"]++;
    else if (count <= 100) buckets["51-100"]++;
    else buckets["100+"]++;
  }
  for (const [k, v] of Object.entries(buckets)) {
    console.log(`  ${k.padEnd(8)} ${v.toLocaleString("vi-VN")} leads`);
  }
  console.log(`  TOTAL    ${byLead.size.toLocaleString("vi-VN")} leads có Instantly email`);

  // 4. Top 10 unique email subjects (templates được dùng nhiều nhất)
  console.log("\n--- Top 10 email subject (templates dùng nhiều nhất) ---");
  const { data: sample } = await admin
    .from("fact_touchpoint")
    .select("title")
    .eq("source", "instantly")
    .limit(50000);
  const subjects = new Map<string, number>();
  for (const t of sample ?? []) {
    const subj = (t.title || "").replace(/^Email:\s*/, "").replace(/^Sales:\s*Email:\s*/, "").slice(0, 70);
    if (subj) subjects.set(subj, (subjects.get(subj) ?? 0) + 1);
  }
  const topSubjects = [...subjects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [subj, count] of topSubjects) {
    console.log(`  ${count.toString().padStart(4)} | ${subj}`);
  }

  // 5. Inspect raw payload to see what fields Instantly returns
  console.log("\n--- Sample 3 payloads to inspect available fields ---");
  const { data: samples } = await admin
    .from("fact_touchpoint")
    .select("title, payload, occurred_at")
    .eq("source", "instantly")
    .limit(3);
  for (const s of samples ?? []) {
    console.log(`  ${s.occurred_at}`);
    console.log(`    title: ${s.title}`);
    console.log(`    payload keys: ${Object.keys(s.payload || {}).join(", ")}`);
  }
}

main().catch(console.error);
