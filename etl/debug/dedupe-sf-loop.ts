import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

/**
 * Loop dedupe until pass finds 0 dups (convergence).
 * Each pass scans ~50k rows (Supabase soft limit on long select+delete),
 * so we run repeatedly until done.
 */

type Row = { id: string; lead_id: string; payload: Record<string, unknown> };

async function runOnePass(passNum: number): Promise<{ scanned: number; deleted: number }> {
  console.log(`\n━━━ PASS ${passNum} ━━━`);
  const seen = new Set<string>();
  const toDelete: string[] = [];
  let scanned = 0;
  let rowFrom = 0;
  while (rowFrom < 1_000_000) {
    const { data, error } = await admin
      .from("fact_touchpoint")
      .select("id, lead_id, payload")
      .eq("source", "salesforce")
      .order("id", { ascending: true })
      .range(rowFrom, rowFrom + 999);
    if (error) {
      console.warn(`   ⚠️ ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    for (const r of data as Row[]) {
      const p = r.payload || {};
      const keyId =
        (p.task_id as string) ||
        (p.opportunity_id as string) ||
        (p.sf_contact_id as string) ||
        (p.sf_lead_id as string);
      if (!keyId) continue;
      const combo = `${r.lead_id}::${keyId}`;
      if (seen.has(combo)) toDelete.push(r.id);
      else seen.add(combo);
    }
    scanned += data.length;
    if (data.length < 1000) break;
    rowFrom += 1000;
  }

  console.log(`   Scanned: ${scanned} · Dups: ${toDelete.length}`);
  if (toDelete.length === 0) return { scanned, deleted: 0 };

  const BATCH = 500;
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += BATCH) {
    const batch = toDelete.slice(i, i + BATCH);
    const { error } = await admin.from("fact_touchpoint").delete().in("id", batch);
    if (!error) deleted += batch.length;
  }
  console.log(`   Deleted: ${deleted}`);
  return { scanned, deleted };
}

async function main() {
  let pass = 1;
  let totalDeleted = 0;
  const MAX_PASSES = 20;
  while (pass <= MAX_PASSES) {
    const { scanned, deleted } = await runOnePass(pass);
    totalDeleted += deleted;
    if (deleted === 0) {
      console.log(`\n✅ Converged at pass ${pass} (scanned ${scanned}, 0 dups left)`);
      break;
    }
    pass++;
  }
  console.log(`\n📊 Total deleted across all passes: ${totalDeleted}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
