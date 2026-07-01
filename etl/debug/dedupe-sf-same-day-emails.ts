import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

/**
 * Delete SF email_sent dups where (lead_id, date, title) is the same.
 * These are MDA sending 2 identical emails to same lead in one day —
 * we keep 1 to represent "email touch on this date".
 */
async function main() {
  console.log("🧹 SF email dedup (same date + same subject)...\n");

  type Row = { id: string; lead_id: string; title: string | null; occurred_at: string };
  const rows: Row[] = [];
  let from = 0;
  while (true) {
    const { data } = await admin.from("fact_touchpoint")
      .select("id, lead_id, title, occurred_at")
      .eq("source", "salesforce")
      .eq("event_type", "email_sent")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Loaded ${rows.length} SF email_sent rows`);

  // Dedup key: lead + date + title
  const seen = new Map<string, string>();
  const toDelete: string[] = [];
  for (const r of rows) {
    const date = r.occurred_at.slice(0, 10);
    const title = (r.title || "").trim();
    const key = `${r.lead_id}::${date}::${title}`;
    if (seen.has(key)) toDelete.push(r.id);
    else seen.set(key, r.id);
  }
  console.log(`Unique (lead, date, title): ${seen.size}, Dups to delete: ${toDelete.length}`);

  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 100) {
    const batch = toDelete.slice(i, i + 100);
    const { error } = await admin.from("fact_touchpoint").delete().in("id", batch);
    if (error) { console.error(`❌ ${error.message}`); break; }
    deleted += batch.length;
  }
  console.log(`✅ Deleted ${deleted} SF email dups`);

  await admin.rpc("recompute_lead_aggregates");
  console.log("✅ Aggregates recomputed");

  const { count: after } = await admin.from("fact_touchpoint")
    .select("*", {count:"exact",head:true})
    .eq("source", "salesforce").eq("event_type", "email_sent");
  console.log(`\n📊 SF email_sent now: ${after} (from ${rows.length})`);
}

main().catch(console.error);
