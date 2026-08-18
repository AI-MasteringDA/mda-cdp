/**
 * SMAX → Lark TRỰC TIẾP, KHÔNG QUA SUPABASE.
 *
 * Ra đời 2026-08-17 khi Supabase bị khoá (exceed_egress_quota) làm cả pipeline
 * đứng. CHÍNH LARK đã chứa đủ bảng danh tính (99,9% dòng có cột "ID" = pid
 * SMAX) nên job này KHÔNG BẮT BUỘC cần Supabase.
 *
 * Cách hoạt động: đọc Lark → dựng bản đồ pid/SĐT/email → dòng nào; gọi SMAX API
 * lấy trạng thái mới nhất; so lệch rồi ghi ngược lên Lark. KHÔNG đụng DB nào.
 *
 * CỘT ĐƯỢC CẬP NHẬT:
 *   "Ngày chat đầu" / "Báo cáo ngày" / "Ngày check"  (mốc quy lead về ngày)
 *   "<class> lúc"    (Hot/Cold/Warm/Prospect/K##/F# — thời điểm gắn tag)
 *   "Time" / "Event" / "Chưa phản hồi"               (hoạt động chat mới nhất)
 *
 * GIỚI HẠN — những thứ VẪN cần pipeline đầy đủ (đang chờ Supabase mở lại):
 *  - Lead HOÀN TOÀN MỚI không được tạo ở đây. Job này chỉ cập nhật dòng ĐÃ CÓ.
 *    Tạo dòng mới cần luật chống-trùng-kênh của identity.ts (1 người nhắn FB +
 *    Zalo = 2 customer SMAX nhưng phải về 1 dòng) — viết vội rất dễ đẻ lead trùng.
 *  - "Hot Score" không đụng (user chốt bỏ 2026-08-17) — job tính điểm đang đứng.
 *  - Không đụng: "Total Chats", Lead Name/Email/Phone, và dữ liệu SF/Wix/Instantly.
 *  - "Event"/"Chưa phản hồi" là XẤP XỈ — xem classifyLast() bên dưới.
 *
 * Chạy: npm run etl:smax:lark:bridge
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { isCompanyPhone, isCompanyEmail } from "../lib/company-contacts";

const T = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const BASE = process.env.SMAX_BASE_URL || "https://api.smax.ai";
const BIZ = "mastering-data-analytics";
const ID = process.env.LARK_APP_ID || "", SEC = process.env.LARK_APP_SECRET || "", APP = process.env.LARK_BASE_APP_TOKEN || "";
const U = "https://open.larksuite.com/open-apis";
// 2 CHẾ ĐỘ (user chốt 2026-08-17 "chỉ sync cái nào mới/được update trong interval"):
//   NHANH (mặc định, mỗi 7'): chỉ đụng khách vừa đổi trong LOOKBACK_MIN phút →
//     tra đúng vài chục dòng thay vì đọc cả 19k (39 trang).
//   ĐỐI SOÁT (BRIDGE_FULL=1, chạy theo giờ): quét toàn bảng, bắt phần bản nhanh
//     có thể sót (khách khớp bằng SĐT/email chứ không bằng pid). Đây là lưới an
//     toàn để SỐ LUÔN ĐÚNG — đừng bỏ lịch chạy này.
// TỰ ĐỐI SOÁT ĐẦU MỖI GIỜ — KHÔNG dựa vào lịch cron của GitHub.
// Lý do (sự cố 2026-08-18): lịch GitHub im suốt 14 tiếng, mà nó là thứ duy nhất
// kích hoạt chế độ ĐỐI SOÁT ⇒ cả buổi sáng không ai quét lại ⇒ 7/9 khách có
// tin nhắn trong ngày không được cập nhật. cron-job.org (7 phút) thì chỉ gọi
// chế độ NHANH. Nay bridge tự xem đồng hồ: lần chạy nào rơi vào 8 phút đầu của
// giờ thì tự nâng thành ĐỐI SOÁT ⇒ chỉ cần MỘT trigger 7 phút là có đủ cả hai.
const nowMin = new Date().getUTCMinutes();
const FULL = process.env.BRIDGE_FULL === "1" || nowMin < 8;
// Cửa sổ nhìn lại. Rộng gấp nhiều lần nhịp cron để lỡ vài lần chạy hỏng vẫn
// không sót; phần vượt cửa sổ do lần đối soát đầu giờ quét lại.
const LOOKBACK_MIN = Number(process.env.BRIDGE_LOOKBACK_MIN || 180);
// BRIDGE_DRYRUN=1 — xem sẽ tạo dòng nào mà KHÔNG ghi (dùng trước mỗi lần đổi
// luật tạo lead, vì tạo nhầm ra dòng trùng là đếm đôi Hot lead).
const DRYRUN = process.env.BRIDGE_DRYRUN === "1";
// Chỉ tạo dòng cho khách còn hoạt động trong ngần này ngày. Dashboard chỉ đọc
// ~40 ngày nên tạo cũ hơn là vô ích, mà bảng Lark có TRẦN 20.000 dòng
// (đang 19.284 — thả hết 1.679 ca tồn đọng vào là vỡ).
const CREATE_MAX_AGE_DAYS = Number(process.env.BRIDGE_CREATE_MAX_AGE_DAYS || 45);

const normPh = (p: unknown) => (p ? String(p).replace(/\D/g, "").replace(/^84/, "").replace(/^0/, "") : "");
const phoneFromName = (name: unknown) => { const m = String(name || "").match(/0\d{8,10}/); return m ? normPh(m[0]) : ""; };
// Cột "ID" trên Lark lưu pid ĐÃ BỎ tiền tố nền tảng (xem stripSmaxIdPrefix
// trong lark-push.ts) — phải bỏ y hệt thì mới khớp được.
const stripSmaxId = (p: unknown) => String(p ?? "").replace(/^(fb|zlw|zl|ig|ctm)/i, "");
function txt(v: unknown): string { return Array.isArray(v) ? (v as { text?: string }[]).map(x => x?.text ?? "").join("") : (v == null ? "" : String(v)); }
function vnMidnightMs(iso: string): number { const d = new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10); return new Date(d + "T00:00:00Z").getTime() - 7 * 3600 * 1000; }
async function larkToken() { const r = await fetch(`${U}/auth/v3/tenant_access_token/internal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: ID, app_secret: SEC }) }).then(r => r.json()); return r.tenant_access_token; }

const CLASS: Record<string, string> = { coldlead: "Cold Lead", hotlead: "Hot Lead", warmlead: "Warm Lead", prospect: "Prospect" };
const CLASS_KEYS = new Set(Object.keys(CLASS));
const norm2 = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
/** Đọc cột multi-select của Lark ra mảng chuỗi. */
const lstOf = (v: unknown): string[] => Array.isArray(v)
  ? (v as any[]).map(x => typeof x === "object" && x ? (x.text ?? x.name ?? "") : String(x)).filter(Boolean)
  : (v ? [String(v)] : []);
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
 * `interaction.last` (tương tác cuối CỦA KHÁCH) — XẤP XỈ, không phải 1:1.
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

  // ── 1) SMAX: kéo customer theo từng page (kéo 1 phát bị chặn 10.000, làm hụt
  //        khách cũ — xem ghi chú trong lead-first-chat.ts).
  const custPost = (body: unknown) => fetch(`${BASE}/bizs/${BIZ}/customers`, { method: "POST", headers: { Authorization: `Bearer ${T}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
  const pageIds: string[] = [];
  try {
    const pg2 = await fetch(`${BASE}/bizs/${BIZ}/pages`, { headers: { Authorization: `Bearer ${T}` } }).then(r => r.json());
    for (const p of (pg2.data ?? pg2.pages ?? [])) { const pid = p.pid || p.page_pid || p.id; if (pid) pageIds.push(pid); }
  } catch { /* fallback: kéo 1 phát size lớn */ }
  const custById = new Map<string, Record<string, unknown>>();
  if (pageIds.length) { for (const pid of pageIds) { const r = await custPost({ size: 10000, page_pids: [pid] }); for (const c of (r.data || [])) if (c.id) custById.set(c.id, c); } }
  else { const r = await custPost({ size: 10000 }); for (const c of (r.data || [])) if (c.id) custById.set(c.id, c); }
  const customers = Array.from(custById.values());
  console.log(`[bridge] SMAX customers: ${customers.length}`);
  if (!customers.length) { console.log("[bridge] SMAX trả 0 khách — DỪNG, không ghi gì (tránh xoá trắng)."); return; }

  // ── 2) Lark: đọc cột + toàn bộ dòng, vừa dựng bản đồ danh tính vừa giữ giá
  //        trị hiện tại để so lệch. ĐÂY LÀ NGUỒN DANH TÍNH — thay cho dim_lead.
  const tk = await larkToken();
  const tR = await fetch(`${U}/bitable/v1/apps/${APP}/tables?page_size=100`, { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
  if (tR.code !== 0) throw new Error(`đọc tables Lark lỗi: ${tR.code} ${tR.msg}`);
  const dbTbl = tR.data.items.find((t: any) => t.name === "SMAX_Database"); if (!dbTbl) { console.log("[bridge] không thấy SMAX_Database"); return; }
  const dbId = dbTbl.table_id;

  const fR = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/fields?page_size=100`, { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
  if (fR.code !== 0) throw new Error(`đọc fields Lark lỗi: ${fR.code} ${fR.msg}`);
  const existing = new Set<string>((fR.data?.items || []).map((f: any) => f.field_name));
  const CHK = "Lần cập nhật cuối", BC = "Báo cáo ngày", NC = "Ngày check", COL = "Ngày chat đầu";
  // "Chat đầu lúc" — GIỜ CHÍNH XÁC của tin nhắn đầu (interaction.first).
  // Vì sao cần: "Ngày chat đầu"/"Báo cáo ngày" cố tình lưu 00:00 để gom theo
  // NGÀY, nhưng báo cáo khung giờ (Chiều = 10:30–17:00) lọc theo mốc đó thì
  // nửa đêm KHÔNG BAO GIỜ lọt vào khoảng ⇒ Lead mới/Cold/Prospect/Warm luôn ra
  // 0 (bug 2026-08-17, mọi báo cáo Chiều đều rỗng). Cột này giữ giờ thật để
  // /api/radar lọc đúng; các view theo ngày vẫn dùng "Báo cáo ngày" như cũ.
  const EXACT = "Chat đầu lúc";
  if (!existing.has(EXACT)) {
    const cr = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/fields`, {
      method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
      body: JSON.stringify({ field_name: EXACT, type: 5, property: { date_formatter: "yyyy-MM-dd HH:mm", auto_fill: false } }),
    }).then(r => r.json());
    if (cr.code === 0) { existing.add(EXACT); console.log(`[bridge] đã tạo cột "${EXACT}"`); }
    else console.log(`[bridge] ⚠ không tạo được cột "${EXACT}": ${cr.code} ${cr.msg}`);
  }
  // CHỈ đụng cột ĐANG TỒN TẠI. Bridge cố tình KHÔNG tạo cột mới (việc của
  // lead-first-chat.ts) — đưa cột chưa có vào field_names thì Lark trả 1254045
  // FieldNameNotFound và hỏng cả lần chạy (gặp 2026-08-17 với "K62 lúc").
  const lucCols = [...existing].filter(n => / lúc$/.test(n));
  const idCols = ["Lead ID", "ID", "Phone", "Email", "Lead Name"].filter(n => existing.has(n));
  // "Tag SMAX" BẮT BUỘC phải nằm đây. Thiếu nó thì f["Tag SMAX"] luôn undefined
  // ⇒ code tưởng ô đang rỗng ⇒ (a) lần nào cũng ghi lại 7.800 dòng vô ích, và
  // (b) nguy hiểm hơn: phép union "giữ tag cũ" mất tác dụng, biến mirror thành
  // GHI ĐÈ — đúng loại lỗi làm mất tag hàng loạt hồi 2026-08-06 (Hot 2004→1148).
  const valCols = [COL, BC, NC, EXACT, "Time", "Event", "Chưa phản hồi", "Tag SMAX"].filter(n => existing.has(n));

  type Row = { rid: string; f: Record<string, unknown> };
  const rows: Row[] = [];
  const byPid = new Map<string, string>(), byPhone = new Map<string, string>(), byEmail = new Map<string, string>();
  const readCols = [...idCols, ...valCols, ...lucCols];
  const collect = (items: any[]) => {
    for (const r of items) {
      const f = r.fields || {};
      rows.push({ rid: r.record_id, f });
      const pidKey = txt(f["ID"]).trim();
      if (pidKey && !byPid.has(pidKey)) byPid.set(pidKey, r.record_id);
      const ph = normPh(txt(f["Phone"])); if (ph && !byPhone.has(ph)) byPhone.set(ph, r.record_id);
      const nph = phoneFromName(txt(f["Lead Name"])); if (nph && !byPhone.has(nph)) byPhone.set(nph, r.record_id);
      const em = txt(f["Email"]).toLowerCase().trim(); if (em && !byEmail.has(em)) byEmail.set(em, r.record_id);
    }
  };

  // Khách SMAX có động tĩnh gì trong khoảng lookback không? Lấy mốc MUỘN NHẤT
  // trong mọi dấu vết thay đổi — chỉ nhìn updated_at là hụt (SMAX không phải
  // lúc nào cũng đụng vào nó khi gắn tag).
  const touchedMs = (c: any): number => {
    let m = 0;
    for (const v of [c.updated_at, c.last_message_at, c.interaction?.last, c.interaction?.first, c.created_at]) {
      const t = v ? new Date(v).getTime() : 0; if (t > m) m = t;
    }
    for (const tg of (c.tags || [])) { const t = tg.time ? new Date(tg.time).getTime() : 0; if (t > m) m = t; }
    return m;
  };

  let targets = customers as any[];
  if (FULL) {
    // ĐỐI SOÁT TOÀN BỘ: đọc hết bảng. Chậm (~39 trang) nhưng dựng đủ bản đồ
    // SĐT/email nên bắt được cả ca khớp-không-bằng-pid mà bản incremental bỏ sót.
    let pt: string | undefined;
    while (true) {
      const url = new URL(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/records`); url.searchParams.set("page_size", "500");
      url.searchParams.set("field_names", JSON.stringify(readCols));
      if (pt) url.searchParams.set("page_token", pt);
      const d = await fetch(url.toString(), { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
      // GUARD: Lark hay trả 1254607 "Data not ready" với bảng lớn. Không check code
      // thì d.data undefined ⇒ vòng lặp im lặng thoát ⇒ job báo "0 dòng cần cập
      // nhật" + ✅ success dù chưa đọc được gì (bug thật, gặp 2026-08-17).
      if (d.code !== 0) throw new Error(`đọc records Lark lỗi: ${d.code} ${d.msg}`);
      collect(d.data?.items || []);
      if (!d.data?.has_more) break; pt = d.data.page_token;
    }
    console.log(`[bridge] [ĐỐI SOÁT] Lark: ${rows.length} dòng | pid=${byPid.size} sđt=${byPhone.size} email=${byEmail.size}`);
  } else {
    // INCREMENTAL: chỉ đụng khách vừa có thay đổi trong LOOKBACK_MIN phút, rồi
    // tra ĐÚNG những dòng đó trên Lark (search lọc theo "ID", tối đa 50 điều
    // kiện/lần — thử 100 là Lark trả 99992402 field validation failed).
    // Cửa sổ rộng hơn nhịp cron nhiều lần để lỡ vài lần chạy hỏng vẫn không sót.
    const cutoff = Date.now() - LOOKBACK_MIN * 60_000;
    targets = (customers as any[]).filter(c => touchedMs(c) >= cutoff);
    const searchBy = async (field: string, values: string[]) => {
      for (let i = 0; i < values.length; i += 50) {
        const batch = values.slice(i, i + 50);
        const d = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/records/search?page_size=500`, {
          method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
          body: JSON.stringify({ field_names: readCols, filter: { conjunction: "or", conditions: batch.map(v => ({ field_name: field, operator: "is", value: [v] })) } }),
        }).then(r => r.json());
        if (d.code !== 0) throw new Error(`search Lark (${field}) lỗi: ${d.code} ${d.msg}`);
        collect(d.data?.items || []);
      }
    };
    const pids = [...new Set(targets.map(c => stripSmaxId(c.pid)).filter(Boolean))];
    await searchBy("ID", pids);
    // VÒNG 2 — tra thêm theo SĐT/email cho khách KHÔNG khớp pid.
    // Bắt buộc phải có nếu muốn chế độ NHANH được phép TẠO dòng mới: chỉ tra
    // pid thì không thấy dòng khớp bằng SĐT ⇒ tưởng là người mới ⇒ đẻ trùng.
    // Chỉ tra cho phần chưa khớp (thường vài chục) nên vẫn rất nhẹ.
    const miss = targets.filter(c => !byPid.has(stripSmaxId(c.pid)) && !byPid.has(String(c.id ?? "")));
    const phones = [...new Set(miss.map(c => String(c.phone ?? "").trim()).filter(Boolean))];
    const emails = [...new Set(miss.map(c => String(c.email ?? "").trim()).filter(Boolean))];
    if (phones.length) await searchBy("Phone", phones);
    if (emails.length) await searchBy("Email", emails);
    console.log(`[bridge] [NHANH] khách đổi trong ${LOOKBACK_MIN}': ${targets.length}/${customers.length} → tra ${pids.length} pid + ${phones.length} sđt + ${emails.length} email → ${rows.length} dòng Lark`);
  }
  if (!rows.length) { console.log("[bridge] không có dòng Lark nào cần đụng — xong."); return; }

  // KHÔNG đọc dim_lead ở đây — đã ĐO và loại bỏ (2026-08-17): thêm 17.149 khoá
  // tra cứu từ dim_lead chỉ khớp thêm ĐÚNG 3 khách (20.192 → 20.195), vì phần
  // lớn lead trong dim_lead (61k dòng) không hề có dòng tương ứng trên Lark
  // (19k dòng). Đổi lại phải quét full-table 61k dòng MỖI 7 PHÚT — đúng loại
  // truy vấn đã làm Supabase vượt egress quota. Không đáng.

  // ── 3) Khớp customer SMAX → dòng Lark, gom trạng thái mong muốn.
  const firstMs = new Map<string, number>();          // rid → ngày chat đầu (00:00 VN)
  const firstExact = new Map<string, number>();       // rid → giờ chat đầu CHÍNH XÁC
  const tagTimes = new Map<string, Record<string, number>>(); // rid → {"Hot Lead lúc": ms}
  const lucSeen = new Set<string>();
  // 1 dòng Lark có thể ứng nhiều customer SMAX (nhiều kênh) → giữ bản ghi có
  // last_message_at MỚI NHẤT, khớp cách view gốc lấy touchpoint mới nhất.
  const lastAct = new Map<string, { timeMs: number; event: string; chuaPhanHoi: boolean }>();
  // Tag hiện tại của khách, gom theo dòng Lark (union nếu 1 người nhiều kênh).
  // CẦN để mirror cột "Tag SMAX" — thiếu bước này thì tag trên Lark kẹt ở giá
  // trị cũ: ca "Mận Bùi" 2026-08-18 SMAX đã đổi Cold→Hot mà Lark vẫn hiện Cold,
  // kèm "Cold Lead lúc" cũ còn sót nên bị tính nhầm là NÂNG HẠNG thay vì Hot mới.
  const tagsNow = new Map<string, Set<string>>();
  // SĐT/email SMAX có mà ô trên Lark đang TRỐNG → điền vào.
  // Vì sao cần (ca "Mận Bùi" 2026-08-18): SMAX có manbui07@gmail.com nhưng ô
  // Email trên Lark trống ⇒ sf-lark-bridge không tra được "Tag SMAX" của cô ấy
  // ⇒ tưởng SMAX chưa đếm ⇒ TẠO THÊM một dòng Hot bên SF ⇒ ĐẾM ĐÔI.
  // BỎ QUA số/mail của công ty (xem company-contacts.ts — SMAX hay nhặt nhầm
  // hotline trong đoạn chat thành thông tin khách, từng gây ca "Sơn Huyền").
  const fillPhone = new Map<string, string>(), fillEmail = new Map<string, string>();
  let matched = 0;
  for (const c of targets) {
    const namePh = phoneFromName(c.name);
    const rid = byPid.get(stripSmaxId(c.pid)) || byPid.get(String(c.id ?? ""))
      || (c.phone && byPhone.get(normPh(c.phone))) || (namePh && byPhone.get(namePh))
      || (c.email && byEmail.get(String(c.email).toLowerCase().trim()));
    if (!rid) continue;
    matched++;
    const first = c.interaction?.first ?? c.created_at;
    if (first) {
      const ms = vnMidnightMs(first); const prev = firstMs.get(rid); if (prev == null || ms < prev) firstMs.set(rid, ms);
      const exact = new Date(first).getTime();
      const pe = firstExact.get(rid); if (Number.isFinite(exact) && (pe == null || exact < pe)) firstExact.set(rid, exact);
    }
    const act = classifyLast(c);
    if (act.timeMs != null) {
      const prev = lastAct.get(rid);
      if (!prev || act.timeMs > prev.timeMs) lastAct.set(rid, { timeMs: act.timeMs, event: act.event, chuaPhanHoi: act.chuaPhanHoi });
    }
    const ts = tagsNow.get(rid) ?? new Set<string>();
    for (const tg of (c.tags || [])) {
      const raw = String(tg.name || tg.alias || "").trim(); if (raw) ts.add(raw);
    }
    tagsNow.set(rid, ts);
    if (c.phone && !isCompanyPhone(c.phone) && !fillPhone.has(rid)) {
      const p = String(c.phone).trim(); fillPhone.set(rid, p.startsWith("0") ? p : "0" + normPh(p));
    }
    if (c.email && !isCompanyEmail(c.email) && !fillEmail.has(rid)) fillEmail.set(rid, String(c.email).toLowerCase().trim());
    for (const tg of (c.tags || [])) {
      const nm = trackName(String(tg.name || tg.alias || "").trim()); if (!nm) continue;
      const tms = tg.time ? new Date(tg.time).getTime() : 0; if (!tms) continue;
      const col = `${nm} lúc`; lucSeen.add(col);
      if (!existing.has(col)) continue; // cột chưa có trên Lark → bỏ qua (log bên dưới)
      const m = tagTimes.get(rid) || {}; if (!m[col] || tms > m[col]) m[col] = tms; tagTimes.set(rid, m);
    }
  }
  const missingLuc = [...lucSeen].filter(n => !existing.has(n));
  if (missingLuc.length) console.log(`[bridge] ⚠ SMAX có tag-time chưa có cột trên Lark, BỎ QUA: ${missingLuc.join(", ")}`);
  console.log(`[bridge] khớp: ${matched}/${targets.length} khách → dòng Lark | chưa khớp: ${targets.length - matched}`);

  // ── 3b) TẠO DÒNG MỚI cho khách chưa từng có trên Lark.
  // Chạy ở CẢ HAI chế độ. Ban đầu chỉ cho chạy ở ĐỐI SOÁT, nhưng thực tế
  // 2026-08-18 cho thấy sai lầm: lịch GitHub (thứ kích hoạt ĐỐI SOÁT) im suốt
  // 14 tiếng, trong khi cron-job.org chỉ gọi chế độ NHANH ⇒ lead mới cả buổi
  // sáng KHÔNG ai tạo. Nay chế độ NHANH cũng tra thêm SĐT/email cho phần không
  // khớp pid (xem "VÒNG 2" bên trên) nên đã đủ căn cứ để biết người này thật
  // sự chưa có dòng — tạo được mà không đẻ trùng.
  //
  // Luật loại trừ (bám đúng quy tắc sales đang dùng ở /api/radar):
  //   - comment chưa inbox  → không tính lead
  //   - Spam / Block        → bỏ
  //   - chưa từng chat      → bỏ (hồ sơ rỗng, 1.613 ca tồn đọng)
  // Và gộp trong chính lô mới: 2 customer cùng SĐT/gmail = 1 người → 1 dòng
  // (đo 2026-08-17: 29 nhóm trùng SĐT, nếu tạo rời là đếm đôi Hot lead).
  const created: any[] = [];
  if (existing.has("Lead ID")) {
    // Chế độ NHANH chỉ xét tập `targets` (khách vừa đổi); ĐỐI SOÁT xét tất cả.
    const pool: any[] = FULL ? (customers as any[]) : targets;
    const nphOf = (c: any) => normPh(c.phone) || phoneFromName(c.name);
    const gmailOf = (c: any) => { const e = String(c.email ?? "").toLowerCase().trim(); return e.endsWith("@gmail.com") ? e : ""; };
    const seenPh = new Map<string, number>(), seenEm = new Map<string, number>();
    let skipComment = 0, skipSpam = 0, skipNoChat = 0, skipOld = 0, mergedInBatch = 0;
    for (const c of pool) {
      const namePh = phoneFromName(c.name);
      const hit = byPid.get(stripSmaxId(c.pid)) || byPid.get(String(c.id ?? ""))
        || (c.phone && byPhone.get(normPh(c.phone))) || (namePh && byPhone.get(namePh))
        || (c.email && byEmail.get(String(c.email).toLowerCase().trim()));
      if (hit) continue;
      const tagNames = (c.tags || []).map((t: any) => String(t.name || t.alias || "").toLowerCase());
      if (tagNames.some((t: string) => t === "spam" || t.includes("block"))) { skipSpam++; continue; }
      if (String(c.platform || "") === "facebook" && !c.facebook?.conversation_id) { skipComment++; continue; }
      // CHƯA TỪNG NHẮN TIN ⇒ không phải lead (1.613 hồ sơ rỗng kiểu này).
      // Phải xét last_message_at: created_at LÚC NÀO CŨNG CÓ (chỉ là lúc SMAX
      // tạo hồ sơ) nên dùng nó để lọc thì không loại được ai.
      if (!c.last_message_at && !c.interaction?.first) { skipNoChat++; continue; }
      const first = c.interaction?.first ?? c.created_at;
      if (!first) { skipNoChat++; continue; }
      // CHỈ TẠO KHÁCH CÒN MỚI. Hai lý do:
      //  1) Dashboard chỉ đọc ~40 ngày gần nhất ⇒ tạo dòng 2024-2025 là vô ích.
      //  2) Bảng Lark đang 19.284 dòng, TRẦN FREE TIER LÀ 20.000 — thả hết
      //     1.679 ca tồn đọng vào là vỡ bảng (đo lúc chạy thử 2026-08-17).
      const actMs = Math.max(
        c.last_message_at ? new Date(c.last_message_at).getTime() : 0,
        new Date(first).getTime(),
      );
      if (actMs < Date.now() - CREATE_MAX_AGE_DAYS * 86400_000) { skipOld++; continue; }
      // Gộp trong lô: cùng SĐT hoặc cùng gmail ⇒ cùng người, chỉ giữ dòng đầu.
      // Chú ý dùng ba-ngôi chứ KHÔNG dùng `ph && ...` — chuỗi rỗng không phải
      // null nên `??` không bắt, khiến MỌI khách không có SĐT bị coi là trùng
      // và loại sạch (bug bắt được lúc chạy thử: 1.458 ca bị loại oan).
      const ph = nphOf(c), gm = gmailOf(c);
      const dupIdx = (ph ? seenPh.get(ph) : undefined) ?? (gm ? seenEm.get(gm) : undefined);
      if (dupIdx != null) { mergedInBatch++; continue; }

      const exactMs = new Date(first).getTime();
      const midMs = vnMidnightMs(first);
      const act = classifyLast(c);
      const fields: Record<string, unknown> = { "Lead ID": crypto.randomUUID() };
      const put = (k: string, v: unknown) => { if (existing.has(k) && v != null && v !== "") fields[k] = v; };
      put("ID", stripSmaxId(c.pid) || String(c.id ?? ""));
      put("Lead Name", String(c.name ?? "").trim());
      put("Email", String(c.email ?? "").toLowerCase().trim());
      put("Phone", c.phone ? String(c.phone).trim() : "");
      put(COL, midMs); put(BC, midMs); put(NC, midMs + 86400000); put(EXACT, exactMs);
      if (act.timeMs != null) { put("Time", act.timeMs); put("Event", act.event); }
      if (existing.has("Chưa phản hồi")) fields["Chưa phản hồi"] = act.chuaPhanHoi;
      const tagList = (c.tags || []).map((t: any) => String(t.name || t.alias || "").trim()).filter(Boolean);
      if (existing.has("Tag SMAX") && tagList.length) fields["Tag SMAX"] = tagList;
      for (const tg of (c.tags || [])) {
        const nm = trackName(String(tg.name || tg.alias || "").trim()); if (!nm) continue;
        const tms = tg.time ? new Date(tg.time).getTime() : 0; if (!tms) continue;
        put(`${nm} lúc`, tms);
      }
      if (existing.has(CHK)) fields[CHK] = Date.now();
      created.push({ fields });
      if (ph) seenPh.set(ph, created.length); if (gm) seenEm.set(gm, created.length);
    }
    console.log(`[bridge] tạo mới: ${created.length} dòng | bỏ qua — comment chưa inbox=${skipComment} spam/block=${skipSpam} chưa từng chat=${skipNoChat} quá cũ(>${CREATE_MAX_AGE_DAYS}d)=${skipOld} gộp trùng trong lô=${mergedInBatch}`);
    if (DRYRUN) {
      console.log(`[bridge] [CHẠY THỬ] KHÔNG ghi. 10 dòng đầu sẽ tạo:`);
      for (const c of created.slice(0, 10)) console.log(`   ${JSON.stringify({ ten: c.fields["Lead Name"], id: c.fields["ID"], sdt: c.fields["Phone"], mail: c.fields["Email"], tag: c.fields["Tag SMAX"] })}`);
      return;
    }
    for (let i = 0; i < created.length; i += 400) {
      const rr = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/records/batch_create`, {
        method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
        body: JSON.stringify({ records: created.slice(i, i + 400) }),
      }).then(r => r.json());
      if (rr.code !== 0) console.log(`[bridge] batch_create lỗi: ${rr.code} ${rr.msg}`);
    }
    if (created.length) console.log(`[bridge] ✅ ĐÃ TẠO ${created.length} dòng mới`);
  }

  if (!matched && !created.length) { console.log("[bridge] không có gì để ghi — xong."); return; }

  // ── 4) So lệch & ghi ngược lên Lark (chỉ đụng dòng thật sự đổi).
  const runMs = Date.now();
  const upd: any[] = [];
  for (const { rid, f } of rows) {
    const patch: Record<string, unknown> = {};
    const want = firstMs.get(rid);
    if (want != null) {
      if (existing.has(COL) && want !== (typeof f[COL] === "number" ? f[COL] : null)) patch[COL] = want;
      if (existing.has(BC) && want !== (typeof f[BC] === "number" ? f[BC] : null)) patch[BC] = want;
      const nc = want + 86400000;
      if (existing.has(NC) && nc !== (typeof f[NC] === "number" ? f[NC] : null)) patch[NC] = nc;
    }
    const wantExact = firstExact.get(rid);
    if (wantExact != null && existing.has(EXACT) && wantExact !== (typeof f[EXACT] === "number" ? f[EXACT] : null)) patch[EXACT] = wantExact;
    const act = lastAct.get(rid);
    if (act) {
      if (existing.has("Time") && act.timeMs !== (typeof f["Time"] === "number" ? f["Time"] : null)) patch["Time"] = act.timeMs;
      if (existing.has("Event") && act.event !== txt(f["Event"]).trim()) patch["Event"] = act.event;
      if (existing.has("Chưa phản hồi") && act.chuaPhanHoi !== (f["Chưa phản hồi"] === true)) patch["Chưa phản hồi"] = act.chuaPhanHoi;
    }
    // ĐIỀN LIÊN HỆ — chỉ khi ô Lark đang TRỐNG, không đè giá trị sẵn có.
    const wp = fillPhone.get(rid);
    if (wp && existing.has("Phone") && !txt(f["Phone"]).trim()) patch["Phone"] = wp;
    const we = fillEmail.get(rid);
    if (we && existing.has("Email") && !txt(f["Email"]).trim()) patch["Email"] = we;
    // ── MIRROR TAG (chuyển từ lead-first-chat.ts sang, 2026-08-18).
    // Bỏ bước này là tag trên Lark kẹt ở giá trị cũ mãi: ca "Mận Bùi" SMAX đã
    // đổi Cold→Hot mà Lark vẫn hiện Cold Lead.
    // Quy tắc GIỮ NGUYÊN như bản gốc (đã trả giá 2026-08-06 khi mirror toàn bộ
    // làm mất tag, Hot 2004→1148, phải revert):
    //   - tag PHÂN LOẠI (hot/cold/warm/prospect): customer là nguồn chuẩn →
    //     THAY THẾ. Chỉ thay khi customer thực sự có tag phân loại.
    //   - tag khác (khoá, SF_Done, Bot…): chỉ UNION thêm, KHÔNG BAO GIỜ xoá.
    const ts = tagsNow.get(rid);
    if (ts && existing.has("Tag SMAX")) {
      const cur = lstOf(f["Tag SMAX"]);
      const isCls = (t: string) => CLASS_KEYS.has(norm2(t));
      const custArr = [...ts];
      const custCls = custArr.filter(isCls);
      const newCls = custCls.length ? custCls : cur.filter(isCls);
      const merged = [...new Set([...newCls, ...cur.filter(t => !isCls(t)), ...custArr.filter(t => !isCls(t))])];
      if (merged.slice().sort().join("|") !== cur.slice().sort().join("|")) patch["Tag SMAX"] = merged;
    }
    const tt = tagTimes.get(rid) || {};
    for (const col of lucCols) {
      // CHỈ ĐIỀN/SỬA, TUYỆT ĐỐI KHÔNG XOÁ mốc cũ.
      // Đã thử xoá mốc của tag bị gỡ (2026-08-18) và SAI — user chốt lại:
      // "<class> lúc" là LỊCH SỬ, phải giữ. Lead từng Cold rồi lên Hot thì
      // dashboard PHẢI tính là NÂNG HẠNG, không phải "Hot mới trong ngày";
      // xoá "Cold Lead lúc" là mất căn cứ đó ⇒ thổi phồng số Hot mới.
      // Việc cập nhật trạng thái hiện tại đã do cột "Tag SMAX" lo (mirror ở
      // trên) — Lark vẫn hiện đúng Hot Lead, chỉ cách ĐẾM trên dashboard là
      // khác. Hai chuyện tách bạch, đừng gộp.
      const w = tt[col]; if (w == null) continue;
      if (w !== (typeof f[col] === "number" ? f[col] : null)) patch[col] = w;
    }
    if (!Object.keys(patch).length) continue;
    if (existing.has(CHK)) patch[CHK] = runMs;
    upd.push({ record_id: rid, fields: patch });
  }
  // Thống kê cột nào đang bị ghi — nếu lần nào cũng thấy cùng một cột với số
  // dòng y hệt thì nhiều khả năng là ghi lặp vô ích (so lệch sai kiểu dữ liệu),
  // chứ không phải khách thật sự vừa nhắn.
  const byField: Record<string, number> = {};
  for (const u of upd) for (const k of Object.keys(u.fields)) if (k !== CHK) byField[k] = (byField[k] || 0) + 1;
  const detail = Object.entries(byField).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(" · ");
  console.log(`[bridge] cần cập nhật: ${upd.length} dòng${detail ? ` (${detail})` : ""}`);
  let uw = 0;
  for (let i = 0; i < upd.length; i += 400) {
    const rr = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/records/batch_update`, { method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" }, body: JSON.stringify({ records: upd.slice(i, i + 400) }) }).then(r => r.json());
    if (rr.code === 0) uw += upd.slice(i, i + 400).length; else console.log(`[bridge] batch lỗi: ${rr.code} ${rr.msg}`);
  }
  console.log(`[bridge] ✅ ĐÃ ĐẨY: ${uw}/${upd.length} dòng lên Lark SMAX_Database`);
}

runSmaxLarkBridge().then(() => process.exit(0)).catch((e) => { console.error("[bridge] LỖI:", e.message); process.exit(1); });
