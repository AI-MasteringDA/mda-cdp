import { admin } from "../lib/supabase-admin";

const TOKEN = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const BASE = process.env.SMAX_BASE_URL || "https://api.smax.ai";
const BIZ_SLUG = "mastering-data-analytics";

async function main() {
  // 1. Query lead
  const { data: leads } = await admin.from("dim_lead")
    .select("lead_id, full_name, email, phone, external_profile_id, external_platform, source, smax_customer_id")
    .or("email.eq.tathimy.duyen@gmail.com,full_name.ilike.%Duyen%");
  console.log("All leads with tathimy.duyen@gmail.com OR name~Duyen:");
  leads?.forEach(l => console.log(`  ${l.full_name}  src=${l.source}  email=${l.email}  phone=${l.phone}  ext_pid=${l.external_profile_id}  smax_cust=${l.smax_customer_id}`));

  // 2. Search SMAX customers by email
  console.log("\nSearch SMAX /customers for 'tathimy.duyen@gmail.com':");
  const cRes = await fetch(`${BASE}/bizs/${BIZ_SLUG}/customers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ size: 10000 }),
  }).then(r => r.json()) as { data?: Array<Record<string, unknown>> };
  const matches = (cRes.data ?? []).filter(c => {
    const e = String(c.email || "").toLowerCase();
    const es = Array.isArray(c.emails) ? c.emails.map(x => String(x).toLowerCase()) : [];
    return e === "tathimy.duyen@gmail.com" || es.includes("tathimy.duyen@gmail.com");
  });
  console.log(`  Found ${matches.length} customer(s) with this email in first 10000`);
  matches.forEach(c => console.log(`    id=${c.id}  pid=${c.pid}  platform=${c.platform}  name=${c.name || c.profile_name}`));

  // 3. Search /threads
  console.log("\nSearch SMAX /threads with customer.email tathimy.duyen@gmail.com:");
  const PAGE_PIDS = ["fb102323788540150","fb107203051058856","zlw543187459113764384","zl2235256473219383054","ctm68188e11779d16c0779c018c","ig17841446528067260","ig17841460097450702"];
  const threadMatches: Array<Record<string, unknown>> = [];
  for (const pp of PAGE_PIDS) {
    let skip = 0;
    for (let i = 0; i < 50; i++) {
      const res = await fetch(`${BASE}/bizs/${BIZ_SLUG}/threads`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ page_pids: [pp], skip, limit: 100 }),
      }).then(r => r.json()) as { data?: Array<{ customer?: { email?: string; pid?: string; id?: string; name?: string } }> };
      const items = res.data || [];
      if (items.length === 0) break;
      for (const t of items) {
        if (String(t.customer?.email || "").toLowerCase() === "tathimy.duyen@gmail.com") {
          threadMatches.push({ platform: pp.slice(0, 3), cust_id: t.customer?.id, cust_pid: t.customer?.pid, name: t.customer?.name });
        }
      }
      if (items.length < 100) break;
      skip += 100;
    }
  }
  console.log(`  Found ${threadMatches.length} thread(s):`);
  threadMatches.forEach(t => console.log(`    platform=${t.platform}  cust_id=${t.cust_id}  cust_pid=${t.cust_pid}  name=${t.name}`));
}
main().catch(e => { console.error(e); process.exit(1); });
