import { admin } from "../lib/supabase-admin";

const TOKEN = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const BASE = process.env.SMAX_BASE_URL || "https://api.smax.ai";
const BIZ_SLUG = "mastering-data-analytics";
const DRY_RUN = process.env.DRY_RUN !== "0";

type SmaxThread = { id: string; platform?: string; customer?: { id?: string; pid?: string } };
type SmaxCust = { id: string; pid?: string; platform?: string };

const PAGE_PIDS = [
  "fb102323788540150","fb107203051058856",
  "zlw543187459113764384","zl2235256473219383054",
  "ctm68188e11779d16c0779c018c",
  "ig17841446528067260","ig17841460097450702",
];

async function main() {
  console.log(DRY_RUN ? "🟡 DRY_RUN\n" : "🔴 LIVE\n");

  // 1. Pull all threads → thread_id → customer.pid
  console.log("Pulling all threads...");
  const threadIdToPid = new Map<string, { pid: string; platform?: string }>();
  const custIdToPid = new Map<string, { pid: string; platform?: string }>();
  for (const pp of PAGE_PIDS) {
    let skip = 0;
    for (let i = 0; i < 50; i++) {
      const res = await fetch(`${BASE}/bizs/${BIZ_SLUG}/threads`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ page_pids: [pp], skip, limit: 100 }),
      }).then(r => r.json()) as { data?: SmaxThread[] };
      const items = res.data || [];
      if (items.length === 0) break;
      for (const t of items) {
        if (t.id && t.customer?.pid) threadIdToPid.set(t.id, { pid: t.customer.pid, platform: t.platform });
        if (t.customer?.id && t.customer?.pid) custIdToPid.set(t.customer.id, { pid: t.customer.pid, platform: t.platform });
      }
      if (items.length < 100) break;
      skip += 100;
    }
  }
  console.log(`  ${threadIdToPid.size} thread_id → pid,  ${custIdToPid.size} smax_customer_id → pid (from threads)`);

  // 2. Pull customers to fill more custIdToPid
  console.log("Pulling customers...");
  const cRes = await fetch(`${BASE}/bizs/${BIZ_SLUG}/customers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ size: 10000 }),
  }).then(r => r.json()) as { data?: SmaxCust[] };
  for (const c of cRes.data ?? []) {
    if (c.id && c.pid) custIdToPid.set(c.id, { pid: c.pid, platform: c.platform });
  }
  console.log(`  smax_customer_id → pid total: ${custIdToPid.size}\n`);

  // 3. Find all leads that need backfilling: SMAX-related leads with null pid
  //    Get lead_ids from fact_touchpoint where source=smax, then check dim_lead
  console.log("Loading SMAX-touched leads with no external_profile_id...");
  const smaxLeadIds = new Set<string>();
  let from = 0;
  while (from < 200000) {
    const { data } = await admin.from("fact_touchpoint")
      .select("lead_id")
      .eq("source", "smax")
      .range(from, from + 999);
    if (!data?.length) break;
    for (const r of data) if (r.lead_id) smaxLeadIds.add(r.lead_id);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`  ${smaxLeadIds.size} unique lead_ids with SMAX touchpoints`);

  const arr = Array.from(smaxLeadIds);
  const nullPidLeads = new Set<string>();
  for (let i = 0; i < arr.length; i += 100) {
    const batch = arr.slice(i, i + 100);
    const { data } = await admin.from("dim_lead").select("lead_id").is("external_profile_id", null).in("lead_id", batch);
    for (const r of data ?? []) nullPidLeads.add(r.lead_id);
  }
  console.log(`  ${nullPidLeads.size} of those have no external_profile_id\n`);

  if (nullPidLeads.size === 0) { console.log("Nothing to do."); return; }

  // 4. For each null-pid lead, find their latest SMAX touchpoint's thread_id or smax_customer_id
  const leadToPid = new Map<string, { pid: string; platform?: string; via: string }>();
  const leadArr = Array.from(nullPidLeads);
  for (let i = 0; i < leadArr.length; i += 100) {
    const batch = leadArr.slice(i, i + 100);
    const { data } = await admin.from("fact_touchpoint")
      .select("lead_id, payload, occurred_at")
      .eq("source", "smax")
      .in("lead_id", batch)
      .order("occurred_at", { ascending: false });
    for (const tp of data ?? []) {
      if (leadToPid.has(tp.lead_id)) continue;  // already found latest
      const pl = tp.payload as Record<string, unknown>;
      // Try smax_customer_id first (more reliable)
      const scid = typeof pl.smax_customer_id === "string" ? pl.smax_customer_id : null;
      if (scid) {
        const m = custIdToPid.get(scid);
        if (m) { leadToPid.set(tp.lead_id, { pid: m.pid, platform: m.platform, via: "smax_customer_id" }); continue; }
      }
      // Try thread_id
      const tid = typeof pl.thread_id === "string" ? pl.thread_id : null;
      // thread_id in customer-endpoint payloads is prefixed "cust-" — strip it
      const cleanTid = tid?.startsWith("cust-") ? tid.slice(5) : tid;
      if (cleanTid) {
        const m = threadIdToPid.get(cleanTid);
        if (m) { leadToPid.set(tp.lead_id, { pid: m.pid, platform: m.platform, via: "thread_id" }); continue; }
        // "cust-<id>" means it came from /customers, and cleanTid IS the smax_customer_id
        if (tid?.startsWith("cust-")) {
          const m2 = custIdToPid.get(cleanTid);
          if (m2) { leadToPid.set(tp.lead_id, { pid: m2.pid, platform: m2.platform, via: "cust-thread_id" }); continue; }
        }
      }
    }
  }
  console.log(`Resolved pid for ${leadToPid.size} / ${nullPidLeads.size} leads`);
  const via: Record<string, number> = {};
  for (const v of leadToPid.values()) via[v.via] = (via[v.via] || 0) + 1;
  console.log(`  via:`, via);

  const unresolved = leadArr.filter(id => !leadToPid.has(id));
  console.log(`  ${unresolved.length} leads remain unresolved`);

  if (DRY_RUN) {
    console.log("\n🟡 DRY_RUN — sample updates:");
    let n = 0;
    for (const [lid, info] of leadToPid) {
      if (n++ >= 5) break;
      console.log(`  ${lid}  ← pid=${info.pid}  platform=${info.platform}  via=${info.via}`);
    }
    return;
  }

  // 5. Apply
  let updated = 0;
  for (const [lid, info] of leadToPid) {
    const patch: Record<string, string> = { external_profile_id: info.pid };
    if (info.platform) patch.external_platform = info.platform;
    const { error } = await admin.from("dim_lead").update(patch).eq("lead_id", lid);
    if (!error) updated++;
  }
  console.log(`\n✅ Backfilled ${updated}/${leadToPid.size} leads with pid from touchpoint payload`);
}
main().catch(e => { console.error(e); process.exit(1); });
