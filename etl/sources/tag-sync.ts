/**
 * Ghi THỜI ĐIỂM gắn tag (customer.tags[].time) thành CỘT trên SMAX_Database:
 *   - Lead-class: "Cold Lead lúc", "Hot Lead lúc", "Warm Lead lúc", "Prospect lúc"
 *   - Khóa: "K50 lúc"... "K61 lúc", "F1 lúc"... "F4 lúc" (tự tạo cột khi có khóa mới)
 *   - "Hot Score" (từ fact_lead_score) → dùng cho view "Hot Leads" (score>=70).
 * Tất cả trong 1 bảng SMAX_Database (không còn bảng SMAX_Tag_Log / SMAX_Hotleads riêng).
 * Chạy: npm run etl:tag:sync (cron mỗi ngày).
 */
import { admin } from "../lib/supabase-admin";

const T = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const BASE = process.env.SMAX_BASE_URL || "https://api.smax.ai";
const BIZ = "mastering-data-analytics";
const ID = process.env.LARK_APP_ID || "", SEC = process.env.LARK_APP_SECRET || "", APP = process.env.LARK_BASE_APP_TOKEN || "";
const U = "https://open.larksuite.com/open-apis";
const CLASS: Record<string, string> = { coldlead: "Cold Lead", hotlead: "Hot Lead", warmlead: "Warm Lead", prospect: "Prospect" };

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
const normPh = (p: any) => (p ? String(p).replace(/\D/g, "").replace(/^84/, "").replace(/^0/, "") : "");
// trả TÊN chuẩn của tag nếu là tag cần track (class hoặc khóa), else null
function trackName(name: string): string | null {
  const n = norm(name);
  if (CLASS[n]) return CLASS[n];
  const m = name.trim().match(/^(k\d{2,3}|f\d(\.\d)?)$/i);
  if (m) return name.trim().toUpperCase();
  return null;
}
function txt(v: unknown): string { return Array.isArray(v) ? (v as { text?: string }[]).map(x => x?.text ?? "").join("") : (v == null ? "" : String(v)); }
async function larkToken() { const r = await fetch(`${U}/auth/v3/tenant_access_token/internal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: ID, app_secret: SEC }) }).then(r => r.json()); return r.tenant_access_token; }

export async function runTagSync() {
  if (!T || !APP) { console.log("[tag-sync] thiếu creds, bỏ qua"); return; }
  // 1) lead lookup
  const byCust = new Map<string, string>(), byPid = new Map<string, string>(), byPhone = new Map<string, string>(), byEmail = new Map<string, string>();
  let from = 0;
  while (from < 60000) {
    const { data } = await admin.from("dim_lead").select("lead_id, phone, email, external_profile_id, smax_customer_id").range(from, from + 999);
    if (!data?.length) break;
    for (const l of data) { if (l.smax_customer_id) byCust.set(l.smax_customer_id, l.lead_id); if (l.external_profile_id) byPid.set(l.external_profile_id, l.lead_id); if (l.phone) byPhone.set(normPh(l.phone), l.lead_id); if (l.email) byEmail.set(String(l.email).toLowerCase().trim(), l.lead_id); }
    if (data.length < 1000) break; from += 1000;
  }
  // 2) SMAX customers → tag times per lead
  const cRes = await fetch(`${BASE}/bizs/${BIZ}/customers`, { method: "POST", headers: { Authorization: `Bearer ${T}`, "Content-Type": "application/json" }, body: JSON.stringify({ size: 10000 }) }).then(r => r.json());
  const customers = cRes.data || [];
  const tagTimes = new Map<string, Record<string, number>>(); // lead → {"K61 lúc": ms}
  const cols = new Set<string>(Object.values(CLASS).map(c => `${c} lúc`)); // tập cột cần đảm bảo
  for (const c of customers) {
    const lead = (c.id && byCust.get(c.id)) || (c.pid && byPid.get(c.pid)) || (c.phone && byPhone.get(normPh(c.phone))) || (c.email && byEmail.get(String(c.email).toLowerCase().trim()));
    if (!lead) continue;
    for (const tg of (c.tags || [])) {
      const nm = trackName(tg.name || tg.alias || ""); if (!nm) continue;
      const ms = tg.time ? new Date(tg.time).getTime() : 0; if (!ms) continue;
      const col = `${nm} lúc`; cols.add(col);
      const m = tagTimes.get(lead) || {}; if (!m[col] || ms > m[col]) m[col] = ms; tagTimes.set(lead, m);
    }
  }
  console.log(`[tag-sync] leads có tag-time: ${tagTimes.size} | số cột tag: ${cols.size}`);

  // 3) hot score per lead
  const { data: latest } = await admin.from("fact_lead_score").select("scored_at").order("scored_at", { ascending: false }).limit(1).maybeSingle();
  const scoreMap = new Map<string, number>();
  if (latest?.scored_at) { let sf = 0; while (sf < 50000) { const { data } = await admin.from("fact_lead_score").select("lead_id, hot_score").eq("scored_at", latest.scored_at).range(sf, sf + 999); if (!data?.length) break; for (const r of data) if (r.hot_score != null) scoreMap.set(r.lead_id, r.hot_score); if (data.length < 1000) break; sf += 1000; } }

  const tk = await larkToken();
  const tR = await fetch(`${U}/bitable/v1/apps/${APP}/tables?page_size=100`, { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
  const dbTbl = tR.data.items.find((t: any) => t.name === "SMAX_Database"); if (!dbTbl) { console.log("[tag-sync] không thấy SMAX_Database"); return; }
  const dbId = dbTbl.table_id;

  // 4) đảm bảo cột (date cho tag-time, number cho Hot Score) — tự tạo cột khóa mới
  const fR = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/fields?page_size=200`, { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
  const existing = new Set((fR.data?.items || []).map((f: any) => f.field_name));
  for (const col of cols) if (!existing.has(col)) await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/fields`, { method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" }, body: JSON.stringify({ field_name: col, type: 5, property: { date_formatter: "yyyy-MM-dd HH:mm", auto_fill: false } }) });
  if (!existing.has("Hot Score")) await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/fields`, { method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" }, body: JSON.stringify({ field_name: "Hot Score", type: 2, property: { formatter: "0" } }) });

  // 5) update rows (chỉ ô lệch)
  const allCols = [...cols];
  const upd: any[] = []; let pt: string | undefined;
  while (true) {
    const url = new URL(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/records`); url.searchParams.set("page_size", "500");
    url.searchParams.set("field_names", JSON.stringify(["Lead ID", "Hot Score", ...allCols]));
    if (pt) url.searchParams.set("page_token", pt);
    const d = await fetch(url.toString(), { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
    for (const r of d.data?.items || []) {
      const lid = txt(r.fields?.["Lead ID"]); if (!lid) continue;
      const want = tagTimes.get(lid) || {}; const patch: Record<string, unknown> = {};
      for (const col of allCols) { const w = want[col] ?? null; const cur = typeof r.fields?.[col] === "number" ? r.fields[col] : null; if (w && w !== cur) patch[col] = w; }
      const ws = scoreMap.get(lid); const cs = typeof r.fields?.["Hot Score"] === "number" ? r.fields["Hot Score"] : (r.fields?.["Hot Score"] ? Number(r.fields["Hot Score"]) : null);
      if (ws != null && ws !== cs) patch["Hot Score"] = ws;
      if (Object.keys(patch).length) upd.push({ record_id: r.record_id, fields: patch });
    }
    if (!d.data?.has_more) break; pt = d.data.page_token;
  }
  let uw = 0;
  for (let i = 0; i < upd.length; i += 400) { const rr = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/records/batch_update`, { method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" }, body: JSON.stringify({ records: upd.slice(i, i + 400) }) }).then(r => r.json()); if (rr.code === 0) uw += upd.slice(i, i + 400).length; }
  console.log(`[tag-sync] SMAX_Database: ${allCols.length} cột tag-time + Hot Score, cập nhật ${uw} dòng`);
}

runTagSync().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
