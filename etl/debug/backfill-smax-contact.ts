import { admin } from "../lib/supabase-admin";

const TOKEN = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const BASE = process.env.SMAX_BASE_URL || "https://api.smax.ai";
const BIZ_SLUG = "mastering-data-analytics";
const DRY_RUN = process.env.DRY_RUN !== "0";  // default DRY_RUN=1

function normalizePhone(p: string): string {
  const cleaned = p.replace(/[\s\-()]/g, "");
  if (cleaned.startsWith("+84")) return "0" + cleaned.slice(3);
  // "84918688618" (11 digits, no +) → "0918688618"
  if (cleaned.startsWith("84") && cleaned.length === 11 && /^84[3-9]/.test(cleaned)) return "0" + cleaned.slice(2);
  if (cleaned.length === 9 && /^[3-9]/.test(cleaned)) return "0" + cleaned;
  return cleaned;
}

type SmaxCust = { id: string; email?: string; phone?: string; emails?: string[]; phones?: string[]; name?: string; profile_name?: string };

async function main() {
  if (DRY_RUN) console.log("🟡 DRY_RUN mode — set DRY_RUN=0 to apply changes.\n");
  else console.log("🔴 LIVE mode — will mutate DB.\n");

  // 1. Load SMAX customers (size=10000 hard cap on SMAX side; skip is ignored)
  console.log("Fetching SMAX /customers (size=10000)...");
  const custRes = await fetch(`${BASE}/bizs/${BIZ_SLUG}/customers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ size: 10000 }),
  }).then(r => r.json()) as { data?: SmaxCust[]; total?: number };
  const customers = custRes.data ?? [];
  console.log(`Got ${customers.length} customers (SMAX total: ${custRes.total})\n`);

  // Build map: smax_customer_id → {email, phone, name}
  const smaxInfo = new Map<string, { email?: string; phone?: string; name?: string }>();
  const asString = (v: unknown): string | undefined => {
    if (v == null) return undefined;
    if (typeof v === "string") return v.trim() || undefined;
    if (typeof v === "number") return String(v);
    return undefined;
  };
  for (const c of customers) {
    const rawEmail = asString(c.email) || asString(c.emails?.[0]);
    const email = rawEmail?.toLowerCase().trim() || undefined;
    const rawPhone = asString(c.phone) || asString(c.phones?.[0]);
    const phone = rawPhone ? normalizePhone(rawPhone) : undefined;
    const name = asString(c.name) || asString(c.profile_name);
    if (email || phone) smaxInfo.set(c.id, { email, phone, name });
  }
  console.log(`${smaxInfo.size} SMAX customers have email or phone\n`);

  // 2. Load all dim_lead where source=smax
  const smaxLeads: Array<{ lead_id: string; email: string | null; phone: string | null; full_name: string | null; smax_customer_id: string | null }> = [];
  let from = 0;
  while (from < 100000) {
    const { data } = await admin.from("dim_lead")
      .select("lead_id, email, phone, full_name, smax_customer_id")
      .eq("source", "smax")
      .range(from, from + 999);
    if (!data?.length) break;
    smaxLeads.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`${smaxLeads.length} dim_lead rows with source=smax\n`);

  // 3. Find leads where we can backfill
  const toBackfill: Array<{ lead_id: string; email?: string; phone?: string }> = [];
  const emptyLeads = smaxLeads.filter(l => !l.email && !l.phone && l.smax_customer_id);
  console.log(`${emptyLeads.length} smax-source leads have no email AND no phone AND have smax_customer_id`);
  for (const l of emptyLeads) {
    const info = smaxInfo.get(l.smax_customer_id!);
    if (!info) continue;
    if (info.email || info.phone) toBackfill.push({ lead_id: l.lead_id, email: info.email, phone: info.phone });
  }
  console.log(`   ↳ ${toBackfill.length} can be backfilled from SMAX API\n`);

  // 4. For each backfillable lead, check if email/phone matches an EXISTING lead — merge if so
  //    else just UPDATE the lead's email/phone
  const emailsToLookup = new Set(toBackfill.map(l => l.email).filter(Boolean) as string[]);
  const phonesToLookup = new Set(toBackfill.map(l => l.phone).filter(Boolean) as string[]);
  const emailToLeadId = new Map<string, string>();
  const phoneToLeadId = new Map<string, string>();
  const emailsArr = Array.from(emailsToLookup);
  const phonesArr = Array.from(phonesToLookup);
  for (let i = 0; i < emailsArr.length; i += 100) {
    const batch = emailsArr.slice(i, i + 100);
    const { data } = await admin.from("dim_lead").select("lead_id, email, source").in("email", batch).neq("source", "smax");
    for (const r of data ?? []) if (r.email) emailToLeadId.set(r.email.toLowerCase().trim(), r.lead_id);
  }
  for (let i = 0; i < phonesArr.length; i += 100) {
    const batch = phonesArr.slice(i, i + 100);
    const { data } = await admin.from("dim_lead").select("lead_id, phone, source").in("phone", batch).neq("source", "smax");
    for (const r of data ?? []) if (r.phone) phoneToLeadId.set(normalizePhone(r.phone), r.lead_id);
  }
  console.log(`${emailToLeadId.size} of ${emailsToLookup.size} emails match non-SMAX leads`);
  console.log(`${phoneToLeadId.size} of ${phonesToLookup.size} phones match non-SMAX leads\n`);

  // 5. Classify & execute
  let willMerge = 0, willUpdate = 0;
  const merges: Array<{ smaxLeadId: string; targetLeadId: string; matchedBy: string }> = [];
  const updates: Array<{ lead_id: string; email?: string; phone?: string }> = [];

  for (const b of toBackfill) {
    const targetByEmail = b.email ? emailToLeadId.get(b.email) : undefined;
    const targetByPhone = b.phone ? phoneToLeadId.get(b.phone) : undefined;
    const target = targetByEmail || targetByPhone;
    if (target && target !== b.lead_id) {
      merges.push({ smaxLeadId: b.lead_id, targetLeadId: target, matchedBy: targetByEmail ? "email" : "phone" });
      willMerge++;
    } else {
      updates.push({ lead_id: b.lead_id, email: b.email, phone: b.phone });
      willUpdate++;
    }
  }
  console.log(`📋 Plan: MERGE ${willMerge}  ·  UPDATE-in-place ${willUpdate}\n`);

  console.log("Sample 5 MERGE actions:");
  merges.slice(0, 5).forEach(m => console.log(`  ${m.smaxLeadId} → ${m.targetLeadId}  (by ${m.matchedBy})`));
  console.log("\nSample 5 UPDATE-in-place actions:");
  updates.slice(0, 5).forEach(u => console.log(`  ${u.lead_id}  ← email=${u.email || ""}  phone=${u.phone || ""}`));

  if (DRY_RUN) {
    console.log("\n🟡 DRY_RUN — no changes made. Rerun with DRY_RUN=0 to apply.");
    return;
  }

  // Execute UPDATEs in batches
  let updated = 0;
  for (const u of updates) {
    const patch: Record<string, string> = {};
    if (u.email) patch.email = u.email;
    if (u.phone) patch.phone = u.phone;
    if (!Object.keys(patch).length) continue;
    const { error } = await admin.from("dim_lead").update(patch).eq("lead_id", u.lead_id);
    if (!error) updated++;
    else console.warn(`   ⚠️ update ${u.lead_id}: ${error.message.slice(0, 100)}`);
  }
  console.log(`\n✅ Updated ${updated}/${updates.length} smax leads with contact info`);

  // Execute MERGE: touchpoints.lead_id = target, then delete smax lead
  let merged = 0;
  for (const m of merges) {
    // Move touchpoints (may be many)
    const { error: e1 } = await admin.from("fact_touchpoint").update({ lead_id: m.targetLeadId }).eq("lead_id", m.smaxLeadId);
    if (e1) { console.warn(`   ⚠️ move tp ${m.smaxLeadId}: ${e1.message.slice(0, 100)}`); continue; }
    // Move fact_lead_score if any
    await admin.from("fact_lead_score").update({ lead_id: m.targetLeadId }).eq("lead_id", m.smaxLeadId);
    // Delete duplicate smax dim_lead
    const { error: e2 } = await admin.from("dim_lead").delete().eq("lead_id", m.smaxLeadId);
    if (e2) { console.warn(`   ⚠️ delete ${m.smaxLeadId}: ${e2.message.slice(0, 100)}`); continue; }
    merged++;
  }
  console.log(`✅ Merged ${merged}/${merges.length} duplicate smax leads into their email/phone-matched leads`);
}

main().catch(e => { console.error(e); process.exit(1); });
