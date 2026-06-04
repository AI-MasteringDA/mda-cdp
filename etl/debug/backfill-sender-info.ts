import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

/**
 * Backfill `payload.sender_is_staff` for SMAX events that have
 * `payload.sender_pid` + `payload.page_pid`:
 *   - sender_pid === page_pid → MDA staff (or bot)
 *   - sender_pid !== page_pid → customer (lead)
 *
 * Events without sender_pid (older smax-real.ts thread-level data) stay null.
 */

const KNOWN_PAGE_PIDS = new Set([
  "fb102323788540150",      // FB Brand
  "fb107203051058856",      // FB KOL
  "zlw543187459113764384",  // Zalo Main
  "zl2235256473219383054",  // Zalo Other
  "ctm68188e11779d16c0779c018c",
  "ig17841446528067260",
  "ig17841460097450702",
]);

async function main() {
  console.log("📊 Scanning SMAX events for sender_pid metadata...\n");

  // Fetch all SMAX events that need backfill
  const events: { id: string; payload: Record<string, unknown> }[] = [];
  let from = 0;
  while (true) {
    const { data } = await admin
      .from("fact_touchpoint")
      .select("id, payload")
      .eq("source", "smax")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    events.push(...data.map((d) => ({ id: d.id, payload: (d.payload || {}) as Record<string, unknown> })));
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Total SMAX events: ${events.length}`);

  // Stats
  let withSenderPid = 0;
  let alreadyHasFlag = 0;
  let canBackfill = 0;
  let cannotDetermine = 0;
  let staffCount = 0;
  let leadCount = 0;

  const updates: { id: string; payload: Record<string, unknown> }[] = [];

  for (const ev of events) {
    const p = ev.payload;
    if (p.sender_is_staff !== undefined) {
      alreadyHasFlag++;
      continue;
    }
    const senderPid = p.sender_pid as string | undefined;
    const pagePid = p.page_pid as string | undefined;
    if (senderPid && pagePid) {
      withSenderPid++;
      // sender_pid === page_pid OR sender_pid is one of our known page IDs → STAFF
      const isStaff = senderPid === pagePid || KNOWN_PAGE_PIDS.has(senderPid);
      if (isStaff) staffCount++;
      else leadCount++;
      canBackfill++;
      updates.push({
        id: ev.id,
        payload: { ...p, sender_is_staff: isStaff, sender_derived_from: "sender_pid_eq_page_pid" },
      });
    } else {
      cannotDetermine++;
    }
  }

  console.log(`\n📈 Analysis:`);
  console.log(`   Already has sender_is_staff flag:        ${alreadyHasFlag}`);
  console.log(`   Has sender_pid (can backfill):           ${withSenderPid}`);
  console.log(`   → Would be classified as STAFF:          ${staffCount}`);
  console.log(`   → Would be classified as LEAD:           ${leadCount}`);
  console.log(`   No sender_pid (cannot determine):        ${cannotDetermine}`);

  if (updates.length === 0) {
    console.log(`\n✅ Nothing to backfill.`);
    return;
  }

  console.log(`\n🔄 Updating ${updates.length} events...`);
  const BATCH = 100;
  let done = 0;
  let failed = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    // Supabase doesn't support bulk update with different values per row from a single call.
    // Use individual updates in parallel chunks.
    await Promise.all(batch.map(async (u) => {
      const { error } = await admin
        .from("fact_touchpoint")
        .update({ payload: u.payload })
        .eq("id", u.id);
      if (error) failed++;
      else done++;
    }));
    if ((i + BATCH) % 1000 === 0 || i + BATCH >= updates.length) {
      console.log(`   Progress: ${done}/${updates.length}`);
    }
  }
  console.log(`\n✅ Updated ${done} events (${failed} failed)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
