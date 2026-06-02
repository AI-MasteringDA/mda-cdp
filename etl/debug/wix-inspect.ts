import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const WIX_API_KEY = process.env.WIX_API_KEY!;
const WIX_ACCOUNT_ID = process.env.WIX_ACCOUNT_ID!;
const WIX_SITE_ID_ENV = process.env.WIX_SITE_ID;
const BASE = process.env.WIX_BASE_URL || "https://www.wixapis.com";

async function wixFetch(path: string, init: RequestInit = {}, siteId?: string) {
  // Account-level (no siteId): send wix-account-id only
  // Site-level (with siteId): send wix-site-id only (account is auto-derived from site)
  const headers: Record<string, string> = {
    Authorization: WIX_API_KEY,
    "Content-Type": "application/json",
    "User-Agent": "MDA-CDP/1.0",
    Accept: "application/json",
    ...(init.headers as Record<string, string> || {}),
  };
  if (siteId) headers["wix-site-id"] = siteId;
  else headers["wix-account-id"] = WIX_ACCOUNT_ID;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    console.error(`❌ ${res.status} ${path}:`, JSON.stringify(body, null, 2).slice(0, 500));
    throw new Error(`${res.status}`);
  }
  return body;
}

async function main() {
  console.log("=== Wix API Inspect ===\n");

  // 1. List sites
  console.log("--- 1. Site List ---");
  type Site = { id: string; displayName: string; url?: string };
  const sites = await wixFetch("/site-list/v2/sites/query", {
    method: "POST",
    body: JSON.stringify({ query: { paging: { limit: 50 } } }),
  }) as { sites?: Site[] };
  console.log(`Found ${sites?.sites?.length || 0} sites:`);
  for (const s of sites?.sites || []) {
    console.log(`  - ${s.displayName} | id=${s.id} | url=${s.url || "—"}`);
  }
  const primarySite = sites?.sites?.[0];
  const SITE_ID = WIX_SITE_ID_ENV || primarySite?.id;
  if (!SITE_ID) { console.error("No site found!"); return; }
  console.log(`\n👉 Using SITE_ID = ${SITE_ID}\n`);

  // 2. Contacts
  console.log("--- 2. Contacts (Wix CRM) ---");
  try {
    type Contact = { id: string; info?: { name?: { first?: string; last?: string }; emails?: { items?: { email?: string }[] }; phones?: { items?: { phone?: string }[] } }; createdDate?: string; lastActivity?: { activityDate?: string; activityType?: string }; primaryInfo?: { email?: string; phone?: string; name?: string } };
    const contacts = await wixFetch(`/contacts/v4/contacts/query`, {
      method: "POST",
      body: JSON.stringify({ query: { paging: { limit: 5 } } }),
    }, SITE_ID) as { contacts?: Contact[]; metadata?: { total?: number; count?: number } };
    console.log(`Total contacts: ${contacts?.metadata?.total ?? "?"}`);
    console.log(`Sample (${contacts?.contacts?.length || 0}):`);
    for (const c of contacts?.contacts || []) {
      const name = `${c.info?.name?.first || ""} ${c.info?.name?.last || ""}`.trim() || c.primaryInfo?.name || "—";
      const email = c.info?.emails?.items?.[0]?.email || c.primaryInfo?.email || "—";
      const phone = c.info?.phones?.items?.[0]?.phone || c.primaryInfo?.phone || "—";
      console.log(`  - ${name} | ${email} | ${phone} | created=${c.createdDate?.slice(0, 10)} | last=${c.lastActivity?.activityType || "—"}`);
    }
  } catch (e) { console.warn("⚠️ Contacts failed:", (e as Error).message); }

  // 3. Form submissions
  console.log("\n--- 3. Form Submissions ---");
  try {
    type Submission = { id: string; formId?: string; submitter?: { submitterId?: string; submitterType?: string }; submissions?: Record<string, unknown>; createdDate?: string };
    const subs = await wixFetch(`/form-app/v4/submissions/query`, {
      method: "POST",
      body: JSON.stringify({ query: { paging: { limit: 5 } } }),
    }, SITE_ID) as { submissions?: Submission[]; metadata?: { total?: number } };
    console.log(`Total submissions: ${subs?.metadata?.total ?? "?"}`);
    for (const s of subs?.submissions?.slice(0, 3) || []) {
      console.log(`  - ${s.createdDate?.slice(0, 10)} | form=${s.formId} | fields=${Object.keys(s.submissions || {}).join(", ")}`);
    }
  } catch (e) { console.warn("⚠️ Forms failed:", (e as Error).message); }

  // 4. Bookings
  console.log("\n--- 4. Bookings ---");
  try {
    type Booking = { id: string; bookedEntity?: { title?: string }; contactDetails?: { firstName?: string; email?: string }; status?: string; createdDate?: string };
    const bookings = await wixFetch(`/bookings/v2/bookings/query`, {
      method: "POST",
      body: JSON.stringify({ query: { paging: { limit: 5 } } }),
    }, SITE_ID) as { bookings?: Booking[]; metadata?: { total?: number } };
    console.log(`Total bookings: ${bookings?.metadata?.total ?? "?"}`);
    for (const b of bookings?.bookings?.slice(0, 3) || []) {
      console.log(`  - ${b.createdDate?.slice(0, 10)} | ${b.bookedEntity?.title} | ${b.contactDetails?.email} | ${b.status}`);
    }
  } catch (e) { console.warn("⚠️ Bookings not available:", (e as Error).message); }

  // 5. Stores / Orders
  console.log("\n--- 5. Stores Orders ---");
  try {
    type Order = { id: string; buyerInfo?: { email?: string }; totals?: { total?: string }; createdDate?: string; paymentStatus?: string };
    const orders = await wixFetch(`/stores/v2/orders/query`, {
      method: "POST",
      body: JSON.stringify({ query: { paging: { limit: 5 } } }),
    }, SITE_ID) as { orders?: Order[]; metadata?: { total?: number } };
    console.log(`Total orders: ${orders?.metadata?.total ?? "?"}`);
    for (const o of orders?.orders?.slice(0, 3) || []) {
      console.log(`  - ${o.createdDate?.slice(0, 10)} | ${o.buyerInfo?.email} | ${o.totals?.total} | ${o.paymentStatus}`);
    }
  } catch (e) { console.warn("⚠️ Stores not available:", (e as Error).message); }

  // 6. Members
  console.log("\n--- 6. Members ---");
  try {
    type Member = { id: string; loginEmail?: string; contact?: { firstName?: string; lastName?: string }; status?: string; createdDate?: string };
    const members = await wixFetch(`/members/v1/members/query`, {
      method: "POST",
      body: JSON.stringify({ query: { paging: { limit: 5 } } }),
    }, SITE_ID) as { members?: Member[]; metadata?: { total?: number } };
    console.log(`Total members: ${members?.metadata?.total ?? "?"}`);
    for (const m of members?.members?.slice(0, 3) || []) {
      console.log(`  - ${m.createdDate?.slice(0, 10)} | ${m.contact?.firstName} ${m.contact?.lastName} | ${m.loginEmail} | ${m.status}`);
    }
  } catch (e) { console.warn("⚠️ Members not available:", (e as Error).message); }

  console.log(`\n=== DONE ===\nSITE_ID for .env.local: ${SITE_ID}`);
}

main().catch(console.error);
