import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  // 1) Recent sync_jobs (last 15)
  const { data } = await admin
    .from("sync_job")
    .select("*")
    .eq("source", "instantly")
    .order("started_at", { ascending: false })
    .limit(15);
  console.log(`📅 Last 15 instantly sync_job rows:`);
  for (const j of data ?? []) {
    const t = new Date(j.started_at);
    const ago = Math.round((Date.now() - t.getTime()) / 60000);
    console.log(`  ${j.started_at.slice(0, 19)} (${ago}m ago)  ${j.status}  in=${j.records_in} merged=${j.records_merged}`);
    if (j.error_message) console.log(`    ${j.error_message.slice(0, 100)}`);
  }

  // 2) Recently inserted touchpoints (by created_at)
  const { data: tps } = await admin
    .from("fact_touchpoint")
    .select("occurred_at, created_at")
    .eq("source", "instantly")
    .order("created_at", { ascending: false })
    .limit(5);
  console.log(`\n📦 Last 5 inserted instantly touchpoints (by created_at):`);
  for (const tp of tps ?? []) {
    const ins = new Date(tp.created_at);
    const ago = Math.round((Date.now() - ins.getTime()) / 60000);
    console.log(`  occurred=${tp.occurred_at?.slice(0, 19)}  inserted=${tp.created_at?.slice(0, 19)} (${ago}m ago)`);
  }

  // 3) Total sync_job entries for instantly today (last 24h)
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await admin
    .from("sync_job")
    .select("*", { count: "exact", head: true })
    .eq("source", "instantly")
    .gte("started_at", dayAgo);
  console.log(`\n🔢 Total instantly sync_jobs last 24h: ${count}`);
}

main().catch(console.error);
