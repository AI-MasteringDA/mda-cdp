/**
 * CẦU NỐI TẠM (2026-08-17, lúc Supabase REST API/PostgREST bị khoá exceed_egress_quota,
 * chờ reset chu kỳ billing 01/09 hoặc user tự upgrade) — làm lại đúng việc
 * lead-first-chat.ts vẫn làm (tính "Ngày chat đầu"/"Hot Lead lúc" từ
 * SMAX API rồi đẩy lên Lark SMAX_Database), nhưng đọc dim_lead qua kết nối
 * Postgres TRỰC TIẾP (session pooler — xác nhận KHÔNG bị khoá cùng lúc với REST
 * API, xem etl/debug/test-pg-write.ts) thay vì admin.from(...) (đi qua PostgREST
 * đang bị khoá).
 *
 * CHỈ ĐỌC Supabase, KHÔNG GHI — an toàn, không đụng logic reconcile/backfill/dedup
 * phức tạp của lead-first-chat.ts/dedup-shadow.ts (rủi ro cao nếu viết vội).
 *
 * CỘT ĐƯỢC CẬP NHẬT: "Ngày chat đầu"/"Báo cáo ngày"/"Ngày check", "<class> lúc",
 * và (thêm 2026-08-17) "Time"/"Event"/"Chưa phản hồi" — hoạt động chat mới nhất,
 * vốn do lark-push.ts lo nhưng đang đứng cùng smax-real.ts nên cột "Time" đóng
 * băng từ 15/08.
 *
 * GIỚI HẠN:
 *  - Lead HOÀN TOÀN MỚI (chưa có trong dim_lead) KHÔNG được tạo ở đây — đợi
 *    Supabase mở lại mới chạy pipeline đầy đủ (identity.ts chống trùng kênh).
 *  - "Hot Score" KHÔNG đụng tới (user chốt bỏ) — số hiển thị là số cũ trước lúc khoá.
 *  - "Event"/"Chưa phản hồi" là XẤP XỈ: bản gốc so theo từng THREAD
 *    (last_message_by_customer_at), ở đây chỉ có object CUSTOMER nên dùng
 *    interaction.last — xem classifyLast() bên dưới.
 *  - KHÔNG cập nhật: "Total Chats", "Chat History 1..5", Lead Name/Email/Phone,
 *    và dữ liệu Salesforce/Wix/Instantly.
 *
 * TẮT JOB NÀY (xoá/disable file cron tương ứng) ngay khi Supabase REST API mở
 * lại — chạy song song với lead-first-chat/lark-push-smax sẽ dư thừa/ghi đè lẫn
 * nhau (dù không hỏng gì, chỉ tốn API call).
 *
 * Cần env SUPABASE_DB_PASSWORD + SUPABASE_POOLER_HOST (lấy từ Supabase Dashboard
 * → Connect → Session pooler). Chạy: npm run etl:smax:lark:bridge
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import pg from "pg";

const T = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const BASE = process.env.SMAX_BASE_URL || "https://api.smax.ai";
const BIZ = "mastering-data-analytics";
const ID = process.env.LARK_APP_ID || "", SEC = process.env.LARK_APP_SECRET || "", APP = process.env.LARK_BASE_APP_TOKEN || "";
const U = "https://open.larksuite.com/open-apis";
const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").hostname.split(".")[0];
const POOLER_HOST = process.env.SUPABASE_POOLER_HOST || "aws-1-ap-southeast-1.pooler.supabase.com";

const normPh = (p: unknown) => (p ? String(p).replace(/\D/g, "").replace(/^84/, "").replace(/^0/, "") : "");
const phoneFromName = (name: unknown) => { const m = String(name || "").match(/0\d{8,10}/); return m ? normPh(m[0]) : ""; };
function txt(v: unknown): string { return Array.isArray(v) ? (v as { text?: string }[]).map(x => x?.text ?? "").join("") : (v == null ? "" : String(v)); }
function vnMidnightMs(iso: string): number { const d = new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10); return new Date(d + "T00:00:00Z").getTime() - 7 * 3600 * 1000; }
async function larkToken() { const r = await fetch(`${U}/auth/v3/tenant_access_token/internal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: ID, app_secret: SEC }) }).then(r => r.json()); return r.tenant_access_token; }

const CLASS: Record<string, string> = { coldlead: "Cold Lead", hotlead: "Hot Lead", warmlead: "Warm Lead", prospect: "Prospect" };
const norm2 = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
function trackName(name: string): string | null {
  const n = norm2(name); if (CLASS[n]) return CLASS[n];
  const m = name.trim().match(/^(kh?\d{2,3}|f\d(\.\d)?)$/i); if (m) return name.trim().toUpperCase();
  return null;
}

// Tin auto (thiệp sinh nhật…) bị SMAX tính là tin khách — copy y hệt
// smax-real.ts để phân loại người gửi cuối cho khớp.
function isAutoCustomerNote(text: string | undefined | null): boolean {
  if (!text) return false;
  return /sinh nh[aậ]t c[uủ]a/i.test(text) || text.includes("res-zalo.zadn.vn");
}

/**
 * Ai nhắn CUỐI + có đang chờ mình trả lời không.
 *
 * Bản gốc (smax-real.ts) so `thread.last_message_at` vs
 * `thread.last_message_by_customer_at`. Ở đây chỉ có object CUSTOMER nên dùng
 * cặp tương đương gần nhất: `last_message_at` (tin cuối bất kỳ ai) vs
 * `interaction.last` (tương tác cuối CỦA KHÁCH) — XẤP XỈ, không phải 1:1 với
 * pipeline gốc (xem ghi chú GIỚI HẠN ở đầu file).
 *
 * "Chưa phản hồi" theo đúng công thức view v_smax_lead_snapshot:
 *   event_type='chat' AND occurred_at > now()-30d AND auto_last_note != true
 */
function classifyLast(c: any): { timeMs: number | null; event: "chat" | "chat_staff"; chuaPhanHoi: boolean } {
  const lastMsgMs = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
  const lastCustomerMs = c.interaction?.last ? new Date(c.interaction.last).getTime() : 0;
  const senderIsStaff = lastMsgMs > 0 && lastCustomerMs > 0 && lastMsgMs > lastCustomerMs;
  const noCustomerMsg = lastMsgMs > 0 && lastCustomerMs === 0;
  const autoLastNote = isAutoCustomerNote(c.last_content_by_user);
  const event = senderIsStaff || noCustomerMsg || autoLastNote ? "chat_staff" : "chat";
  const chuaPhanHoi = event === "chat" && lastMsgMs > Date.now() - 30 * 86400_000 && !autoLastNote;
  return { timeMs: lastMsgMs || null, event, chuaPhanHoi };
}

export async function runSmaxLarkBridge() {
  if (!T || !APP) { console.log("[bridge] thiếu creds SMAX/Lark, dừng"); return; }
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) { console.log("[bridge] thiếu SUPABASE_DB_PASSWORD, dừng"); return; }

  const pool = new pg.Pool({ host: POOLER_HOST, port: 5432, database: "postgres", user: `postgres.${projectRef}`, password, ssl: { rejectUnauthorized: false } });

  const byCust = new Map<string, string>(), byPid = new Map<string, string>(), byPhone = new Map<string, string>(), byEmail = new Map<string, string>();
  const { rows: leadRows } = await pool.query("select lead_id, phone, email, external_profile_id, smax_customer_id, full_name from dim_lead");
  for (const l of leadRows) {
    if (l.smax_customer_id) byCust.set(l.smax_customer_id, l.lead_id);
    if (l.external_profile_id) byPid.set(l.external_profile_id, l.lead_id);
    if (l.phone) byPhone.set(normPh(l.phone), l.lead_id);
    const np2 = phoneFromName(l.full_name); if (np2 && !byPhone.has(np2)) byPhone.set(np2, l.lead_id);
    if (l.email) byEmail.set(String(l.email).toLowerCase().trim(), l.lead_id);
  }
  console.log(`[bridge] dim_lead: ${leadRows.length} dòng (đọc qua raw pg)`);

  // Trước đây còn đọc fact_lead_score để đẩy "Hot Score" — BỎ 2026-08-17 theo
  // yêu cầu user: job tính điểm đang đứng nên chỉ đẩy lại số cũ, tốn query vô ích.
  await pool.end();

  const custPost = (body: unknown) => fetch(`${BASE}/bizs/${BIZ}/customers`, { method: "POST", headers: { Authorization: `Bearer ${T}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
  const pageIds: string[] = [];
  try {
    const pg2 = await fetch(`${BASE}/bizs/${BIZ}/pages`, { headers: { Authorization: `Bearer ${T}` } }).then(r => r.json());
    for (const p of (pg2.data ?? pg2.pages ?? [])) { const pid = p.pid || p.page_pid || p.id; if (pid) pageIds.push(pid); }
  } catch { /* fallback size lớn 1 phát */ }
  const custById = new Map<string, Record<string, unknown>>();
  if (pageIds.length) { for (const pid of pageIds) { const r = await custPost({ size: 10000, page_pids: [pid] }); for (const c of (r.data || [])) if (c.id) custById.set(c.id, c); } }
  else { const r = await custPost({ size: 10000 }); for (const c of (r.data || [])) if (c.id) custById.set(c.id, c); }
  const customers = Array.from(custById.values());
  console.log(`[bridge] SMAX customers: ${customers.length}`);

  const firstMs = new Map<string, number>();
  const tagTimes = new Map<string, Record<string, number>>();
  const lucSet = new Set<string>();
  // Hoạt động chat gần nhất: 1 lead có thể ứng nhiều customer SMAX (nhiều kênh)
  // → giữ bản ghi có last_message_at MỚI NHẤT, khớp cách view gốc lấy touchpoint
  // mới nhất của lead (DISTINCT ON lead_id ORDER BY occurred_at DESC).
  const lastAct = new Map<string, { timeMs: number; event: string; chuaPhanHoi: boolean }>();
  let matched = 0;
  for (const c of (customers as any[])) {
    const namePh = phoneFromName(c.name);
    const lead = (c.id && byCust.get(c.id)) || (c.pid && byPid.get(c.pid)) || (c.phone && byPhone.get(normPh(c.phone))) || (namePh && byPhone.get(namePh)) || (c.email && byEmail.get(String(c.email).toLowerCase().trim()));
    if (!lead) continue;
    matched++;
    const first = c.interaction?.first ?? c.created_at;
    if (first) { const ms = vnMidnightMs(first); const prev = firstMs.get(lead); if (prev == null || ms < prev) firstMs.set(lead, ms); }
    const act = classifyLast(c);
    if (act.timeMs != null) {
      const prev = lastAct.get(lead);
      if (!prev || act.timeMs > prev.timeMs) lastAct.set(lead, { timeMs: act.timeMs, event: act.event, chuaPhanHoi: act.chuaPhanHoi });
    }
    for (const tg of (c.tags || [])) {
      const nmRaw = String(tg.name || tg.alias || "").trim();
      const nm = trackName(nmRaw); if (!nm) continue;
      const tms = tg.time ? new Date(tg.time).getTime() : 0; if (!tms) continue;
      const col = `${nm} lúc`; lucSet.add(col);
      const m = tagTimes.get(lead) || {}; if (!m[col] || tms > m[col]) m[col] = tms; tagTimes.set(lead, m);
    }
  }
  console.log(`[bridge] khớp được lead có sẵn: ${matched} | lead có ngày chat đầu: ${firstMs.size} | có hoạt động chat: ${lastAct.size} | cột tag-time: ${lucSet.size}`);
  if (!matched) { console.log("[bridge] 0 lead khớp — dừng, không đẩy gì lên Lark (tránh ghi rỗng)."); return; }

  const tk = await larkToken();
  const tR = await fetch(`${U}/bitable/v1/apps/${APP}/tables?page_size=100`, { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
  const dbTbl = tR.data.items.find((t: any) => t.name === "SMAX_Database"); if (!dbTbl) { console.log("[bridge] không thấy SMAX_Database"); return; }
  const dbId = dbTbl.table_id;
  const fR = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/fields?page_size=100`, { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
  if (fR.code !== 0) throw new Error(`đọc fields Lark lỗi: ${fR.code} ${fR.msg}`);
  const existing = new Set<string>((fR.data?.items || []).map((f: any) => f.field_name));
  // CHỈ đụng cột ĐANG TỒN TẠI. Bridge cố tình KHÔNG tạo cột mới (việc đó của
  // lead-first-chat.ts) — nếu SMAX có tag-class chưa có cột tương ứng mà vẫn
  // đưa vào field_names thì Lark trả 1254045 FieldNameNotFound và hỏng cả lần
  // chạy (gặp 2026-08-17: SMAX 30 tag-time vs Lark 29 cột).
  const lucCols = [...existing].filter(n => / lúc$/.test(n));
  const missingLuc = [...lucSet].filter(n => !existing.has(n));
  if (missingLuc.length) console.log(`[bridge] ⚠ SMAX có tag-time chưa có cột trên Lark, BỎ QUA: ${missingLuc.join(", ")}`);
  const CHK = "Lần cập nhật cuối", BC = "Báo cáo ngày", NC = "Ngày check", COL = "Ngày chat đầu";
  const wantCols = ["Lead ID", COL, BC, NC, "Time", "Event", "Chưa phản hồi"].filter(n => existing.has(n));

  const runMs = Date.now();
  const upd: any[] = []; let pt: string | undefined;
  while (true) {
    const url = new URL(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/records`); url.searchParams.set("page_size", "500");
    // BC/NC PHẢI nằm trong field_names (wantCols), nếu không r.fields[BC] luôn
    // undefined ⇒ lần nào cũng tưởng "lệch" và ghi đè lại 2 cột đó vô ích.
    url.searchParams.set("field_names", JSON.stringify([...wantCols, ...lucCols]));
    if (pt) url.searchParams.set("page_token", pt);
    const d = await fetch(url.toString(), { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
    // GUARD: Lark hay trả 1254607 "Data not ready" khi bảng lớn. Không check
    // code thì d.data undefined ⇒ vòng lặp im lặng thoát ⇒ job báo "0 dòng cần
    // cập nhật" và ✅ success dù chưa đọc được gì (đúng bug đã gặp 2026-08-17:
    // cột Time đứng ở 15/08 mà job vẫn báo không có gì để làm).
    if (d.code !== 0) throw new Error(`đọc Lark lỗi: ${d.code} ${d.msg}`);
    for (const r of d.data?.items || []) {
      const lid = txt(r.fields?.["Lead ID"]); if (!lid) continue;
      const patch: Record<string, unknown> = {};
      const want = firstMs.get(lid);
      if (want != null) {
        const cur = typeof r.fields?.[COL] === "number" ? r.fields[COL] : null; if (want !== cur) patch[COL] = want;
        const curBC = typeof r.fields?.[BC] === "number" ? r.fields[BC] : null; if (want !== curBC) patch[BC] = want;
        const nc = want + 86400000; const curNC = typeof r.fields?.[NC] === "number" ? r.fields[NC] : null; if (nc !== curNC) patch[NC] = nc;
      }
      // "Hot Score" BỎ (user chốt 2026-08-17: "cột score bỏ luôn đi, k cần pull
      // về") — job tính điểm đang đứng nên giá trị chỉ là số cũ, đẩy lại vô nghĩa.
      // Hoạt động chat mới nhất — phần này lark-push.ts thường lo (đọc
      // v_smax_lead_snapshot qua PostgREST), nhưng cả nó lẫn smax-real.ts đều
      // đang đứng vì bị khoá ⇒ cột "Time" đóng băng. Ở đây lấy THẲNG từ SMAX API.
      const act = lastAct.get(lid);
      if (act) {
        const curT = typeof r.fields?.["Time"] === "number" ? r.fields["Time"] : null;
        if (act.timeMs !== curT) patch["Time"] = act.timeMs;
        const curE = txt(r.fields?.["Event"]).trim();
        if (act.event !== curE) patch["Event"] = act.event;
        const curC = r.fields?.["Chưa phản hồi"] === true;
        if (act.chuaPhanHoi !== curC) patch["Chưa phản hồi"] = act.chuaPhanHoi;
      }
      const tt = tagTimes.get(lid) || {};
      for (const col of lucCols) { const w = tt[col]; const curL = typeof r.fields?.[col] === "number" ? r.fields[col] : null; if (w != null && w !== curL) patch[col] = w; }
      patch[CHK] = runMs;
      if (Object.keys(patch).length > 1) upd.push({ record_id: r.record_id, fields: patch });
    }
    if (!d.data?.has_more) break; pt = d.data.page_token;
  }
  console.log(`[bridge] cần cập nhật: ${upd.length} dòng`);
  let uw = 0;
  for (let i = 0; i < upd.length; i += 400) { const rr = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/records/batch_update`, { method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" }, body: JSON.stringify({ records: upd.slice(i, i + 400) }) }).then(r => r.json()); if (rr.code === 0) uw += upd.slice(i, i + 400).length; else console.log(`[bridge] batch lỗi: ${rr.code} ${rr.msg}`); }
  console.log(`[bridge] ✅ ĐÃ ĐẨY: ${uw}/${upd.length} dòng lên Lark SMAX_Database`);
}

runSmaxLarkBridge().then(() => process.exit(0)).catch((e) => { console.error("[bridge] LỖI:", e.message); process.exit(1); });
