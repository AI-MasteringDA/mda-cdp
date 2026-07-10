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

const PAGE_PIDS = [
  "fb102323788540150", "fb107203051058856",
  "zlw543187459113764384", "zl2235256473219383054",
  "ctm68188e11779d16c0779c018c",
  "ig17841446528067260", "ig17841460097450702",
];

type SmaxThread = { id: string; platform?: string; customer?: { id?: string; pid?: string; email?: unknown; phone?: unknown; name?: unknown; profile_name?: unknown } };

async function main() {
  console.log(DRY_RUN ? "🟡 DRY_RUN\n" : "🔴 LIVE\n");

  // 1. Pull threads across all pages
  const allThreads: SmaxThread[] = [];
  for (const pagePid of PAGE_PIDS) {
    let skip = 0;
    for (let page = 0; page < 50; page++) {
      const res = await fetch(`${BASE}/bizs/${BIZ_SLUG}/threads`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ page_pids: [pagePid], skip, limit: 100 }),
      }).then(r => r.json()) as { data?: SmaxThread[] };
      const items = res.data || [];
      if (items.length === 0) break;
      allThreads.push(...items);
      if (items.length < 100) break;
      skip += 100;
    }
    console.log(`  ${pagePid.slice(0, 20)}... → ${allThreads.length} total so far`);
  }
  console.log(`\nGot ${allThreads.length} threads`);

  // 2. Build lookups from threads (customer_id → pid, email → pid, phone → pid, name → pid)
  const custIdToPid = new Map<string, { pid: string; platform?: string }>();
  const emailToPid = new Map<string, { pid: string; platform?: string }>();
  const phoneToPid = new Map<string, { pid: string; platform?: string }>();
  for (const t of allThreads) {
    const c = t.customer;
    if (!c?.pid) continue;
    const entry = { pid: c.pid, platform: t.platform };
    if (c.id && !custIdToPid.has(c.id)) custIdToPid.set(c.id, entry);
    const email = asStr(c.email)?.toLowerCase();
    if (email && !emailToPid.has(email)) emailToPid.set(email, entry);
    const rawPhone = asStr(c.phone);
    if (rawPhone) {
      const phone = normalizePhone(rawPhone);
      if (!phoneToPid.has(phone)) phoneToPid.set(phone, entry);
    }
  }
  console.log(`Lookup: ${custIdToPid.size} smax_customer_id→pid, ${emailToPid.size} email→pid, ${phoneToPid.size} phone→pid\n`);

  // 3. Load dim_lead rows with null external_profile_id
  const leads: Array<{ lead_id: string; email: string | null; phone: string | null; smax_customer_id: string | null }> = [];
  let from = 0;
  while (from < 100000) {
    const { data } = await admin.from("dim_lead")
      .select("lead_id, email, phone, smax_customer_id")
      .is("external_profile_id", null)
      .range(from, from + 999);
    if (!data?.length) break;
    leads.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`${leads.length} dim_lead rows still missing external_profile_id`);

  const toUpdate: Array<{ lead_id: string; pid: string; platform?: string; via: string }> = [];
  for (const l of leads) {
    // smax_customer_id first (most reliable)
    if (l.smax_customer_id) {
      const m = custIdToPid.get(l.smax_customer_id);
      if (m) { toUpdate.push({ lead_id: l.lead_id, pid: m.pid, platform: m.platform, via: "smax_id" }); continue; }
    }
    const emailKey = l.email?.toLowerCase().trim();
    if (emailKey) {
      const m = emailToPid.get(emailKey);
      if (m) { toUpdate.push({ lead_id: l.lead_id, pid: m.pid, platform: m.platform, via: "email" }); continue; }
    }
    if (l.phone) {
      const m = phoneToPid.get(normalizePhone(l.phone));
      if (m) { toUpdate.push({ lead_id: l.lead_id, pid: m.pid, platform: m.platform, via: "phone" }); continue; }
    }
  }
  console.log(`${toUpdate.length} leads can be backfilled from threads\n`);

  const byVia: Record<string, number> = {};
  toUpdate.forEach(u => byVia[u.via] = (byVia[u.via] || 0) + 1);
  console.log("Matched via:", byVia);
  console.log("\nSample 5:");
  toUpdate.slice(0, 5).forEach(u => console.log(`  ${u.lead_id}  pid=${u.pid.slice(0, 25)}  via=${u.via}`));

  if (DRY_RUN) { console.log("\n🟡 DRY_RUN"); return; }

  let updated = 0;
  for (const u of toUpdate) {
    const patch: Record<string, string> = { external_profile_id: u.pid };
    if (u.platform) patch.external_platform = u.platform;
    const { error } = await admin.from("dim_lead").update(patch).eq("lead_id", u.lead_id);
    if (!error) updated++;
  }
  console.log(`\n✅ Backfilled ${updated}/${toUpdate.length} leads from thread data`);
}
main().catch(e => { console.error(e); process.exit(1); });
