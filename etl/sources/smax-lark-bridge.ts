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
const FULL = process.env.BRIDGE_FULL === "1";
const LOOKBACK_MIN = Number(process.env.BRIDGE_LOOKBACK_MIN || 90);

const normPh = (p: unknown) => (p ? String(p).replace(/\D/g, "").replace(/^84/, "").replace(/^0/, "") : "");
const phoneFromName = (name: unknown) => { const m = String(name || "").match(/0\d{8,10}/); return m ? normPh(m[0]) : ""; };
// Cột "ID" trên Lark lưu pid ĐÃ BỎ tiền tố nền tảng (xem stripSmaxIdPrefix
// trong lark-push.ts) — phải bỏ y hệt thì mới khớp được.
const stripSmaxId = (p: unknown) => String(p ?? "").replace(/^(fb|zlw|zl|ig|ctm)/i, "");
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
  const valCols = [COL, BC, NC, EXACT, "Time", "Event", "Chưa phản hồi"].filter(n => existing.has(n));

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
    // Cửa sổ rộng hơn nhịp cron nhiều lần để lỡ vài lần chạy hỏng vẫn không sót;
    // phần sót hiếm (khớp bằng SĐT/email chứ không bằng pid) do lần ĐỐI SOÁT
    // theo giờ quét lại.
    const cutoff = Date.now() - LOOKBACK_MIN * 60_000;
    targets = (customers as any[]).filter(c => touchedMs(c) >= cutoff);
    const pids = [...new Set(targets.map(c => stripSmaxId(c.pid)).filter(Boolean))];
    for (let i = 0; i < pids.length; i += 50) {
      const batch = pids.slice(i, i + 50);
      const d = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/records/search?page_size=500`, {
        method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
        body: JSON.stringify({ field_names: readCols, filter: { conjunction: "or", conditions: batch.map(v => ({ field_name: "ID", operator: "is", value: [v] })) } }),
      }).then(r => r.json());
      if (d.code !== 0) throw new Error(`search Lark lỗi: ${d.code} ${d.msg}`);
      collect(d.data?.items || []);
    }
    console.log(`[bridge] [NHANH] khách đổi trong ${LOOKBACK_MIN}': ${targets.length}/${customers.length} → tra ${pids.length} pid (${Math.ceil(pids.length / 50)} lượt) → ${rows.length} dòng Lark`);
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
  if (!matched) { console.log("[bridge] 0 khách khớp — xong, không ghi gì."); return; }

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
    const tt = tagTimes.get(rid) || {};
    for (const col of lucCols) {
      const w = tt[col]; if (w == null) continue;   // KHÔNG xoá mốc cũ ở đây — việc
      // xoá (khi SMAX gỡ tag) là của lead-first-chat.ts, nó biết chắc đã quét đủ
      // customer của lead; bridge chỉ điền/sửa, tránh xoá oan.
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
