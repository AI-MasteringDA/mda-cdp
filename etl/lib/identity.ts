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
 * Resolve identity. Nếu không match → AUTO-CREATE lead mới trong dim_lead.
 * Dùng cho source có lead thật (Instantly, Salesforce contacts).
 * KHÔNG dùng cho source random (SMAX phone vô danh).
 */
export async function batchResolveOrCreate(
  records: RawRecord[],
  options: { source: string }
): Promise<IdentityMatch[]> {
  // 1. Lấy existing leads
  const { data: leads } = await admin.from("dim_lead").select("lead_id, phone, email");
  const phoneMap = new Map<string, string>();
  const emailMap = new Map<string, string>();
  for (const l of leads ?? []) {
    if (l.phone) phoneMap.set(normalizePhone(l.phone), l.lead_id);
    if (l.email) emailMap.set(l.email.toLowerCase().trim(), l.lead_id);
  }

  // 2. Tìm emails cần tạo mới (dedup)
  const uniqueNewEmails = new Map<string, { name?: string }>();
  for (const r of records) {
    const email = r.email?.toLowerCase().trim();
    if (!email) continue;
    if (emailMap.has(email)) continue;
    if (!uniqueNewEmails.has(email)) {
      uniqueNewEmails.set(email, { name: r.name || undefined });
    }
  }

  // 3. Batch INSERT new leads
  if (uniqueNewEmails.size > 0) {
    console.log(`   ↳ [Identity] Auto-create ${uniqueNewEmails.size} lead mới từ source "${options.source}"`);
    const newLeads = Array.from(uniqueNewEmails.entries()).map(([email, meta]) => ({
      email,
      full_name: meta.name || email.split("@")[0],
      source: options.source,
      stage: "Mới",
      avatar_color: pickAvatarColor(email),
      first_seen_at: new Date().toISOString(),
    }));

    // Insert in batches of 500
    const BATCH = 500;
    for (let i = 0; i < newLeads.length; i += BATCH) {
      const batch = newLeads.slice(i, i + BATCH);
      const { data: created, error } = await admin
        .from("dim_lead")
        .insert(batch)
        .select("lead_id, email");
      if (error) {
        console.warn(`   ⚠️ Lỗi insert lead batch ${i}: ${error.message}`);
        continue;
      }
      for (const c of created ?? []) {
        emailMap.set(c.email.toLowerCase().trim(), c.lead_id);
      }
    }
  }

  // 4. Match
  return records.map((r) => {
    const email = r.email?.toLowerCase().trim();
    if (email && emailMap.has(email)) {
      const wasNew = uniqueNewEmails.has(email);
      return {
        rawId: r.id,
        leadId: emailMap.get(email)!,
        matchedBy: wasNew ? "created" : "email",
      };
    }
    if (r.phone) {
      const leadId = phoneMap.get(normalizePhone(r.phone));
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
