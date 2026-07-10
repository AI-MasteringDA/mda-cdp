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

async function main() {
  console.log(DRY_RUN ? "🟡 DRY_RUN — set DRY_RUN=0 to apply.\n" : "🔴 LIVE\n");

  // Load SMAX customers with email+phone
  const custRes = await fetch(`${BASE}/bizs/${BIZ_SLUG}/customers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ size: 10000 }),
  }).then(r => r.json()) as { data?: Array<{ id: string; email?: unknown; phone?: unknown; emails?: string[]; phones?: string[] }>; total?: number };
  const customers = custRes.data ?? [];
  const asString = (v: unknown): string | undefined => typeof v === "string" ? v.trim() || undefined : undefined;

  // email → phone from SMAX
  const emailToPhone = new Map<string, string>();
  for (const c of customers) {
    const email = (asString(c.email) || asString(c.emails?.[0]))?.toLowerCase();
    const rawPhone = asString(c.phone) || asString(c.phones?.[0]);
    if (email && rawPhone) emailToPhone.set(email, normalizePhone(rawPhone));
  }
  console.log(`${emailToPhone.size} SMAX customers have BOTH email + phone`);

  // Find non-SMAX leads whose email matches, and phone is null
  const emailsArr = Array.from(emailToPhone.keys());
  const toPatch: Array<{ lead_id: string; email: string; phone: string; oldPhone: string | null }> = [];
  for (let i = 0; i < emailsArr.length; i += 100) {
    const batch = emailsArr.slice(i, i + 100);
    const { data } = await admin.from("dim_lead").select("lead_id, email, phone").in("email", batch);
    for (const r of data ?? []) {
      if (!r.email || r.phone) continue;
      const smaxPhone = emailToPhone.get(r.email.toLowerCase().trim());
      if (smaxPhone) toPatch.push({ lead_id: r.lead_id, email: r.email, phone: smaxPhone, oldPhone: r.phone });
    }
  }
  console.log(`\n${toPatch.length} existing leads have email match + missing phone (backfillable)\n`);
  toPatch.slice(0, 5).forEach(p => console.log(`  ${p.lead_id}  ${p.email}  ← phone ${p.phone}`));

  if (DRY_RUN) { console.log("\n🟡 DRY_RUN"); return; }

  let updated = 0;
  for (const p of toPatch) {
    const { error } = await admin.from("dim_lead").update({ phone: p.phone }).eq("lead_id", p.lead_id);
    if (!error) updated++;
    else console.warn(`   ⚠️ ${p.lead_id}: ${error.message.slice(0, 80)}`);
  }
  console.log(`\n✅ Backfilled phone on ${updated}/${toPatch.length} leads`);
}
main().catch(e => { console.error(e); process.exit(1); });
