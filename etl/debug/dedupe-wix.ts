import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  console.log("🧹 Dedupe Wix touchpoints...\n");

  type Row = { id: string; lead_id: string; event_type: string; occurred_at: string; payload: any };
  const all: Row[] = [];
  let from = 0;
  while (true) {
    const { data } = await admin
      .from("fact_touchpoint")
      .select("id, lead_id, event_type, occurred_at, payload")
      .eq("source", "web")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    all.push(...(data as Row[]));
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Loaded ${all.length} Wix rows`);

  // Group by (lead_id, event_type, source_id) — keep first, delete rest
  const seen = new Map<string, string>();
  const toDelete: string[] = [];
  for (const r of all) {
    const sid = r.payload?.wix_contact_id || r.payload?.wix_member_id || `at:${r.occurred_at}`;
    const key = `${r.lead_id}::${r.event_type}::${sid}`;
    if (seen.has(key)) {
      toDelete.push(r.id);
    } else {
      seen.set(key, r.id);
    }
  }
  console.log(`Unique: ${seen.size}, Dups to delete: ${toDelete.length}`);

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
}

main().catch(console.error);
