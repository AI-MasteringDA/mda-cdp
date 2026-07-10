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

type SmaxCust = { id: string; pid?: string; platform?: string; email?: unknown; phone?: unknown; emails?: string[]; phones?: string[] };

async function main() {
  console.log(DRY_RUN ? "🟡 DRY_RUN\n" : "🔴 LIVE\n");

  const custRes = await fetch(`${BASE}/bizs/${BIZ_SLUG}/customers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ size: 10000 }),
  }).then(r => r.json()) as { data?: SmaxCust[]; total?: number };
  const customers = custRes.data ?? [];
  console.log(`Got ${customers.length} SMAX customers (SMAX total: ${custRes.total})`);

  // Map: email → pid, phone → pid (from SMAX customers with pid)
  const emailToPid = new Map<string, { pid: string; platform?: string }>();
  const phoneToPid = new Map<string, { pid: string; platform?: string }>();
  for (const c of customers) {
    if (!c.pid) continue;
    const email = (asStr(c.email) || asStr(c.emails?.[0]))?.toLowerCase();
    const rawPhone = asStr(c.phone) || asStr(c.phones?.[0]);
    const phone = rawPhone ? normalizePhone(rawPhone) : undefined;
    if (email && !emailToPid.has(email)) emailToPid.set(email, { pid: c.pid, platform: c.platform });
    if (phone && !phoneToPid.has(phone)) phoneToPid.set(phone, { pid: c.pid, platform: c.platform });
  }
  console.log(`Built lookup: ${emailToPid.size} email→pid, ${phoneToPid.size} phone→pid\n`);

  // Load all leads with no external_profile_id but have email or phone
  const leads: Array<{ lead_id: string; email: string | null; phone: string | null; external_profile_id: string | null; external_platform: string | null; source: string }> = [];
  let from = 0;
  while (from < 100000) {
    const { data } = await admin.from("dim_lead")
      .select("lead_id, email, phone, external_profile_id, external_platform, source")
      .is("external_profile_id", null)
      .range(from, from + 999);
    if (!data?.length) break;
    leads.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`${leads.length} dim_lead rows with no external_profile_id`);

  const toUpdate: Array<{ lead_id: string; pid: string; platform?: string; via: string }> = [];
  for (const l of leads) {
    const emailKey = l.email?.toLowerCase().trim() || null;
    const emailMatch = emailKey ? emailToPid.get(emailKey) : undefined;
    const phoneMatch = l.phone ? phoneToPid.get(normalizePhone(l.phone)) : undefined;
    const match = emailMatch || phoneMatch;
    if (match) toUpdate.push({ lead_id: l.lead_id, pid: match.pid, platform: match.platform, via: emailMatch ? "email" : "phone" });
  }
  console.log(`${toUpdate.length} leads can be backfilled with SMAX pid\n`);

  console.log("Sample 5:");
  toUpdate.slice(0, 5).forEach(u => console.log(`  ${u.lead_id}  ← pid=${u.pid}  platform=${u.platform || "?"}  via=${u.via}`));

  if (DRY_RUN) { console.log("\n🟡 DRY_RUN"); return; }

  let updated = 0;
  for (const u of toUpdate) {
    const patch: Record<string, string> = { external_profile_id: u.pid };
    if (u.platform) patch.external_platform = u.platform;
    const { error } = await admin.from("dim_lead").update(patch).eq("lead_id", u.lead_id);
    if (!error) updated++;
  }
  console.log(`\n✅ Backfilled external_profile_id on ${updated}/${toUpdate.length} leads`);
}
main().catch(e => { console.error(e); process.exit(1); });
