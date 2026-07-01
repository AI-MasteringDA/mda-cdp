import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

/**
 * Wix dedup v2 — dedup by (lead_id, event_type, DATE).
 * Previous dedup used wix_contact_id but Wix returns MULTIPLE contact_ids
 * for same person → dedup missed. This version uses date-only.
 */
async function main() {
  console.log("🧹 Wix dedup v2 (by date, ignore wix_contact_id)...\n");

  type Row = { id: string; lead_id: string; event_type: string; occurred_at: string };
  const all: Row[] = [];
  let from = 0;
  while (true) {
    const { data } = await admin.from("fact_touchpoint")
      .select("id, lead_id, event_type, occurred_at")
      .eq("source", "web")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    all.push(...(data as Row[]));
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Loaded ${all.length} Wix rows`);

  // Dedup key: lead_id + event_type + date (YYYY-MM-DD)
  const seen = new Map<string, string>();
  const toDelete: string[] = [];
  for (const r of all) {
    const date = r.occurred_at.slice(0, 10);
    const key = `${r.lead_id}::${r.event_type}::${date}`;
    if (seen.has(key)) {
      toDelete.push(r.id);
    } else {
      seen.set(key, r.id);
    }
  }
  console.log(`Unique (lead, event, date): ${seen.size}, Dups to delete: ${toDelete.length}`);

  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 100) {
    const batch = toDelete.slice(i, i + 100);
    const { error } = await admin.from("fact_touchpoint").delete().in("id", batch);
    if (error) { console.error(`   ❌ ${error.message}`); break; }
    deleted += batch.length;
    if (deleted % 500 === 0) console.log(`   Deleted ${deleted}`);
  }
  console.log(`\n✅ Deleted ${deleted} Wix dups`);

  console.log("\n⚙️  Recompute aggregates + scores...");
  await admin.rpc("recompute_lead_aggregates");
  await admin.rpc("recompute_lead_scores");
  console.log("   ✅ Done");

  const { count } = await admin.from("fact_touchpoint")
    .select("*", { count: "exact", head: true }).eq("source", "web");
  const { count: total } = await admin.from("fact_touchpoint")
    .select("*", { count: "exact", head: true });
  console.log(`\n📊 Wix rows now: ${count} | Total touchpoints: ${total}`);

  // Verify Dung Tran
  const { data: dt } = await admin.from("dim_lead")
    .select("lead_id, form_submit_count").eq("email", "michelletran2609@gmail.com").maybeSingle();
  if (dt) {
    const { count: dtWeb } = await admin.from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("lead_id", dt.lead_id).eq("source", "web");
    console.log(`\n🎯 Dung Tran (michelletran2609): ${dtWeb} web events (was 8+ form_submit)`);
  }
}

main().catch(console.error);
