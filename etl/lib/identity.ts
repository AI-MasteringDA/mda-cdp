import { createHash } from "crypto";
import { admin } from "./supabase-admin";

// ── Danh tính bền: mã lead theo CÔNG THỨC, không ngẫu nhiên ──────────────────
// Trước đây lead mới được DB gán gen_random_uuid() → mỗi lần backfill lại sinh
// mã KHÁC → Lark trỏ sai (sự cố 2026-07-14, phải remap 7,041 dòng).
//
// Giờ mã = UUIDv5(natural_key). Cùng email / cùng smax_customer_id → LUÔN ra
// cùng một mã, dù xoá rồi tạo lại bao nhiêu lần. Chỉ áp cho lead MỚI; 50k lead
// cũ giữ nguyên mã ngẫu nhiên (an toàn tuyệt đối, không đụng dữ liệu cũ).
const CDP_NAMESPACE = "6f4a3d2e-1b9c-4e57-8a10-mda000cdp000"; // cố định cho MDA CDP
function deterministicLeadId(naturalKey: string): string {
  // UUIDv5 chuẩn: SHA-1(namespace_bytes + name), set version=5 + variant.
  const nsHex = CDP_NAMESPACE.replace(/[^0-9a-f]/gi, "").padEnd(32, "0").slice(0, 32);
  const nsBytes = Buffer.from(nsHex, "hex");
  const hash = createHash("sha1").update(nsBytes).update(naturalKey).digest();
  const b = hash.subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // variant RFC 4122
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export type RawRecord = {
  id: string;
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  /** Platform-specific ID fallback when email/phone missing.
   *  For SMAX: pass customer.id (stable across sessions) */
  smax_customer_id?: string | null;
  /** Optional platform (facebook, zalo, instagram, custom) */
  external_platform?: string | null;
  /** Optional platform profile ID (fb user id, zalo pid, etc) */
  external_profile_id?: string | null;
  /**
   * Mốc tương tác ĐẦU TIÊN thật (vd SMAX customer.interaction.first) — nếu có,
   * dùng thay cho "giờ ETL chạy" khi tạo lead mới. Thiếu field này thì
   * first_seen_at trước đây = lúc ETL insert record, không phải lúc khách xuất
   * hiện thật — khiến "Khách từ..." trên hồ sơ sai lệch tới hàng tháng.
   */
  first_seen_at?: string | null;
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
    if (r.email && typeof r.email === "string") uniqueEmails.add(r.email.toLowerCase().trim());
    if (r.phone) uniquePhones.add(normalizePhone(r.phone));
  }

  // 2. Build new lead records để upsert (dedupe by email)
  const newLeads: Array<{
    lead_id: string;
    email: string;
    phone: string | null;
    full_name: string;
    source: string;
    stage: string;
    avatar_color: string;
    first_seen_at: string;
  }> = [];
  const seenEmails = new Set<string>();
  for (const r of records) {
    const email = typeof r.email === "string" ? r.email.toLowerCase().trim() : undefined;
    if (!email || seenEmails.has(email)) continue;
    seenEmails.add(email);
    newLeads.push({
      // Mã theo công thức từ email → tạo lại luôn ra cùng mã
      lead_id: deterministicLeadId(`email:${email}`),
      email,
      // BUG phát hiện 2026-07-22 (case "Phạm Bình"): nguồn trả về CẢ email lẫn
      // phone trên cùng 1 record (xác nhận qua raw SMAX API), nhưng nhánh tạo
      // lead-mới-theo-email này trước đây bỏ qua r.phone hoàn toàn → phone bị
      // rớt vĩnh viễn, tạo cảm giác "2 lead khác nhau" dù cùng 1 nguồn record.
      phone: r.phone ? normalizePhone(r.phone) : null,
      full_name: r.name || email.split("@")[0],
      source: options.source,
      stage: "Mới",
      avatar_color: pickAvatarColor(email),
      first_seen_at: r.first_seen_at || new Date().toISOString(),
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

  // 3b. Create leads for records with SMAX customer_id but no email/phone
  const anonLeads: Array<{
    lead_id: string;
    smax_customer_id: string;
    full_name: string;
    source: string;
    stage: string;
    avatar_color: string;
    first_seen_at: string;
    external_platform: string | null;
    external_profile_id: string | null;
    phone: string | null;
  }> = [];
  const seenSmaxIds = new Set<string>();
  for (const r of records) {
    if (r.email || !r.smax_customer_id) continue;
    if (seenSmaxIds.has(r.smax_customer_id)) continue;
    seenSmaxIds.add(r.smax_customer_id);
    anonLeads.push({
      // Mã theo công thức từ smax_customer_id → tạo lại luôn ra cùng mã.
      // Đây là lớp bảo vệ chính cho lead ẩn danh (nhóm bị xoá/tạo lại nhiều nhất).
      lead_id: deterministicLeadId(`smax:${r.smax_customer_id}`),
      smax_customer_id: r.smax_customer_id,
      full_name: r.name || `Anonymous (${r.external_platform || "chat"})`,
      source: options.source,
      stage: "Mới",
      avatar_color: pickAvatarColor(r.smax_customer_id),
      first_seen_at: r.first_seen_at || new Date().toISOString(),
      external_platform: r.external_platform || null,
      external_profile_id: r.external_profile_id || null,
      phone: r.phone ? normalizePhone(r.phone) : null,
    });
  }
  if (anonLeads.length > 0) {
    // Check which SMAX IDs already exist
    const existingSmaxIds = new Set<string>();
    const allSmaxIds = anonLeads.map(l => l.smax_customer_id);
    for (let i = 0; i < allSmaxIds.length; i += 100) {
      const batch = allSmaxIds.slice(i, i + 100);
      const { data } = await admin
        .from("dim_lead")
        .select("smax_customer_id")
        .in("smax_customer_id", batch);
      for (const l of data ?? []) {
        if (l.smax_customer_id) existingSmaxIds.add(l.smax_customer_id);
      }
    }
    const trulyNewAnon = anonLeads.filter(l => !existingSmaxIds.has(l.smax_customer_id));
    console.log(`   ↳ [Identity] Insert ${trulyNewAnon.length} anonymous lead (SMAX only, skip ${anonLeads.length - trulyNewAnon.length}) từ source "${options.source}"`);
    const BATCH = 500;
    for (let i = 0; i < trulyNewAnon.length; i += BATCH) {
      const batch = trulyNewAnon.slice(i, i + BATCH);
      const { error } = await admin.from("dim_lead").insert(batch);
      if (error && !error.message.includes("duplicate key")) {
        console.warn(`   ⚠️ Insert anon batch ${i}: ${error.message}`);
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

  // 5b. Fetch lead_ids cho SMAX customer_ids
  const smaxLeadMap = new Map<string, string>();
  const uniqueSmaxIds = new Set(records.filter(r => r.smax_customer_id).map(r => r.smax_customer_id!));
  const smaxArr = Array.from(uniqueSmaxIds);
  for (let i = 0; i < smaxArr.length; i += 100) {
    const batch = smaxArr.slice(i, i + 100);
    const { data } = await admin
      .from("dim_lead")
      .select("lead_id, smax_customer_id")
      .in("smax_customer_id", batch);
    for (const l of data ?? []) {
      if (l.smax_customer_id) smaxLeadMap.set(l.smax_customer_id, l.lead_id);
    }
  }

  // 6. Match each record — priority: email > phone > SMAX ID
  return records.map((r) => {
    const email = typeof r.email === "string" ? r.email.toLowerCase().trim() : undefined;
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
    if (r.smax_customer_id) {
      const leadId = smaxLeadMap.get(r.smax_customer_id);
      if (leadId) {
        const wasNew = seenSmaxIds.has(r.smax_customer_id);
        return { rawId: r.id, leadId, matchedBy: wasNew ? "created" : "email" };
      }
    }
    return { rawId: r.id, leadId: null, matchedBy: "none" };
  });
}

export function normalizePhone(phone: string | number | null | undefined): string {
  if (phone === null || phone === undefined) return "";
  return String(phone).replace(/\s|-|\+84/g, "").replace(/^0/, "");
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
