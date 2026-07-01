import { admin } from "../lib/supabase-admin";
import { batchResolveOrCreate, logMatches } from "../lib/identity";

const WIX_API_KEY = process.env.WIX_API_KEY!;
const WIX_ACCOUNT_ID = process.env.WIX_ACCOUNT_ID!;
const WIX_SITE_ID = process.env.WIX_SITE_ID!;
const BASE = process.env.WIX_BASE_URL || "https://www.wixapis.com";

async function wixFetch(path: string, init: RequestInit = {}, siteId?: string) {
  const headers: Record<string, string> = {
    Authorization: WIX_API_KEY,
    "Content-Type": "application/json",
    "User-Agent": "MDA-CDP/1.0",
    Accept: "application/json",
  };
  if (siteId) headers["wix-site-id"] = siteId;
  else headers["wix-account-id"] = WIX_ACCOUNT_ID;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Wix ${res.status} ${path}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

type WixContact = {
  id: string;
  revision?: number;
  source?: { sourceType?: string; appId?: string };
  createdDate?: string;
  updatedDate?: string;
  lastActivity?: { activityDate?: string; activityType?: string };
  primaryInfo?: { email?: string; phone?: string; name?: string };
  info?: {
    name?: { first?: string; last?: string };
    emails?: { items?: { email?: string; primary?: boolean }[] };
    phones?: { items?: { phone?: string; primary?: boolean }[] };
    addresses?: { items?: unknown[] };
    company?: string;
    jobTitle?: string;
    labelKeys?: { items?: string[] };
    extendedFields?: { items?: Record<string, unknown> };
  };
};

type WixMember = {
  id: string;
  loginEmail?: string;
  status?: string;
  contact?: { firstName?: string; lastName?: string; phones?: string[]; emails?: string[] };
  profile?: { nickname?: string };
  createdDate?: string;
  lastLoginDate?: string;
};

async function pullAllContacts(): Promise<WixContact[]> {
  const all: WixContact[] = [];
  let offset = 0;
  while (true) {
    const res = await wixFetch(
      `/contacts/v4/contacts/query`,
      {
        method: "POST",
        body: JSON.stringify({ query: { paging: { limit: 100, offset } } }),
      },
      WIX_SITE_ID
    ) as { contacts?: WixContact[]; pagingMetadata?: { total?: number; count?: number; offset?: number } };
    const batch = res?.contacts || [];
    all.push(...batch);
    const total = res?.pagingMetadata?.total;
    console.log(`   ↳ Contacts offset ${offset}: ${batch.length} (total: ${total ?? "?"}, accumulated: ${all.length})`);
    if (batch.length < 100) break;
    offset += 100;
    if (offset > 20000) break;
  }
  return all;
}

async function pullAllMembers(): Promise<WixMember[]> {
  const all: WixMember[] = [];
  let offset = 0;
  while (true) {
    const res = await wixFetch(
      `/members/v1/members/query`,
      {
        method: "POST",
        body: JSON.stringify({ query: { paging: { limit: 100, offset } }, fieldsets: ["FULL"] }),
      },
      WIX_SITE_ID
    ) as { members?: WixMember[]; metadata?: { total?: number; count?: number } };
    const batch = res?.members || [];
    all.push(...batch);
    console.log(`   ↳ Members offset ${offset}: ${batch.length} (total: ${res?.metadata?.total ?? "?"})`);
    if (batch.length < 100) break;
    offset += 100;
    if (offset > 5000) break;
  }
  return all;
}

export async function pullFromWixReal() {
  console.log("📡 [Wix REAL] Đang gọi API thật...");

  // 1. CONTACTS
  console.log("   ↳ Pulling Contacts (CRM)...");
  const contacts = await pullAllContacts();
  console.log(`   ✓ Got ${contacts.length} contacts`);

  // 2. MEMBERS
  console.log("   ↳ Pulling Members...");
  let members: WixMember[] = [];
  try { members = await pullAllMembers(); } catch (e) { console.warn("⚠️ Members fail:", (e as Error).message); }
  console.log(`   ✓ Got ${members.length} members`);

  // 3. Identity merge — RawRecord shape: { id, email, phone, name }
  type Seed = { id: string; email?: string; phone?: string; name?: string };
  const seeds: Seed[] = [];

  for (const c of contacts) {
    const email = c.info?.emails?.items?.find((e) => e.primary)?.email ||
                  c.info?.emails?.items?.[0]?.email ||
                  c.primaryInfo?.email;
    const phone = c.info?.phones?.items?.find((p) => p.primary)?.phone ||
                  c.info?.phones?.items?.[0]?.phone ||
                  c.primaryInfo?.phone;
    const name = `${c.info?.name?.first || ""} ${c.info?.name?.last || ""}`.trim() ||
                 c.primaryInfo?.name || email || phone || "Khách Wix";
    if (!email && !phone) continue;
    seeds.push({ id: `wix_c_${c.id}`, email: email?.toLowerCase().trim(), phone: phone?.trim(), name });
  }

  for (const m of members) {
    const email = m.loginEmail || m.contact?.emails?.[0];
    const phone = m.contact?.phones?.[0];
    const name = `${m.contact?.firstName || ""} ${m.contact?.lastName || ""}`.trim() ||
                 m.profile?.nickname || email || "Member Wix";
    if (!email && !phone) continue;
    seeds.push({ id: `wix_m_${m.id}`, email: email?.toLowerCase().trim(), phone: phone?.trim(), name });
  }

  console.log(`   ↳ Resolving identity for ${seeds.length} Wix records...`);
  const matches = await batchResolveOrCreate(seeds, { source: "web" });
  logMatches(matches, "Wix");

  // Build maps: id → lead_id, then we look up by contact/member id directly
  const seedIdToLead = new Map<string, string>();
  for (const m of matches) {
    if (m.leadId) seedIdToLead.set(m.rawId, m.leadId);
  }
  // Convenience: email → lead_id and phone → lead_id from our seeds
  const emailToLead = new Map<string, string>();
  const phoneToLead = new Map<string, string>();
  for (const s of seeds) {
    const lid = seedIdToLead.get(s.id);
    if (!lid) continue;
    if (s.email) emailToLead.set(s.email, lid);
    if (s.phone) phoneToLead.set(s.phone, lid);
  }

  // 4. Generate touchpoints
  type Touchpoint = {
    lead_id: string;
    source: string;
    event_type: string;
    title: string;
    detail?: string;
    occurred_at: string;
    payload?: Record<string, unknown>;
  };
  const touchpoints: Touchpoint[] = [];

  for (const c of contacts) {
    const email = (c.info?.emails?.items?.find((e) => e.primary)?.email ||
                  c.info?.emails?.items?.[0]?.email ||
                  c.primaryInfo?.email || "").toLowerCase().trim();
    const phone = (c.info?.phones?.items?.find((p) => p.primary)?.phone ||
                  c.info?.phones?.items?.[0]?.phone ||
                  c.primaryInfo?.phone || "").trim();
    const leadId = (email && emailToLead.get(email)) || (phone && phoneToLead.get(phone));
    if (!leadId) continue;

    const name = `${c.info?.name?.first || ""} ${c.info?.name?.last || ""}`.trim() || "Khách";
    const sourceType = c.source?.sourceType || "WIX";
    const labels = c.info?.labelKeys?.items || [];

    // lead_created event (when contact entered Wix CRM)
    if (c.createdDate) {
      touchpoints.push({
        lead_id: leadId,
        source: "web",
        event_type: "lead_created",
        title: `🌐 Tạo Contact trong Wix${labels.length ? ` (${labels.join(", ")})` : ""}`,
        detail: `Nguồn Wix: ${sourceType}`,
        occurred_at: c.createdDate,
        payload: { wix_contact_id: c.id, source_type: sourceType, labels, name },
      });
    }

    // form_submit if source = OTHERS_INPUT / SUBSCRIPTION_FORM
    if (sourceType === "OTHERS_INPUT" || sourceType === "SUBSCRIPTION_FORM" || sourceType === "WIX_FORMS") {
      touchpoints.push({
        lead_id: leadId,
        source: "web",
        event_type: "form_submit",
        title: `📝 Submit form trên website MDA`,
        detail: name,
        occurred_at: c.createdDate || new Date().toISOString(),
        payload: { wix_contact_id: c.id, source_type: sourceType },
      });
    }

    // Last activity if recent
    if (c.lastActivity?.activityDate && c.lastActivity.activityType) {
      touchpoints.push({
        lead_id: leadId,
        source: "web",
        event_type: "page_view",
        title: `🌐 Web activity: ${c.lastActivity.activityType}`,
        detail: undefined,
        occurred_at: c.lastActivity.activityDate,
        payload: { wix_contact_id: c.id, activity_type: c.lastActivity.activityType },
      });
    }
  }

  for (const m of members) {
    const email = (m.loginEmail || "").toLowerCase().trim();
    const leadId = email && emailToLead.get(email);
    if (!leadId) continue;
    if (m.createdDate) {
      touchpoints.push({
        lead_id: leadId,
        source: "web",
        event_type: "lead_created",
        title: "🌐 Đăng ký tài khoản Member trên Wix",
        detail: m.profile?.nickname || m.loginEmail,
        occurred_at: m.createdDate,
        payload: { wix_member_id: m.id, status: m.status },
      });
    }
    if (m.lastLoginDate) {
      touchpoints.push({
        lead_id: leadId,
        source: "web",
        event_type: "page_view",
        title: "🌐 Login vào website MDA",
        detail: undefined,
        occurred_at: m.lastLoginDate,
        payload: { wix_member_id: m.id },
      });
    }
  }

  console.log(`   ↳ Generated ${touchpoints.length} touchpoints (before dedup)`);

  // 5a. IN-BATCH DEDUP — key = (lead_id, event_type, DATE).
  //   Wix API returns MULTIPLE contact_ids for same person → dedup by
  //   wix_contact_id misses same-person dups. Date-only key catches all.
  const seenKeys = new Set<string>();
  const dedupedTouchpoints: typeof touchpoints = [];
  for (const t of touchpoints) {
    const date = t.occurred_at.slice(0, 10);
    const key = `${t.lead_id}::${t.event_type}::${date}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    dedupedTouchpoints.push(t);
  }
  const inBatchDups = touchpoints.length - dedupedTouchpoints.length;
  if (inBatchDups > 0) {
    console.log(`   ↳ De-duped ${inBatchDups} in-batch dups → ${dedupedTouchpoints.length} unique`);
  }

  // 5b. DB DEDUP — skip rows already in DB with same (lead, event, date)
  console.log("   ↳ Loading existing Wix touchpoints for dedupe (paginated)...");
  const existingWixKeys = new Set<string>();
  {
    let from = 0;
    while (true) {
      const { data } = await admin
        .from("fact_touchpoint")
        .select("event_type, lead_id, occurred_at")
        .eq("source", "web")
        .range(from, from + 999);
      if (!data || data.length === 0) break;
      for (const r of data) {
        const date = r.occurred_at.slice(0, 10);
        existingWixKeys.add(`${r.lead_id}::${r.event_type}::${date}`);
      }
      if (data.length < 1000) break;
      from += 1000;
    }
  }
  console.log(`   ↳ Cached ${existingWixKeys.size} existing Wix (lead, event, date) keys`);

  const newTouchpoints = dedupedTouchpoints.filter((t) => {
    const date = t.occurred_at.slice(0, 10);
    return !existingWixKeys.has(`${t.lead_id}::${t.event_type}::${date}`);
  });
  const skippedFromDb = dedupedTouchpoints.length - newTouchpoints.length;
  if (skippedFromDb > 0) {
    console.log(`   ↳ Skip ${skippedFromDb} touchpoints đã có trong DB`);
  }

  // 5c. Insert (batched)
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < newTouchpoints.length; i += BATCH) {
    const batch = newTouchpoints.slice(i, i + BATCH);
    const { error } = await admin.from("fact_touchpoint").insert(batch);
    if (error) {
      // Fallback one-by-one
      for (const t of batch) {
        const { error: e2 } = await admin.from("fact_touchpoint").insert(t);
        if (!e2) inserted++;
      }
    } else {
      inserted += batch.length;
    }
  }
  console.log(`   ✓ Inserted ${inserted}/${newTouchpoints.length} new touchpoints`);

  // 6. Update lead metadata (company, lead_source) from Wix
  console.log("   ↳ Updating lead metadata from Wix...");
  let updated = 0;
  for (const c of contacts) {
    const email = (c.info?.emails?.items?.[0]?.email || c.primaryInfo?.email || "").toLowerCase().trim();
    const leadId = email && emailToLead.get(email);
    if (!leadId) continue;
    const company = c.info?.company;
    const labels = c.info?.labelKeys?.items?.join(", ");
    const updates: Record<string, string> = {};
    if (company) updates.company = company;
    if (labels) updates.lead_source = labels;
    if (Object.keys(updates).length === 0) continue;
    const { error } = await admin.from("dim_lead").update(updates).eq("lead_id", leadId);
    if (!error) updated++;
  }
  console.log(`   ✓ Updated ${updated} leads with Wix metadata`);

  // Sync job log
  await admin.from("sync_job").insert({
    source: "wix",
    status: "success",
    records_synced: touchpoints.length,
    finished_at: new Date().toISOString(),
  });

  console.log(`✅ Wix REAL done: ${contacts.length} contacts, ${members.length} members, ${touchpoints.length} touchpoints`);
}
