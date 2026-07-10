import { admin } from "../lib/supabase-admin";

const TOKEN = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const BASE = process.env.SMAX_BASE_URL || "https://api.smax.ai";
const BIZ_SLUG = "mastering-data-analytics";
const DRY_RUN = process.env.DRY_RUN !== "0";

function normalizePhone(p: string): string {
  const cleaned = p.replace(/[\s\-()]/g, "");
  if (cleaned.startsWith("+84")) return "0" + cleaned.slice(3);
  if (cleaned.startsWith("84") && cleaned.length === 11 && /^84[3-9]/.test(cleaned)) return "0" + cleaned.slice(2);
  if (cleaned.length === 9 && /^[3-9]/.test(cleaned)) return "0" + cleaned;
  return cleaned;
}
function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v.trim() || undefined : undefined;
}
function pickAvatarColor(seed: string): string {
  const colors = ["#FCE7F3", "#DBEAFE", "#FEF3C7", "#D1FAE5", "#EDE9FE", "#FEE2E2"];
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
}

type SmaxCust = {
  id: string;
  name?: unknown;
  profile_name?: unknown;
  email?: unknown;
  phone?: unknown;
  emails?: string[];
  phones?: string[];
  platform?: string;
  page_pid?: string;
  pid?: string;
  interaction?: { first?: string; last?: string };
  tags?: Array<string | { name?: string; alias?: string }>;
};

async function main() {
  console.log(DRY_RUN ? "🟡 DRY_RUN — set DRY_RUN=0 to apply.\n" : "🔴 LIVE\n");

  // 1. Pull SMAX customers → build lookup by id
  const custRes = await fetch(`${BASE}/bizs/${BIZ_SLUG}/customers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ size: 10000 }),
  }).then(r => r.json()) as { data?: SmaxCust[]; total?: number };
  const customers = new Map<string, SmaxCust>();
  for (const c of custRes.data ?? []) customers.set(c.id, c);
  console.log(`Loaded ${customers.size} SMAX customers`);

  // 2. Find fact_touchpoint from /customers endpoint (source_endpoint='customers')
  //    that DO NOT have a matching dim_lead source=smax by smax_customer_id.
  //    Those are orphaned touchpoints from the merge — their smax-lead was deleted.
  //    We iterate paginated.
  const merged: Map<string, { smax_customer_id: string; currentLeadId: string; touchpointIds: string[]; customerName?: string; platform?: string; pid?: string; occurredAtEarliest?: string }> = new Map();
  let from = 0;
  while (from < 200000) {
    const { data } = await admin
      .from("fact_touchpoint")
      .select("id, lead_id, payload, occurred_at")
      .eq("source", "smax")
      .range(from, from + 999);
    if (!data?.length) break;
    for (const tp of data) {
      const pl = tp.payload as Record<string, unknown> | null;
      if (!pl) continue;
      if (pl.source_endpoint !== "customers") continue;  // only /customers-endpoint touchpoints were tied to smax leads
      const scid = asStr(pl.smax_customer_id);
      if (!scid) continue;
      let entry = merged.get(scid);
      if (!entry) {
        entry = {
          smax_customer_id: scid,
          currentLeadId: tp.lead_id,
          touchpointIds: [],
          customerName: asStr(pl.customer_name),
          platform: asStr(pl.platform),
          pid: undefined,
          occurredAtEarliest: tp.occurred_at as string,
        };
        merged.set(scid, entry);
      }
      entry.touchpointIds.push(tp.id);
      if (tp.occurred_at && (!entry.occurredAtEarliest || tp.occurred_at < entry.occurredAtEarliest)) {
        entry.occurredAtEarliest = tp.occurred_at as string;
      }
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`\n${merged.size} distinct smax_customer_ids seen in customer-endpoint touchpoints`);

  // 3. Which of these DON'T have a smax-source dim_lead? Those are the orphans.
  const scids = Array.from(merged.keys());
  const existingSmaxLeadIds = new Set<string>();
  for (let i = 0; i < scids.length; i += 100) {
    const batch = scids.slice(i, i + 100);
    const { data } = await admin.from("dim_lead").select("smax_customer_id").eq("source", "smax").in("smax_customer_id", batch);
    for (const r of data ?? []) if (r.smax_customer_id) existingSmaxLeadIds.add(r.smax_customer_id);
  }
  const orphans = Array.from(merged.entries()).filter(([scid]) => !existingSmaxLeadIds.has(scid));
  console.log(`   ↳ ${orphans.length} orphans (their smax-lead was deleted during merge)\n`);

  // 4. For each orphan, restore the dim_lead and re-link touchpoints back
  const restorePlan = orphans.map(([scid, info]) => {
    const c = customers.get(scid);
    const nameFromApi = asStr(c?.name) || asStr(c?.profile_name);
    const finalName = info.customerName || nameFromApi || "(SMAX customer)";
    const email = (asStr(c?.email) || asStr(c?.emails?.[0]))?.toLowerCase();
    const rawPhone = asStr(c?.phone) || asStr(c?.phones?.[0]);
    const phone = rawPhone ? normalizePhone(rawPhone) : undefined;
    const tags: string[] = [];
    for (const t of c?.tags ?? []) {
      const name = typeof t === "string" ? t : (t?.name || t?.alias);
      if (name && typeof name === "string") tags.push(name.trim());
    }
    return {
      smax_customer_id: scid,
      currentLeadId: info.currentLeadId,
      touchpointIds: info.touchpointIds,
      name: finalName,
      email,
      phone,
      platform: c?.platform || info.platform || null,
      pid: c?.pid || null,
      tags,
      firstSeen: info.occurredAtEarliest || new Date().toISOString(),
    };
  });

  console.log(`Sample 5 restore plans:`);
  restorePlan.slice(0, 5).forEach(r =>
    console.log(`  smax_cust ${r.smax_customer_id.slice(0, 12)}... name=${r.name}  email=${r.email || "-"}  phone=${r.phone || "-"}  tags=${r.tags.length}  tp_count=${r.touchpointIds.length}`)
  );

  if (DRY_RUN) { console.log("\n🟡 DRY_RUN"); return; }

  // 5. Restore in batches
  let restored = 0, relinked = 0;
  for (const r of restorePlan) {
    // Insert new dim_lead
    const { data: newLead, error: e1 } = await admin.from("dim_lead").insert({
      full_name: r.name,
      email: r.email || null,
      phone: r.phone || null,
      source: "smax",
      stage: "Mới",
      avatar_color: pickAvatarColor(r.smax_customer_id),
      first_seen_at: r.firstSeen,
      smax_customer_id: r.smax_customer_id,
      external_platform: r.platform,
      external_profile_id: r.pid,
      smax_tags: r.tags,
    }).select("lead_id").single();
    if (e1 || !newLead) {
      console.warn(`   ⚠️ insert lead for ${r.smax_customer_id.slice(0, 12)}: ${e1?.message.slice(0, 100) || "?"}`);
      continue;
    }
    restored++;
    // Move touchpoints back
    for (let i = 0; i < r.touchpointIds.length; i += 100) {
      const batch = r.touchpointIds.slice(i, i + 100);
      const { error: e2 } = await admin.from("fact_touchpoint").update({ lead_id: newLead.lead_id }).in("id", batch);
      if (!e2) relinked += batch.length;
    }
  }
  console.log(`\n✅ Restored ${restored} smax-source leads`);
  console.log(`✅ Re-linked ${relinked} touchpoints back to restored leads`);
}
main().catch(e => { console.error(e); process.exit(1); });
