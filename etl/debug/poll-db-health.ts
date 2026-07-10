import { admin } from "../lib/supabase-admin";

/**
 * DB health probe — one cheap query, report latency.
 * Exit 0 = healthy (<3s), exit 1 = still throttled.
 */
async function main() {
  const t0 = Date.now();
  const { count, error } = await admin
    .from("dim_lead")
    .select("*", { count: "exact", head: true })
    .eq("source", "smax");
  const ms = Date.now() - t0;
  console.log(`[${new Date().toISOString().slice(11, 19)}] dim_lead(smax) count=${count} err=${error?.message || "-"} latency=${ms}ms`);
  if (error || count == null || ms > 3000) process.exit(1);
  process.exit(0);
}
main().catch(() => process.exit(1));
