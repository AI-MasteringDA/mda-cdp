import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

/**
 * Per-lead dedupe — bypasses statement timeout by fetching SF touchpoints
 * scoped to ONE lead at a time. Each lead has ≤ hundreds of rows, no timeout.
 *
 * Strategy:
 *  1. List all leads that have SF touchpoints (paginate dim_lead with source='salesforce')
 *  2. For each lead: fetch all SF touchpoints, build (lead_id, key_id) set,
 *     delete duplicates.
 */

type Row = { id: string; lead_id: string; payload: Record<string, unknown> };

function extractKeyId(p: Record<string, unknown> | null): string | null {
  if (!p) return null;
  return (
    (p.task_id as string) ||
    (p.opportunity_id as string) ||
    (p.sf_contact_id as string) ||
    (p.sf_lead_id as string) ||
    null
  );
}

async function dedupeOneLead(leadId: string): Promise<number> {
  const { data } = await admin
    .from("fact_touchpoint")
    .select("id, lead_id, payload")
    .eq("lead_id", leadId)
    .eq("source", "salesforce")
    .order("id", { ascending: true });
  if (!data || data.length <= 1) return 0;

  const seen = new Set<string>();
  const toDelete: string[] = [];
  for (const r of data as Row[]) {
    const keyId = extractKeyId(r.payload || {});
    if (!keyId) continue;
    if (seen.has(keyId)) toDelete.push(r.id);
    else seen.add(keyId);
  }

  if (toDelete.length === 0) return 0;
  // Delete in batches of 100 (safe for IN clause)
  for (let i = 0; i < toDelete.length; i += 100) {
    const batch = toDelete.slice(i, i + 100);
    await admin.from("fact_touchpoint").delete().in("id", batch);
  }
  return toDelete.length;
}

async function main() {
  console.log("📋 Listing all SF leads...");
  const leadIds = new Set<string>();
  let from = 0;
  while (from < 100_000) {
    const { data } = await admin
      .from("dim_lead")
      .select("lead_id")
      .or("source.eq.salesforce,total_touchpoints.gt.0")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const l of data) leadIds.add(l.lead_id);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`   Total leads to scan: ${leadIds.size}`);

  let processed = 0;
  let totalDeleted = 0;
  const leadArray = [...leadIds];
  const tStart = Date.now();
  for (const lid of leadArray) {
    try {
      const deleted = await dedupeOneLead(lid);
      totalDeleted += deleted;
    } catch (e) {
      console.warn(`   ⚠️ ${lid}: ${(e as Error).message.slice(0, 80)}`);
    }
    processed++;
    if (processed % 500 === 0) {
      const elapsed = ((Date.now() - tStart) / 1000).toFixed(0);
      console.log(`   Progress: ${processed}/${leadArray.length} · deleted ${totalDeleted} dups · ${elapsed}s`);
    }
  }
  const elapsed = ((Date.now() - tStart) / 1000).toFixed(0);
  console.log(`\n✅ Done in ${elapsed}s. Total deleted: ${totalDeleted}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
