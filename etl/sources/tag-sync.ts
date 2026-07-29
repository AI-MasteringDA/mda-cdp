/**
 * Đồng bộ nhật ký tag từ SMAX (customer.tags[].time = thời điểm gắn tag).
 *  (1) Bảng "SMAX_Tag_Log": 1 dòng/(lead,tag) cho Lead-class + Khóa, cửa sổ 90 ngày
 *      → query "Cold Lead ngày X", "F1 ngày X"... theo ngày GẮN (không lẫn giờ chat).
 *  (2) 4 cột lead-class trên "SMAX_Database": "Cold Lead lúc", "Hot Lead lúc",
 *      "Warm Lead lúc", "Prospect lúc" (all-time) → lọc nhanh trên bảng chính.
 * Chạy: npm run etl:tag:sync (cron mỗi ngày).
 */
import { admin } from "../lib/supabase-admin";

const T = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const BASE = process.env.SMAX_BASE_URL || "https://api.smax.ai";
const BIZ = "mastering-data-analytics";
const ID = process.env.LARK_APP_ID || "", SEC = process.env.LARK_APP_SECRET || "", APP = process.env.LARK_BASE_APP_TOKEN || "";
const U = "https://open.larksuite.com/open-apis";
const DAY = 864e5, WINDOW = 90 * DAY, NOW = Date.now();
const CLASS_COLS: Record<string, string> = { coldlead: "Cold Lead lúc", hotlead: "Hot Lead lúc", warmlead: "Warm Lead lúc", prospect: "Prospect lúc" };

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
const normPh = (p: any) => (p ? String(p).replace(/\D/g, "").replace(/^84/, "").replace(/^0/, "") : "");
function tagKind(name: string): "Lead-class" | "Khóa" | null {
  const n = norm(name);
  if (["coldlead", "hotlead", "warmlead", "prospect"].includes(n)) return "Lead-class";
  if (/^(k\d{2,3}|f\d(\.\d)?)$/i.test(name.trim())) return "Khóa";
  return null;
}
function txt(v: unknown): string { return Array.isArray(v) ? (v as { text?: string }[]).map(x => x?.text ?? "").join("") : (v == null ? "" : String(v)); }
async function larkToken() { const r = await fetch(`${U}/auth/v3/tenant_access_token/internal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: ID, app_secret: SEC }) }).then(r => r.json()); return r.tenant_access_token; }

export async function runTagSync() {
  if (!T || !APP) { console.log("[tag-sync] thiếu creds, bỏ qua"); return; }
  // 1) lead lookup
  const byCust = new Map<string, any>(), byPid = new Map<string, any>(), byPhone = new Map<string, any>(), byEmail = new Map<string, any>();
  let from = 0;
  while (from < 60000) {
    const { data } = await admin.from("dim_lead").select("lead_id, full_name, phone, email, external_profile_id, smax_customer_id, assignee").range(from, from + 999);
    if (!data?.length) break;
    for (const l of data) { const o = { lead_id: l.lead_id, name: l.full_name, tvv: l.assignee }; if (l.smax_customer_id) byCust.set(l.smax_customer_id, o); if (l.external_profile_id) byPid.set(l.external_profile_id, o); if (l.phone) byPhone.set(normPh(l.phone), o); if (l.email) byEmail.set(String(l.email).toLowerCase().trim(), o); }
    if (data.length < 1000) break; from += 1000;
  }
  // 2) SMAX customers
  const cRes = await fetch(`${BASE}/bizs/${BIZ}/customers`, { method: "POST", headers: { Authorization: `Bearer ${T}`, "Content-Type": "application/json" }, body: JSON.stringify({ size: 10000 }) }).then(r => r.json());
  const customers = cRes.data || [];
  console.log(`[tag-sync] leads=${byCust.size + byPid.size} customers=${customers.length}/${cRes.total}`);

  // 3) build log events (90d) + class times (all-time)
  const ev = new Map<string, any>();
  const classTimes = new Map<string, Record<string, number>>(); // lead_id → {colName: ms}
  for (const c of customers) {
    const lead = (c.id && byCust.get(c.id)) || (c.pid && byPid.get(c.pid)) || (c.phone && byPhone.get(normPh(c.phone))) || (c.email && byEmail.get(String(c.email).toLowerCase().trim()));
    if (!lead) continue;
    for (const tg of (c.tags || [])) {
      const kind = tagKind(tg.name || tg.alias || ""); if (!kind) continue;
      const ms = tg.time ? new Date(tg.time).getTime() : 0; if (!ms) continue;
      if (kind === "Lead-class") { const col = CLASS_COLS[norm(tg.name || tg.alias)]; if (col) { const m = classTimes.get(lead.lead_id) || {}; if (!m[col] || ms > m[col]) m[col] = ms; classTimes.set(lead.lead_id, m); } }
      if (NOW - ms > WINDOW) continue; // log chỉ 90 ngày
      const key = `${lead.lead_id}|${tg.name}`; const prev = ev.get(key);
      if (!prev || ms > prev.ms) ev.set(key, { lead_id: lead.lead_id, name: lead.name, tvv: lead.tvv, tag: tg.name, kind, ms, platform: c.platform || "" });
    }
  }
  console.log(`[tag-sync] log events=${ev.size} | class-time leads=${classTimes.size}`);

  const tk = await larkToken();
  const tR = await fetch(`${U}/bitable/v1/apps/${APP}/tables?page_size=100`, { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
  const tables = tR.data.items;

  // 4) SMAX_Tag_Log — tạo nếu chưa có, clear + insert (nhỏ, ~vài nghìn)
  let logTbl = tables.find((t: any) => t.name === "SMAX_Tag_Log"); let logId: string;
  const FIELDS = [{ field_name: "Key", type: 1 }, { field_name: "Lead ID", type: 1 }, { field_name: "Tên", type: 1 }, { field_name: "Tag", type: 1 }, { field_name: "Loại", type: 1 }, { field_name: "Gắn lúc", type: 5, property: { date_formatter: "yyyy-MM-dd HH:mm", auto_fill: false } }, { field_name: "Platform", type: 1 }, { field_name: "TVV", type: 1 }];
  if (!logTbl) { const cr = await fetch(`${U}/bitable/v1/apps/${APP}/tables`, { method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" }, body: JSON.stringify({ table: { name: "SMAX_Tag_Log", fields: FIELDS } }) }).then(r => r.json()); logId = cr.data.table_id; }
  else {
    logId = logTbl.table_id;
    let pt: string | undefined; const ids: string[] = [];
    while (true) { const url = new URL(`${U}/bitable/v1/apps/${APP}/tables/${logId}/records`); url.searchParams.set("page_size", "500"); if (pt) url.searchParams.set("page_token", pt); const d = await fetch(url.toString(), { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json()); for (const r of d.data?.items || []) ids.push(r.record_id); if (!d.data?.has_more) break; pt = d.data.page_token; }
    for (let i = 0; i < ids.length; i += 500) await fetch(`${U}/bitable/v1/apps/${APP}/tables/${logId}/records/batch_delete`, { method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" }, body: JSON.stringify({ records: ids.slice(i, i + 500) }) });
  }
  const rows = [...ev.values()].map(e => ({ fields: { "Key": `${e.lead_id}|${e.tag}`, "Lead ID": e.lead_id, "Tên": e.name || "", "Tag": e.tag, "Loại": e.kind, "Gắn lúc": e.ms, "Platform": e.platform, "TVV": e.tvv || "" } }));
  let ins = 0;
  for (let i = 0; i < rows.length; i += 500) { const rr = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${logId}/records/batch_create`, { method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" }, body: JSON.stringify({ records: rows.slice(i, i + 500) }) }).then(r => r.json()); if (rr.code === 0) ins += rr.data.records.length; }
  console.log(`[tag-sync] SMAX_Tag_Log: ${ins} dòng`);

  // 5) 4 cột lead-class trên SMAX_Database
  const dbTbl = tables.find((t: any) => t.name === "SMAX_Database"); if (!dbTbl) { console.log("[tag-sync] không thấy SMAX_Database"); return; }
  const dbId = dbTbl.table_id;
  // ensure fields
  const fR = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/fields?page_size=200`, { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
  const existing = new Set((fR.data?.items || []).map((f: any) => f.field_name));
  for (const col of Object.values(CLASS_COLS)) if (!existing.has(col)) await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/fields`, { method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" }, body: JSON.stringify({ field_name: col, type: 5, property: { date_formatter: "yyyy-MM-dd HH:mm", auto_fill: false } }) });
  // update rows theo Lead ID (chỉ dòng lệch)
  const upd: any[] = []; let pt2: string | undefined;
  while (true) {
    const url = new URL(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/records`); url.searchParams.set("page_size", "500");
    url.searchParams.set("field_names", JSON.stringify(["Lead ID", ...Object.values(CLASS_COLS)]));
    if (pt2) url.searchParams.set("page_token", pt2);
    const d = await fetch(url.toString(), { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
    for (const r of d.data?.items || []) {
      const lid = txt(r.fields?.["Lead ID"]); if (!lid) continue;
      const want = classTimes.get(lid); if (!want) continue;
      const patch: Record<string, unknown> = {};
      for (const col of Object.values(CLASS_COLS)) { const w = want[col] ?? null; const cur = typeof r.fields?.[col] === "number" ? r.fields[col] : null; if (w && w !== cur) patch[col] = w; }
      if (Object.keys(patch).length) upd.push({ record_id: r.record_id, fields: patch });
    }
    if (!d.data?.has_more) break; pt2 = d.data.page_token;
  }
  let uw = 0;
  for (let i = 0; i < upd.length; i += 400) { const rr = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/records/batch_update`, { method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" }, body: JSON.stringify({ records: upd.slice(i, i + 400) }) }).then(r => r.json()); if (rr.code === 0) uw += Math.min(400, upd.length - i); }
  console.log(`[tag-sync] SMAX_Database 4 cột lead-class: cập nhật ${uw} dòng`);
}

runTagSync().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
