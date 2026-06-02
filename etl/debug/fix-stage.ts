import { admin } from "../lib/supabase-admin";

async function main() {
  console.log("=== Fix stage = 'Đã chốt' for leads with conversion ===\n");

  // Get all lead_ids with conversion event (paginated to handle > 1000)
  const wonLeadIds = new Set<string>();
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from("fact_touchpoint")
      .select("lead_id")
      .eq("event_type", "conversion")
      .range(from, from + 999);
    if (error) {
      console.error("Fetch error:", error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (r.lead_id) wonLeadIds.add(r.lead_id);
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Found ${wonLeadIds.size} unique leads with conversion event`);

  const leadIds = Array.from(wonLeadIds);
  let updated = 0;
  let failed = 0;
  const BATCH = 100;
  for (let i = 0; i < leadIds.length; i += BATCH) {
    const batch = leadIds.slice(i, i + BATCH);
    const { error, count } = await admin
      .from("dim_lead")
      .update({ stage: "Đã chốt" }, { count: "exact" })
      .in("lead_id", batch)
      .neq("stage", "Đã chốt");
    if (error) {
      console.warn(`Batch ${i} error: ${error.message}`);
      failed += batch.length;
    } else {
      updated += count ?? 0;
    }
  }
  console.log(`✅ Updated ${updated} leads to "Đã chốt", ${failed} failed`);

  // Also mark "lost"
  console.log("\n=== Mark stage = 'Im lặng' for leads with lost event ===\n");
  const lostLeadIds = new Set<string>();
  from = 0;
  while (true) {
    const { data, error } = await admin
      .from("fact_touchpoint")
      .select("lead_id")
      .eq("event_type", "lost")
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    for (const r of data) {
      if (r.lead_id) lostLeadIds.add(r.lead_id);
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Found ${lostLeadIds.size} unique leads with lost event`);

  // Only mark "Im lặng" if NOT already "Đã chốt" (some leads have BOTH won + lost)
  const lostOnly = [...lostLeadIds].filter((id) => !wonLeadIds.has(id));
  console.log(`Of which ${lostOnly.length} only have lost (not also won)`);

  let lostUpdated = 0;
  for (let i = 0; i < lostOnly.length; i += BATCH) {
    const batch = lostOnly.slice(i, i + BATCH);
    const { error, count } = await admin
      .from("dim_lead")
      .update({ stage: "Im lặng" }, { count: "exact" })
      .in("lead_id", batch)
      .neq("stage", "Đã chốt")
      .neq("stage", "Im lặng");
    if (!error) lostUpdated += count ?? 0;
  }
  console.log(`✅ Updated ${lostUpdated} leads to "Im lặng"`);

  // Show final distribution
  console.log("\n=== Final stage distribution ===");
  for (const stage of ["Mới", "Đang tư vấn", "Đang cân nhắc", "Im lặng", "Đã chốt"]) {
    const { count } = await admin
      .from("dim_lead")
      .select("*", { count: "exact", head: true })
      .eq("stage", stage);
    console.log(`  ${stage.padEnd(15)} ${count?.toLocaleString("vi-VN") || 0}`);
  }
}

main().catch(console.error);
