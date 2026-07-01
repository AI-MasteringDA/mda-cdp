import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

/**
 * JS-side dedupe runner — since we can't run multi-statement SQL via the
 * supabase-js client. Iterates SF touchpoints, builds a Set of seen
 * (lead_id, key_id) combos, deletes any later row with the same combo.
 */
async function main() {
  console.log("📊 BEFORE:");
  const { count: beforeCount } = await admin
    .from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("source", "salesforce");
  console.log(`   SF touchpoints: ${beforeCount}`);

  const byType: Record<string, number> = {};
  let from = 0;
  while (from < 1_000_000) {
    const { data } = await admin
      .from("fact_touchpoint")
      .select("event_type")
      .eq("source", "salesforce")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const r of data) byType[r.event_type] = (byType[r.event_type] ?? 0) + 1;
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log("   By type:", byType);

  // Walk all SF rows, identify duplicates
  console.log("\n🔍 Scanning for duplicates...");
  type Row = { id: string; lead_id: string; payload: Record<string, unknown> };
  const seen = new Set<string>();
  const toDelete: string[] = [];
  let scanned = 0;
  let rowFrom = 0;
  while (rowFrom < 1_000_000) {
    const { data } = await admin
      .from("fact_touchpoint")
      .select("id, lead_id, payload")
      .eq("source", "salesforce")
      .order("id", { ascending: true })
      .range(rowFrom, rowFrom + 999);
    if (!data || data.length === 0) break;
    for (const r of data as Row[]) {
      const p = r.payload || {};
      const keyId =
        (p.task_id as string) ||
        (p.opportunity_id as string) ||
        (p.sf_contact_id as string) ||
        (p.sf_lead_id as string);
      if (!keyId) continue; // skip rows without identifier (rare)
      const combo = `${r.lead_id}::${keyId}`;
      if (seen.has(combo)) {
        toDelete.push(r.id);
      } else {
        seen.add(combo);
      }
    }
    scanned += data.length;
    if (scanned % 5000 === 0) {
      console.log(`   Scanned ${scanned} rows, ${toDelete.length} dups identified`);
    }
    if (data.length < 1000) break;
    rowFrom += 1000;
  }
  console.log(`\n📋 Result:`);
  console.log(`   Total scanned:    ${scanned}`);
  console.log(`   Unique combos:    ${seen.size}`);
  console.log(`   To delete (dup):  ${toDelete.length}`);

  if (toDelete.length === 0) {
    console.log("\n✅ No duplicates found.");
    return;
  }

  // Delete in batches
  console.log(`\n🗑️  Deleting ${toDelete.length} duplicate rows...`);
  const BATCH = 500;
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += BATCH) {
    const batch = toDelete.slice(i, i + BATCH);
    const { error } = await admin
      .from("fact_touchpoint")
      .delete()
      .in("id", batch);
    if (error) {
      console.warn(`   ⚠️ Batch ${i}: ${error.message}`);
    } else {
      deleted += batch.length;
    }
    if (i > 0 && i % 5000 === 0) console.log(`   Progress: ${deleted}/${toDelete.length}`);
  }
  console.log(`   ✅ Deleted ${deleted} rows`);

  // AFTER snapshot
  console.log("\n📊 AFTER:");
  const { count: afterCount } = await admin
    .from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("source", "salesforce");
  console.log(`   SF touchpoints: ${afterCount} (was ${beforeCount}, delta -${(beforeCount ?? 0) - (afterCount ?? 0)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
