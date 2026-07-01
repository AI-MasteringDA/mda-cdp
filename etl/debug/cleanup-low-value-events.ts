import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

/**
 * Delete low-value events to keep DB lean:
 * - Instantly email_sent (outbound, no engagement signal)
 * - Keep: opens, clicks, replies, bounces (real engagement)
 */
async function main() {
  console.log("🧹 Cleanup low-value events...\n");

  // Count before
  const { count: beforeSent } = await admin
    .from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("source", "instantly")
    .eq("event_type", "email_sent");
  console.log(`Before: Instantly email_sent = ${beforeSent?.toLocaleString("vi-VN")}`);

  // Delete in batches of 100 (avoid URL too long in .in() clause)
  let totalDeleted = 0;
  while (true) {
    const { data: ids } = await admin
      .from("fact_touchpoint")
      .select("id")
      .eq("source", "instantly")
      .eq("event_type", "email_sent")
      .limit(100);
    if (!ids || ids.length === 0) break;

    const { error } = await admin
      .from("fact_touchpoint")
      .delete()
      .in("id", ids.map((r) => r.id));
    if (error) {
      console.error(`   ❌ Delete failed: ${error.message}`);
      break;
    }
    totalDeleted += ids.length;
    if (totalDeleted % 1000 === 0) console.log(`   ↳ Deleted ${totalDeleted}...`);
    if (ids.length < 100) break;
  }

  console.log(`\n✅ Deleted ${totalDeleted.toLocaleString("vi-VN")} email_sent rows`);

  // Verify
  const { count: afterSent } = await admin
    .from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("source", "instantly")
    .eq("event_type", "email_sent");
  console.log(`After:  Instantly email_sent = ${afterSent?.toLocaleString("vi-VN")}`);

  // Recompute aggregates + scoring
  console.log("\n⚙️  Recompute aggregates...");
  const { error: aggErr } = await admin.rpc("recompute_lead_aggregates");
  if (aggErr) console.warn(`   ⚠️ ${aggErr.message}`);
  else console.log("   ✅ Aggregates updated");

  console.log("⚙️  Recompute scores...");
  const { error: scoreErr } = await admin.rpc("recompute_lead_scores");
  if (scoreErr) console.warn(`   ⚠️ ${scoreErr.message}`);
  else console.log("   ✅ Scores updated");

  // Final stats
  const { count: totalNow } = await admin
    .from("fact_touchpoint")
    .select("*", { count: "exact", head: true });
  console.log(`\n📊 Total fact_touchpoint rows now: ${totalNow?.toLocaleString("vi-VN")}`);
}

main().catch(console.error);
