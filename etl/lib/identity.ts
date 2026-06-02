import { admin } from "./supabase-admin";

export type RawRecord = {
  id: string;
  phone?: string | null;
  email?: string | null;
  name?: string | null;
};

export type IdentityMatch = {
  rawId: string;
  leadId: string | null;
  matchedBy: "phone" | "email" | "created" | "none";
};

const AVATAR_COLORS = [
  "#FFE5D9", "#FFE3F0", "#E0F2FE", "#DCFCE7", "#FEF3C7",
  "#EDE9FE", "#FCE7F3", "#E0E7FF", "#FED7E2", "#D1FAE5",
];

function pickAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export async function resolveIdentity(
  records: RawRecord[]
): Promise<IdentityMatch[]> {
  const { data: leads } = await admin.from("dim_lead").select("lead_id, phone, email");

  const phoneMap = new Map<string, string>();
  const emailMap = new Map<string, string>();
  for (const l of leads ?? []) {
    if (l.phone) phoneMap.set(normalizePhone(l.phone), l.lead_id);
    if (l.email) emailMap.set(l.email.toLowerCase().trim(), l.lead_id);
  }

  return records.map((r) => {
    if (r.email) {
      const leadId = emailMap.get(r.email.toLowerCase().trim());
      if (leadId) return { rawId: r.id, leadId, matchedBy: "email" };
    }
    if (r.phone) {
      const leadId = phoneMap.get(normalizePhone(r.phone));
      if (leadId) return { rawId: r.id, leadId, matchedBy: "phone" };
    }
    return { rawId: r.id, leadId: null, matchedBy: "none" };
  });
}

/**
 * Resolve identity với UPSERT pattern + paginated fetch để handle DB >1000 rows.
 * Auto-CREATE lead mới nếu chưa tồn tại (skip duplicates via ON CONFLICT).
 */
export async function batchResolveOrCreate(
  records: RawRecord[],
  options: { source: string }
): Promise<IdentityMatch[]> {
  // 1. Collect unique emails/phones từ records
  const uniqueEmails = new Set<string>();
  const uniquePhones = new Set<string>();
  for (const r of records) {
    if (r.email) uniqueEmails.add(r.email.toLowerCase().trim());
    if (r.phone) uniquePhones.add(normalizePhone(r.phone));
  }

  // 2. Build new lead records để upsert (dedupe by email)
  const newLeads: Array<{
    email: string;
    full_name: string;
    source: string;
    stage: string;
    avatar_color: string;
    first_seen_at: string;
  }> = [];
  const seenEmails = new Set<string>();
  for (const r of records) {
    const email = r.email?.toLowerCase().trim();
    if (!email || seenEmails.has(email)) continue;
    seenEmails.add(email);
    newLeads.push({
      email,
      full_name: r.name || email.split("@")[0],
      source: options.source,
      stage: "Mới",
      avatar_color: pickAvatarColor(email),
      first_seen_at: new Date().toISOString(),
    });
  }

  // 3. Insert truly new leads only (multi-tenant: UNIQUE is on account_id+email
  // not email alone, so onConflict: "email" no longer matches. Check-then-insert
  // instead — safer for current sequential ETL anyway.)
  if (newLeads.length > 0) {
    // Pre-check which emails already exist (paginated IN-query)
    const existingEmails = new Set<string>();
    const allEmails = newLeads.map((l) => l.email);
    for (let i = 0; i < allEmails.length; i += 100) {
      const batch = allEmails.slice(i, i + 100);
      const { data } = await admin
        .from("dim_lead")
        .select("email")
        .in("email", batch);
      for (const l of data ?? []) {
        if (l.email) existingEmails.add(l.email.toLowerCase().trim());
      }
    }

    const trulyNew = newLeads.filter((l) => !existingEmails.has(l.email));
    console.log(`   ↳ [Identity] Insert ${trulyNew.length} lead mới (skip ${newLeads.length - trulyNew.length} đã tồn tại) từ source "${options.source}"`);

    const BATCH = 500;
    for (let i = 0; i < trulyNew.length; i += BATCH) {
      const batch = trulyNew.slice(i, i + BATCH);
      const { error } = await admin.from("dim_lead").insert(batch);
      if (error && !error.message.includes("duplicate key")) {
        console.warn(`   ⚠️ Insert batch ${i}: ${error.message}`);
      }
    }
  }

  // 4. Fetch lead_ids cho ALL emails ta cần (batched IN-query)
  const emailLeadMap = new Map<string, string>();
  const emailArr = Array.from(uniqueEmails);
  for (let i = 0; i < emailArr.length; i += 100) {
    const batch = emailArr.slice(i, i + 100);
    const { data } = await admin
      .from("dim_lead")
      .select("lead_id, email")
      .in("email", batch);
    for (const l of data ?? []) {
      if (l.email) emailLeadMap.set(l.email.toLowerCase().trim(), l.lead_id);
    }
  }

  // 5. Fetch lead_ids cho phones (fallback)
  const phoneLeadMap = new Map<string, string>();
  const phoneArr = Array.from(uniquePhones);
  for (let i = 0; i < phoneArr.length; i += 100) {
    const batch = phoneArr.slice(i, i + 100);
    const { data } = await admin
      .from("dim_lead")
      .select("lead_id, phone")
      .in("phone", batch);
    for (const l of data ?? []) {
      if (l.phone) phoneLeadMap.set(normalizePhone(l.phone), l.lead_id);
    }
  }

  // 6. Match each record
  return records.map((r) => {
    const email = r.email?.toLowerCase().trim();
    if (email && emailLeadMap.has(email)) {
      const wasNew = seenEmails.has(email);
      return {
        rawId: r.id,
        leadId: emailLeadMap.get(email)!,
        matchedBy: wasNew ? "created" : "email",
      };
    }
    if (r.phone) {
      const leadId = phoneLeadMap.get(normalizePhone(r.phone));
      if (leadId) return { rawId: r.id, leadId, matchedBy: "phone" };
    }
    return { rawId: r.id, leadId: null, matchedBy: "none" };
  });
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\s|-|\+84/g, "").replace(/^0/, "");
}

export function logMatches(matches: IdentityMatch[], source: string) {
  const byEmail = matches.filter((m) => m.matchedBy === "email").length;
  const byPhone = matches.filter((m) => m.matchedBy === "phone").length;
  const created = matches.filter((m) => m.matchedBy === "created").length;
  const unmerged = matches.filter((m) => m.matchedBy === "none").length;
  const parts = [
    `existing: ${byEmail + byPhone}`,
    `created: ${created}`,
    `unmerged: ${unmerged}`,
  ];
  console.log(`   ↳ [${source}] ${parts.join(" | ")}`);
}
