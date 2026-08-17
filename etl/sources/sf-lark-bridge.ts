/**
 * SALESFORCE → Lark TRỰC TIẾP, KHÔNG QUA SUPABASE.
 *
 * Anh em với smax-lark-bridge.ts. Ra đời 2026-08-17: Supabase bị khoá egress
 * quota ⇒ luồng SF → fact_touchpoint → Lark đứng từ 14/08, trong khi Salesforce
 * API vẫn sống và vẫn có lead mới mỗi ngày. Dashboard đếm "Hot mới" = Hot SMAX
 * + lead CHỈ có trên SF, nên SF đứng là số Hot bị hụt.
 *
 * Ghi vào bảng Lark "Salesforce_Database", đúng những cột /api/radar đọc:
 *   Time (CreatedDate) · Event="lead_created" · Tên SF · Phone · Email
 *   Rating (SF) · Khoá (SF) · Lead cũ (SF) · Tag SMAX
 *
 * "Tag SMAX" lấy bằng cách dò SĐT/email sang bảng SMAX_Database (thay cho
 * dim_lead) — dashboard dùng cột này để CHỐNG ĐẾM ĐÔI: lead nào SMAX đã tính
 * Hot rồi thì nhánh SF bỏ qua.
 *
 * Bảng SF trên Lark KHÔNG có cột ID nên chống trùng bằng khoá tổng hợp
 * Time|Event|Tên SF (giống keyOf() của lark-push.ts).
 *
 * Chạy: npm run etl:sf:lark:bridge     (thêm SF_BRIDGE_DRYRUN=1 để chỉ xem)
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const INST = process.env.SALESFORCE_INSTANCE_URL || "";
const CID = process.env.SALESFORCE_CLIENT_ID || "", CSEC = process.env.SALESFORCE_CLIENT_SECRET || "";
const V = process.env.SALESFORCE_API_VERSION || "v59.0";
const U = "https://open.larksuite.com/open-apis";
const LID = process.env.LARK_APP_ID || "", LSEC = process.env.LARK_APP_SECRET || "", APP = process.env.LARK_BASE_APP_TOKEN || "";
const DRYRUN = process.env.SF_BRIDGE_DRYRUN === "1";
// Dashboard chỉ đọc ~40 ngày; lấy dư một chút cho chắc.
const DAYS = Number(process.env.SF_BRIDGE_DAYS || 45);

const txt = (v: unknown): string => Array.isArray(v) ? (v as { text?: string }[]).map(x => x?.text ?? "").join("") : (v == null ? "" : String(v));
const lst = (v: unknown): string[] => Array.isArray(v) ? (v as any[]).map(x => typeof x === "object" && x ? (x.text ?? x.name ?? "") : String(x)).filter(Boolean) : [];
const normPh = (p: unknown) => { const d = String(p ?? "").replace(/\D/g, ""); return d.length >= 9 ? d.slice(-9) : ""; };
const normEm = (e: unknown) => String(e ?? "").toLowerCase().trim();
/** Khoá chống trùng — khớp keyOf() bên lark-push.ts (Time|Event|Tên). */
const rowKey = (timeMs: number, name: string) => `${timeMs}|lead_created|${name.trim().toLowerCase()}`;

async function sfToken(): Promise<string> {
  const r = await fetch(`${INST}/services/oauth2/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: CID, client_secret: CSEC }),
  }).then(r => r.json());
  if (!r.access_token) throw new Error(`SF auth lỗi: ${JSON.stringify(r).slice(0, 200)}`);
  return r.access_token;
}
async function sfQuery<T>(tk: string, soql: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = `${INST}/services/data/${V}/query?q=${encodeURIComponent(soql)}`;
  while (url) {
    const res: any = await fetch(url, { headers: { Authorization: `Bearer ${tk}` } });
    if (!res.ok) throw new Error(`SF query ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j: any = await res.json();
    out.push(...(j.records ?? []));
    url = j.nextRecordsUrl ? `${INST}${j.nextRecordsUrl}` : null;
  }
  return out;
}
async function larkToken(): Promise<string> {
  const r = await fetch(`${U}/auth/v3/tenant_access_token/internal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: LID, app_secret: LSEC }) }).then(r => r.json());
  return r.tenant_access_token;
}
async function tableId(tk: string, name: string): Promise<string | null> {
  const r = await fetch(`${U}/bitable/v1/apps/${APP}/tables?page_size=100`, { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
  if (r.code !== 0) throw new Error(`đọc tables lỗi: ${r.code} ${r.msg}`);
  return r.data.items.find((t: any) => t.name === name)?.table_id ?? null;
}
/** Đọc hết 1 bảng Lark, có kiểm lỗi (Lark hay trả 1254607 "Data not ready"). */
async function readAll(tk: string, tbl: string, fields: string[]): Promise<{ rid: string; f: Record<string, unknown> }[]> {
  const out: { rid: string; f: Record<string, unknown> }[] = [];
  let pt: string | undefined;
  while (true) {
    const url = new URL(`${U}/bitable/v1/apps/${APP}/tables/${tbl}/records`);
    url.searchParams.set("page_size", "500"); url.searchParams.set("field_names", JSON.stringify(fields));
    if (pt) url.searchParams.set("page_token", pt);
    const d = await fetch(url.toString(), { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
    if (d.code !== 0) throw new Error(`đọc records lỗi: ${d.code} ${d.msg}`);
    for (const r of d.data?.items || []) out.push({ rid: r.record_id, f: r.fields || {} });
    if (!d.data?.has_more) break; pt = d.data.page_token;
  }
  return out;
}

type SfLead = { Id: string; Name: string; Email: string | null; Phone: string | null; Rating: string | null; Product__c: string | null; CreatedDate: string; RelevantLeads__c: string | null; Company?: string | null; Status?: string | null };

export async function runSfLarkBridge() {
  if (!INST || !CID || !APP) { console.log("[sf-bridge] thiếu creds SF/Lark, dừng"); return; }

  const stk = await sfToken();
  // Product__c là ID (01t…) → cần bảng tra sang tên khoá ("K61 - ONL - 2026"),
  // vì dashboard tách mã khoá từ chuỗi tên chứ không hiểu ID.
  const products = await sfQuery<{ Id: string; Name: string }>(stk, `SELECT Id, Name FROM Product2 LIMIT 5000`);
  const prodName = new Map(products.map(p => [p.Id, p.Name]));

  const soql = `SELECT Id, Name, Email, Phone, Company, Status, Rating, Product__c, CreatedDate, RelevantLeads__c FROM Lead WHERE CreatedDate >= LAST_N_DAYS:${DAYS} AND IsConverted = false ORDER BY CreatedDate DESC`;
  const leads = await sfQuery<SfLead>(stk, soql);
  console.log(`[sf-bridge] Salesforce: ${leads.length} lead trong ${DAYS} ngày | ${prodName.size} sản phẩm`);
  if (!leads.length) { console.log("[sf-bridge] SF trả 0 lead — DỪNG, không ghi gì."); return; }

  const ltk = await larkToken();
  const sfTbl = await tableId(ltk, "Salesforce_Database");
  const smaxTbl = await tableId(ltk, "SMAX_Database");
  if (!sfTbl) { console.log("[sf-bridge] không thấy bảng Salesforce_Database"); return; }

  // Tag SMAX theo SĐT/email — thay cho dim_lead. Dashboard dùng cột này để bỏ
  // qua lead mà SMAX đã đếm Hot rồi (chống đếm đôi).
  const tagByPhone = new Map<string, string[]>(), tagByEmail = new Map<string, string[]>();
  if (smaxTbl) {
    const sm = await readAll(ltk, smaxTbl, ["Phone", "Email", "Tag SMAX"]);
    for (const { f } of sm) {
      const tags = lst(f["Tag SMAX"]); if (!tags.length) continue;
      const ph = normPh(txt(f["Phone"])); if (ph && !tagByPhone.has(ph)) tagByPhone.set(ph, tags);
      const em = normEm(txt(f["Email"])); if (em && !tagByEmail.has(em)) tagByEmail.set(em, tags);
    }
    console.log(`[sf-bridge] Tag SMAX tra được: ${tagByPhone.size} sđt · ${tagByEmail.size} email`);
  }

  const existing = await readAll(ltk, sfTbl, ["Time", "Event", "Tên SF", "Rating (SF)", "Tag SMAX"]);
  const byKey = new Map<string, { rid: string; f: Record<string, unknown> }>();
  for (const r of existing) {
    const t = typeof r.f["Time"] === "number" ? r.f["Time"] as number : 0;
    if (!t || txt(r.f["Event"]).trim() !== "lead_created") continue;
    byKey.set(rowKey(t, txt(r.f["Tên SF"])), r);
  }
  console.log(`[sf-bridge] Lark Salesforce_Database: ${existing.length} dòng (${byKey.size} lead_created có khoá)`);

  const creates: any[] = [], updates: any[] = [];
  for (const l of leads) {
    const timeMs = new Date(l.CreatedDate).getTime();
    if (!Number.isFinite(timeMs)) continue;
    const ph = normPh(l.Phone), em = normEm(l.Email);
    const tags = (ph && tagByPhone.get(ph)) || (em && tagByEmail.get(em)) || [];
    const fields: Record<string, unknown> = {
      "Time": timeMs,
      "Event": "lead_created",
      "Tên SF": String(l.Name ?? "").trim(),
      "Lead Name": String(l.Name ?? "").trim(),
      "Email": l.Email ?? "",
      "Phone": l.Phone ?? "",
      "Company": l.Company ?? "",
      "Stage": l.Status ?? "",
      "Rating (SF)": l.Rating ?? "",
      "Khoá (SF)": l.Product__c ? (prodName.get(l.Product__c) ?? "") : "",
      "Lead cũ (SF)": l.RelevantLeads__c ?? "",
    };
    if (tags.length) fields["Tag SMAX"] = tags;
    const hit = byKey.get(rowKey(timeMs, String(l.Name ?? "")));
    if (!hit) { creates.push({ fields }); continue; }
    // Đã có dòng → chỉ sửa khi Rating hoặc Tag SMAX lệch (rating Cold→Hot là
    // đổi kết quả đếm, phải cập nhật).
    const patch: Record<string, unknown> = {};
    if ((l.Rating ?? "") !== txt(hit.f["Rating (SF)"]).trim()) patch["Rating (SF)"] = l.Rating ?? "";
    const curTags = lst(hit.f["Tag SMAX"]).slice().sort().join("|");
    if (tags.length && tags.slice().sort().join("|") !== curTags) patch["Tag SMAX"] = tags;
    if (Object.keys(patch).length) updates.push({ record_id: hit.rid, fields: patch });
  }

  const hotNew = creates.filter(c => String(c.fields["Rating (SF)"]).toLowerCase() === "hot").length;
  console.log(`[sf-bridge] tạo mới: ${creates.length} (trong đó Rating=Hot: ${hotNew}) | cập nhật: ${updates.length}`);
  if (DRYRUN) {
    console.log("[sf-bridge] [CHẠY THỬ] KHÔNG ghi. 10 dòng đầu sẽ tạo:");
    for (const c of creates.slice(0, 10)) console.log(`   ${new Date(c.fields["Time"] as number).toISOString().slice(0, 16)} "${c.fields["Tên SF"]}" rating=${c.fields["Rating (SF)"] || "-"} khoá=${c.fields["Khoá (SF)"] || "-"} tagSMAX=${JSON.stringify(c.fields["Tag SMAX"] ?? [])}`);
    return;
  }
  for (let i = 0; i < creates.length; i += 400) {
    const rr = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${sfTbl}/records/batch_create`, {
      method: "POST", headers: { Authorization: `Bearer ${ltk}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: creates.slice(i, i + 400) }),
    }).then(r => r.json());
    if (rr.code !== 0) console.log(`[sf-bridge] batch_create lỗi: ${rr.code} ${rr.msg}`);
  }
  for (let i = 0; i < updates.length; i += 400) {
    const rr = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${sfTbl}/records/batch_update`, {
      method: "POST", headers: { Authorization: `Bearer ${ltk}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: updates.slice(i, i + 400) }),
    }).then(r => r.json());
    if (rr.code !== 0) console.log(`[sf-bridge] batch_update lỗi: ${rr.code} ${rr.msg}`);
  }
  console.log(`[sf-bridge] ✅ đã tạo ${creates.length}, cập nhật ${updates.length} dòng`);
}

runSfLarkBridge().then(() => process.exit(0)).catch((e) => { console.error("[sf-bridge] LỖI:", e.message); process.exit(1); });
