import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * SMAX Audit data layer.
 *
 * Hai nguồn:
 *  1. Supabase view `v_smax_lead_snapshot` — 1 dòng/lead: touchpoint mới nhất,
 *     tags, contact. Nguồn chính cho mọi metric tính được bằng logic thuần.
 *  2. Lark SMAX_Database — 2 cột chỉ Lark có: "Chưa xin info" + "AI Note"
 *     (kết quả AI đọc hội thoại). Thiếu LARK_* env → degrade, không vỡ trang.
 *
 * Kết quả cache in-process 5 phút — dashboard mở nhiều lần không đập Lark/DB.
 */

export type AuditLead = {
  lead_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  lifecycle: "hot" | "warm" | "cold" | "none";
  hasContact: boolean;
  lastActivity: string; // ISO
  lastEventType: string;
  totalChats: number;
  /** Khách nhắn cuối, TVV chưa rep (Lark flag; fallback: event_type === 'chat') */
  unreplied: boolean;
  /** AI xác nhận TVV chưa từng xin liên hệ (null = Lark không truy cập được) */
  chuaXinInfo: boolean | null;
  aiNote: string | null;
};

export type AuditData = {
  leads: AuditLead[];
  larkOk: boolean;
  generatedAt: string;
  from: string; // YYYY-MM-DD (giờ VN)
  to: string;   // YYYY-MM-DD (giờ VN)
  windowDays: number;
};

/** Khoảng thời gian đọc từ ?from&to trên URL — mặc định 14 ngày gần nhất. */
export type DateRange = { from: string; to: string };

const VN_OFFSET_MS = 7 * 3600_000;
const DEFAULT_DAYS = 14;
const MAX_DAYS = 400; // chặn range vô lý

function isoDay(ms: number) {
  return new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);
}
const isValidDay = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

/** Chuẩn hoá searchParams thành range hợp lệ (sai/thiếu → mặc định 14 ngày). */
export function parseRange(params?: { from?: string | string[]; to?: string | string[] }): DateRange {
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const today = isoDay(Date.now());
  let from = pick(params?.from);
  let to = pick(params?.to);
  if (!isValidDay(from) || !isValidDay(to) || from > to) {
    from = isoDay(Date.now() - DEFAULT_DAYS * 86400_000);
    to = today;
  }
  if (to > today) to = today;
  const span = (Date.parse(to) - Date.parse(from)) / 86400_000;
  if (span > MAX_DAYS) from = isoDay(Date.parse(to) - MAX_DAYS * 86400_000);
  return { from, to };
}

/** Biên UTC của range VN: [from 00:00 VN, to 24:00 VN) */
function rangeBounds(r: DateRange) {
  return {
    startISO: new Date(Date.parse(`${r.from}T00:00:00`) - VN_OFFSET_MS).toISOString(),
    endISO: new Date(Date.parse(`${r.to}T00:00:00`) - VN_OFFSET_MS + 86400_000).toISOString(),
  };
}

const LARK_BASE = "https://open.larksuite.com/open-apis";
const CACHE_TTL_MS = 5 * 60_000;
let cache: { at: number; key: string; data: AuditData } | null = null;

function lifecycleOf(tags: string[]): AuditLead["lifecycle"] {
  if (tags.includes("Hot Lead")) return "hot";
  if (tags.includes("Warm Lead")) return "warm";
  if (tags.includes("Cold Lead")) return "cold";
  return "none";
}

async function fetchLarkFlags(
  startMs: number,
  endMs: number
): Promise<Map<string, { chuaXinInfo: boolean; unreplied: boolean; aiNote: string }> | null> {
  const appId = process.env.LARK_APP_ID;
  const appSecret = process.env.LARK_APP_SECRET;
  const appToken = process.env.LARK_BASE_APP_TOKEN;
  if (!appId || !appSecret || !appToken) return null;

  try {
    const auth = await fetch(`${LARK_BASE}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    }).then((r) => r.json());
    const token: string = auth.tenant_access_token;
    if (!token) return null;

    const tables = await fetch(`${LARK_BASE}/bitable/v1/apps/${appToken}/tables?page_size=100`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());
    const tableId: string | undefined = tables.data?.items?.find(
      (t: { name: string }) => t.name === "SMAX_Database"
    )?.table_id;
    if (!tableId) return null;

    const flags = new Map<string, { chuaXinInfo: boolean; unreplied: boolean; aiNote: string }>();
    let pageToken: string | undefined;
    // Search API lọc server-side theo Time → chỉ tải window cần (≈800 dòng)
    do {
      const res = await fetch(
        `${LARK_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records/search${pageToken ? `?page_token=${pageToken}` : ""}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            field_names: ["Lead ID", "Chưa xin info", "Chưa phản hồi", "AI Note"],
            filter: {
              conjunction: "and",
              conditions: [
                { field_name: "Time", operator: "isGreater", value: ["ExactDate", String(startMs)] },
                { field_name: "Time", operator: "isLess", value: ["ExactDate", String(endMs)] },
              ],
            },
            page_size: 500,
          }),
        }
      ).then((r) => r.json());
      if (res.code !== 0) return flags.size > 0 ? flags : null;
      for (const rec of res.data?.items ?? []) {
        const f = rec.fields ?? {};
        // Search API trả text dạng [{text: "..."}]
        const leadId = Array.isArray(f["Lead ID"])
          ? String(f["Lead ID"][0]?.text ?? "")
          : String(f["Lead ID"] ?? "");
        if (!leadId) continue;
        const note = Array.isArray(f["AI Note"])
          ? String(f["AI Note"][0]?.text ?? "")
          : String(f["AI Note"] ?? "");
        flags.set(leadId, {
          chuaXinInfo: f["Chưa xin info"] === true,
          unreplied: f["Chưa phản hồi"] === true,
          aiNote: note,
        });
      }
      pageToken = res.data?.has_more ? res.data?.page_token : undefined;
    } while (pageToken);
    return flags;
  } catch {
    return null;
  }
}

export async function getAuditData(range: DateRange): Promise<AuditData> {
  const key = `${range.from}_${range.to}`;
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }

  const { startISO, endISO } = rangeBounds(range);
  const windowDays = Math.max(
    1,
    Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400_000) + 1
  );

  type ViewRow = {
    lead_id: string;
    event_type: string | null;
    occurred_at: string | null;
    fallback_name: string | null;
    total_chats: number | null;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    smax_tags: string[] | null;
  };
  const rows: ViewRow[] = [];
  try {
    const supabase = await createClient();
    let offset = 0;
    while (offset < 30000) {
      const { data, error } = await supabase
        .from("v_smax_lead_snapshot")
        .select("lead_id, event_type, occurred_at, fallback_name, total_chats, full_name, email, phone, smax_tags")
        .gte("occurred_at", startISO)
        .lt("occurred_at", endISO)
        .order("occurred_at", { ascending: false })
        .range(offset, offset + 999);
      if (error || !data?.length) break;
      rows.push(...(data as ViewRow[]));
      if (data.length < 1000) break;
      offset += 1000;
    }
  } catch {
    /* trang hiển thị rỗng + ghi chú thay vì crash */
  }

  const larkFlags = await fetchLarkFlags(Date.parse(startISO), Date.parse(endISO));

  const leads: AuditLead[] = rows.map((r) => {
    const tags = Array.isArray(r.smax_tags) ? r.smax_tags : [];
    const lark = larkFlags?.get(r.lead_id);
    return {
      lead_id: r.lead_id,
      name: r.full_name || r.fallback_name || "(không tên)",
      email: r.email,
      phone: r.phone,
      tags,
      lifecycle: lifecycleOf(tags),
      hasContact: !!(r.email || r.phone),
      lastActivity: r.occurred_at ?? startISO,
      lastEventType: r.event_type ?? "",
      totalChats: Number(r.total_chats ?? 0),
      unreplied: lark ? lark.unreplied : r.event_type === "chat",
      chuaXinInfo: larkFlags ? (lark ? lark.chuaXinInfo : false) : null,
      aiNote: lark?.aiNote || null,
    };
  });

  const data: AuditData = {
    leads,
    larkOk: larkFlags !== null,
    generatedAt: new Date().toISOString(),
    from: range.from,
    to: range.to,
    windowDays,
  };
  cache = { at: Date.now(), key, data };
  return data;
}

/* ── Metric helpers (dùng chung cho các tab) ─────────────────────────── */

export function summarize(d: AuditData) {
  const l = d.leads;
  const byDay = new Map<string, number>();
  for (const x of l) {
    const day = new Date(new Date(x.lastActivity).getTime() + 7 * 3600_000)
      .toISOString().slice(5, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return {
    total: l.length,
    unreplied: l.filter((x) => x.unreplied).length,
    chuaXinInfo: d.larkOk ? l.filter((x) => x.chuaXinInfo === true).length : null,
    hasContact: l.filter((x) => x.hasContact).length,
    hot: l.filter((x) => x.lifecycle === "hot").length,
    warm: l.filter((x) => x.lifecycle === "warm").length,
    cold: l.filter((x) => x.lifecycle === "cold").length,
    untagged: l.filter((x) => x.lifecycle === "none").length,
    coInfoThieuTag: l.filter((x) => x.hasContact && x.lifecycle === "none").length,
    days: Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0])),
  };
}

/** Hot/Warm leads im ắng ≥ N ngày — ứng viên follow-up */
export function needsFollowup(d: AuditData, minQuietDays = 3) {
  const cutoff = Date.now() - minQuietDays * 86400_000;
  return d.leads.filter(
    (x) =>
      (x.lifecycle === "hot" || x.lifecycle === "warm") &&
      new Date(x.lastActivity).getTime() < cutoff &&
      // khách đã "chốt" thì thôi
      !x.tags.includes("Đã chốt")
  );
}
