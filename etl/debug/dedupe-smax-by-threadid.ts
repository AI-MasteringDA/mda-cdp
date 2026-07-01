import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

/**
 * Delete duplicate SMAX rows — keep 1 row per (lead_id, thread_id).
 * Triggered by SMAX API returning same thread across multiple page_pids.
 */
async function main() {
  console.log("🧹 Dedupe SMAX touchpoints by thread_id...\n");

  // Pull ALL smax rows paginated
  console.log("Loading SMAX rows...");
  type Row = { id: string; lead_id: string; payload: { thread_id?: string } };
  const allRows: Row[] = [];
  let from = 0;
  while (true) {
    const { data } = await admin
      .from("fact_touchpoint")
      .select("id, lead_id, payload")
      .eq("source", "smax")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    allRows.push(...(data as Row[]));
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`   Loaded ${allRows.length} SMAX rows`);

  // Group by (lead_id, thread_id), keep first id, mark rest for delete
  const seen = new Map<string, string>(); // key → first kept id
  const toDelete: string[] = [];
  for (const r of allRows) {
    const tid = r.payload?.thread_id;
    if (!tid) continue;
    const key = `${r.lead_id}::${tid}`;
    if (seen.has(key)) {
      toDelete.push(r.id);
    } else {
      seen.set(key, r.id);
    }
  }
  console.log(`   Unique (lead, thread): ${seen.size}, Dups to delete: ${toDelete.length}`);

  // Delete in batches of 100
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 100) {
    const batch = toDelete.slice(i, i + 100);
    const { error } = await admin.from("fact_touchpoint").delete().in("id", batch);
    if (error) {
      console.error(`   ❌ Batch ${i} failed: ${error.message}`);
      break;
    }
    deleted += batch.length;
    if (deleted % 1000 === 0) console.log(`   Deleted ${deleted}/${toDelete.length}`);
  }
  console.log(`\n✅ Deleted ${deleted} SMAX dups`);

  // Recompute
  console.log("\n⚙️  Recompute aggregates + scores...");
  await admin.rpc("recompute_lead_aggregates");
  await admin.rpc("recompute_lead_scores");
  console.log("   ✅ Done");

  // Verify
  const { count } = await admin.from("fact_touchpoint")
    .select("*", { count: "exact", head: true }).eq("source", "smax");
  console.log(`\n📊 SMAX rows now: ${count}`);
}

main().catch(console.error);
