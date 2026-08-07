/**
 * Ghi "Ngày chat đầu" (interaction.first của SMAX) thành CỘT trên SMAX_Database.
 *
 * Đây là mốc ĐÚNG để quy 1 lead về 1 ngày trong pipeline sales:
 *   "Prospect ngày X" = Tag SMAX chứa Prospect  AND  Ngày chat đầu = X.
 * (Cột "…lúc" cũ lưu NGÀY GẮN TAG — sai concept: 36% prospect gắn tag lệch ngày
 *  so với ngày chat đầu, nên bị đếm nhầm sang hôm sau.)
 *
 * Chạy: npm run etl:lead:firstchat (cron mỗi ngày).
 */
import { admin } from "../lib/supabase-admin";

const T = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const BASE = process.env.SMAX_BASE_URL || "https://api.smax.ai";
const BIZ = "mastering-data-analytics";
const ID = process.env.LARK_APP_ID || "", SEC = process.env.LARK_APP_SECRET || "", APP = process.env.LARK_BASE_APP_TOKEN || "";
const U = "https://open.larksuite.com/open-apis";

const normPh = (p: any) => (p ? String(p).replace(/\D/g, "").replace(/^84/, "").replace(/^0/, "") : "");
// SĐT nằm trong TÊN khách (TVV gõ "Tên_0369…") — nhiều customer để trống field phone
// nên cần tách từ tên để khớp lead theo SĐT (nếu không → …lúc trống dù có tag).
const phoneFromName = (name: any) => { const m = String(name || "").match(/0\d{8,10}/); return m ? normPh(m[0]) : ""; };
// pid → "ID" hiển thị (bỏ prefix nền tảng, giống lark-push): fb…/zlw…/zl…/ig…/ctm…
const stripSmaxId = (p: string) => String(p).replace(/^(fb|zlw|zl|ig|ctm)/i, "");
function txt(v: unknown): string { return Array.isArray(v) ? (v as { text?: string }[]).map(x => x?.text ?? "").join("") : (v == null ? "" : String(v)); }
// mốc 00:00 giờ VN của ngày chứa timestamp — để cột date hiển thị đúng NGÀY (VN)
function vnMidnightMs(iso: string): number {
  const d = new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  return new Date(d + "T00:00:00Z").getTime() - 7 * 3600 * 1000;
}
async function larkToken() { const r = await fetch(`${U}/auth/v3/tenant_access_token/internal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: ID, app_secret: SEC }) }).then(r => r.json()); return r.tenant_access_token; }

// Tag-time ("…lúc"): THỜI ĐIỂM GẮN tag (tags[].time). Đây là thông tin bổ sung
// (khi nào lead lên Hot/Cold/khóa nào), KHÁC "Ngày chat đầu" (dùng để quy ngày
// báo cáo). Ví dụ Minh Huân: "Hot Lead lúc" = lúc gắn tag Hot.
const CLASS: Record<string, string> = { coldlead: "Cold Lead", hotlead: "Hot Lead", warmlead: "Warm Lead", prospect: "Prospect" };
const norm2 = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
function trackName(name: string): string | null {
  const n = norm2(name);
  if (CLASS[n]) return CLASS[n];
  const m = name.trim().match(/^(kh?\d{2,3}|f\d(\.\d)?)$/i); // K##, KH##, F#
  if (m) return name.trim().toUpperCase();
  return null;
}
// page (platform + tên page SMAX) → nhãn channel "Facebook MDA" / "Zalo PTA"...
function channelLabel(platform: string, pageName: string): string {
  const brand = /phuong thao|pta/i.test(pageName || "") ? "PTA" : "MDA";
  const p = (platform || "").toLowerCase();
  if (/zalo/.test(p) && p !== "zalo") return "Zalo 48"; // zaloweb — Zalo cá nhân/Salework 48 (pid "zlw…"), tên theo team sales
  const plat = p === "facebook" ? "Facebook" : /insta/.test(p) ? "Instagram"
    : p === "zalo" ? "Zalo OA"        // Official Account (pid "zl…")
    : p === "custom" ? "Website" : (platform || "Khác");
  return `${plat} ${brand}`;
}

export async function runLeadFirstChat() {
  if (!T || !APP) { console.log("[first-chat] thiếu creds, bỏ qua"); return; }

  // 1) lead lookup (giống tag-sync)
  const byCust = new Map<string, string>(), byPid = new Map<string, string>(), byPhone = new Map<string, string>(), byEmail = new Map<string, string>();
  const curPhone = new Map<string, string | null>(), curEmail = new Map<string, string | null>(); // contact hiện có của lead
  const tagsByLead = new Map<string, string[]>(); // lead → smax_tags (mirror lên "Tag SMAX")
  const leadToPid = new Map<string, string>();    // lead → external_profile_id (mirror lên "ID")
  const leadToCid = new Map<string, string>();    // lead → smax_customer_id (fallback "ID" khi không có pid)
  let from = 0;
  while (from < 60000) {
    const { data } = await admin.from("dim_lead").select("lead_id, phone, email, external_profile_id, smax_customer_id, full_name, smax_tags").range(from, from + 999);
    if (!data?.length) break;
    for (const l of data) { if (l.smax_customer_id) byCust.set(l.smax_customer_id, l.lead_id); if (l.external_profile_id) byPid.set(l.external_profile_id, l.lead_id); if (l.phone) byPhone.set(normPh(l.phone), l.lead_id); const np2 = phoneFromName(l.full_name); if (np2 && !byPhone.has(np2)) byPhone.set(np2, l.lead_id); if (l.email) byEmail.set(String(l.email).toLowerCase().trim(), l.lead_id); if (Array.isArray(l.smax_tags)) tagsByLead.set(l.lead_id, l.smax_tags); if (l.external_profile_id) leadToPid.set(l.lead_id, l.external_profile_id); if (l.smax_customer_id) leadToCid.set(l.lead_id, l.smax_customer_id); curPhone.set(l.lead_id, l.phone); curEmail.set(l.lead_id, l.email); }
    if (data.length < 1000) break; from += 1000;
  }

  // 2) SMAX customers → interaction.first per lead (giữ mốc SỚM nhất nếu trùng lead)
  const cRes = await fetch(`${BASE}/bizs/${BIZ}/customers`, { method: "POST", headers: { Authorization: `Bearer ${T}`, "Content-Type": "application/json" }, body: JSON.stringify({ size: 10000 }) }).then(r => r.json());
  const customers = cRes.data || [];

  // page_pid → nhãn channel (từ /pages của SMAX)
  const pageLabel = new Map<string, string>();
  try {
    const pg = await fetch(`${BASE}/bizs/${BIZ}/pages`, { headers: { Authorization: `Bearer ${T}` } }).then(r => r.json());
    for (const p of (pg.data ?? pg.pages ?? [])) { const pid = p.pid || p.page_pid || p.id; if (pid) pageLabel.set(pid, channelLabel(p.platform, p.name || p.page_name || "")); }
  } catch { /* fallback: suy từ platform của customer */ }

  const firstMs = new Map<string, number>();
  const tagTimes = new Map<string, Record<string, number>>(); // lead → {"Hot Lead lúc": ms}
  const lucSet = new Set<string>();
  const chans = new Map<string, Set<string>>(); // lead → {"Facebook MDA", "Zalo MDA"...}
  // Tự backfill pid: lead nhận diện bằng email/SĐT (không kèm pid) → match về SMAX
  // customer để lấy pid → cột "ID" luôn có. Chạy mỗi giờ nên KHÔNG bị lại thủ công.
  const ownedPids = new Set<string>(leadToPid.values());
  const pidBackfill = new Map<string, { pid: string; cid: string }>();
  // TAG RECONCILE (fix điểm mù "Lan Anh"): tag gắn SAU khi hết phiên chat (không tin
  // nhắn mới, interaction không đổi) → smax-real incremental không quét lại → tag kẹt.
  // Ở đây quét TOÀN BỘ top-10k customer mỗi giờ và reconcile AN TOÀN:
  //   - class (Hot/Cold/Warm/Prospect): customer là nguồn chuẩn → THAY thế class cũ
  //     khi customer có class (sửa cả stale cold→hot); customer không có class → giữ.
  //   - tag khác (khóa, SF_Done, info…): chỉ UNION thêm, KHÔNG BAO GIỜ xóa/reset rỗng
  //     (tránh regression mất tag như lần mirror-toàn-bộ 2026-08-06 phải revert).
  const CLASS_KEYS = new Set(["hotlead", "coldlead", "warmlead", "prospect"]);
  const normTag = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
  const keepTag = (name: string): boolean => {
    const n = name.toLowerCase().trim();
    if (/test/.test(n)) return false;
    if (/^(cold|hot|warm)\s*lead$/.test(n) || n === "prospect") return true;
    if (/^(kh?\d{2,3}|f\d(\.\d)?)$/.test(n)) return true;
    if (/info|infor/.test(n)) return true;
    if (/sf[_\s-]?done|lead sf|opp|unqualified|reactive/.test(n)) return true;
    if (/^(bi|fa)\s*student$/.test(n)) return true;
    if (n === "spam" || /block/.test(n)) return true; // rác — hiện để biết vì sao không đếm
    return false;
  };
  const custKeepByLead = new Map<string, Set<string>>();
  const contactFill = new Map<string, { phone?: string; email?: string }>(); // lead → contact cần điền
  // RULE SALES (2026-08-07): người mới chỉ COMMENT dưới bài/ads mà CHƯA gắn tag thì
  // KHÔNG tính là lead (đa số comment không liên quan khoá học). Nhưng comment ĐÃ
  // GẮN TAG thì VẪN TÍNH (sales đã xác nhận là quan tâm). Dấu hiệu comment-only:
  // FB customer không có facebook.conversation_id (chưa từng có hội thoại Messenger).
  // Đã kiểm định: 979/4896 FB customer không có conversation_id, tất cả đều chưa tag.
  // Non-FB (Zalo/Web/IG) luôn là inbox. Việc LỌC nằm ở nơi đếm (daily-report, /api/radar).
  const hasInbox = new Map<string, boolean>(); // lead → có ít nhất 1 kênh inbox thật
  for (const c of customers) {
    const namePh = phoneFromName(c.name);
    const lead = (c.id && byCust.get(c.id)) || (c.pid && byPid.get(c.pid)) || (c.phone && byPhone.get(normPh(c.phone))) || (namePh && byPhone.get(namePh)) || (c.email && byEmail.get(String(c.email).toLowerCase().trim()));
    if (!lead) continue;
    // lead chưa có pid + customer có pid chưa ai giữ → gán (fill "ID")
    if (!leadToPid.has(lead) && c.pid && !ownedPids.has(c.pid)) { pidBackfill.set(lead, { pid: c.pid, cid: c.id }); ownedPids.add(c.pid); leadToPid.set(lead, c.pid); }
    // CONTACT FILL (ca Lê Ngọc Giàu 2026-08-06): SMAX customer có phone/email mà lead
    // đang TRỐNG → tự điền mỗi giờ. Guard: giá trị đã thuộc lead KHÁC thì bỏ (không gộp nhầm).
    const cph = c.phone ? String(c.phone).trim() : "";
    if (cph && !curPhone.get(lead)) { const o = byPhone.get(normPh(cph)); if (!o || o === lead) { curPhone.set(lead, cph.startsWith("0") ? cph : "0" + normPh(cph)); byPhone.set(normPh(cph), lead); contactFill.set(lead, { ...(contactFill.get(lead) || {}), phone: curPhone.get(lead)! }); } }
    const cem = c.email ? String(c.email).toLowerCase().trim() : "";
    if (cem && !curEmail.get(lead)) { const o = byEmail.get(cem); if (!o || o === lead) { curEmail.set(lead, cem); byEmail.set(cem, lead); contactFill.set(lead, { ...(contactFill.get(lead) || {}), email: cem }); } }
    // inbox hay chỉ-comment (xem RULE ở trên)
    const isFb = String(c.platform || "") === "facebook";
    if (!isFb || c.facebook?.conversation_id) hasInbox.set(lead, true);
    else if (!hasInbox.has(lead)) hasInbox.set(lead, false);
    // communication channel của customer này (lead gộp → union nhiều channel)
    const ch = pageLabel.get(c.page_pid) || (c.platform ? channelLabel(c.platform, "") : "");
    if (ch) { const s = chans.get(lead) || new Set<string>(); s.add(ch); chans.set(lead, s); }
    // interaction.first = tin ĐẦU của khách. Khi mình nhắn trước / khách chỉ
    // comment (interaction undefined) → fallback created_at (mốc tạo record ≈
    // lần liên hệ đầu). Đảm bảo lead kiểu Bùi Huế (staff nhắn trước) vẫn được
    // quy về đúng ngày — "mình chat trước hay khách chat trước đều tính".
    const first = c.interaction?.first ?? c.created_at;
    if (first) { const ms = vnMidnightMs(first); const prev = firstMs.get(lead); if (prev == null || ms < prev) firstMs.set(lead, ms); }
    // tag-time ("…lúc") — giữ mốc MỚI nhất nếu 1 tag gắn nhiều lần
    for (const tg of (c.tags || [])) {
      const nmRaw = String(tg.name || tg.alias || "").trim();
      if (nmRaw && keepTag(nmRaw)) { const s = custKeepByLead.get(lead) || new Set<string>(); s.add(nmRaw); custKeepByLead.set(lead, s); }
      const nm = trackName(nmRaw); if (!nm) continue;
      const tms = tg.time ? new Date(tg.time).getTime() : 0; if (!tms) continue;
      const col = `${nm} lúc`; lucSet.add(col);
      const m = tagTimes.get(lead) || {}; if (!m[col] || tms > m[col]) m[col] = tms; tagTimes.set(lead, m);
    }
  }
  // reconcile tag vào dim_lead (class thay thế theo customer, còn lại union-only)
  let tagFixed = 0;
  for (const [lead, ks] of custKeepByLead) {
    const cur = tagsByLead.get(lead) ?? [];
    const custArr = [...ks];
    const custClass = custArr.filter(t => CLASS_KEYS.has(normTag(t)));
    const curClass = cur.filter(t => CLASS_KEYS.has(normTag(t)));
    const newClass = custClass.length ? custClass : curClass;
    const nonClass = new Set<string>([...cur.filter(t => !CLASS_KEYS.has(normTag(t))), ...custArr.filter(t => !CLASS_KEYS.has(normTag(t)))]);
    const merged = [...new Set<string>([...newClass, ...nonClass])];
    if (merged.slice().sort().join("|") !== cur.slice().sort().join("|")) {
      const { error } = await admin.from("dim_lead").update({ smax_tags: merged }).eq("lead_id", lead);
      if (!error) { tagsByLead.set(lead, merged); tagFixed++; }
    }
  }
  if (tagFixed) console.log(`[first-chat] tag reconcile từ customers: ${tagFixed} lead cập nhật`);
  // Lead chưa từng inbox → gắn nhãn kênh riêng để nơi đếm nhận diện (không tạo được
  // cột mới trên Lark nên đánh dấu ngay trong Communication Channels).
  const COMMENT_ONLY = "Comment (chưa inbox)";
  for (const [lead, ok] of hasInbox) if (!ok) chans.set(lead, new Set([COMMENT_ONLY]));

  // persist pid backfill vào dim_lead (để lark-push + lần sau dùng)
  let pidFilled = 0;
  for (const [lead, { pid, cid }] of pidBackfill) { const { error } = await admin.from("dim_lead").update({ external_profile_id: pid, smax_customer_id: cid }).eq("lead_id", lead); if (!error) pidFilled++; }
  // persist contact fill
  let contactFilled = 0;
  for (const [lead, cf] of contactFill) { const upd: Record<string, string> = {}; if (cf.phone) upd.phone = cf.phone; if (cf.email) upd.email = cf.email; const { error } = await admin.from("dim_lead").update(upd).eq("lead_id", lead); if (!error) contactFilled++; }
  if (contactFilled) console.log(`[first-chat] contact fill (phone/email từ SMAX): ${contactFilled} lead`);
  console.log(`[first-chat] SMAX customers=${customers.length} | lead có ngày chat đầu=${firstMs.size} | cột tag-time=${lucSet.size} | pid tự backfill=${pidFilled}`);

  // 2b) Hot Score per lead (gộp từ tag-sync cũ) — dùng cho view Hot Leads
  const { data: latest } = await admin.from("fact_lead_score").select("scored_at").order("scored_at", { ascending: false }).limit(1).maybeSingle();
  const scoreMap = new Map<string, number>();
  if (latest?.scored_at) { let sf = 0; while (sf < 50000) { const { data } = await admin.from("fact_lead_score").select("lead_id, hot_score").eq("scored_at", latest.scored_at).range(sf, sf + 999); if (!data?.length) break; for (const r of data) if (r.hot_score != null) scoreMap.set(r.lead_id, r.hot_score); if (data.length < 1000) break; sf += 1000; } }

  // 3) SMAX_Database table
  const tk = await larkToken();
  const tR = await fetch(`${U}/bitable/v1/apps/${APP}/tables?page_size=100`, { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
  const dbTbl = tR.data.items.find((t: any) => t.name === "SMAX_Database"); if (!dbTbl) { console.log("[first-chat] không thấy SMAX_Database"); return; }
  const dbId = dbTbl.table_id;

  // 4) đảm bảo cột "Ngày chat đầu" — ĐỌC HẾT field (phân trang) + GUARD:
  // nếu đọc field lỗi/rỗng thì DỪNG, KHÔNG tạo cột (tránh sinh cột trùng "(1)"
  // khi Lark hiccup — bảng luôn có sẵn field nên rỗng = lỗi, không phải bảng mới).
  let fpt: string | undefined; const fieldItems: any[] = [];
  while (true) {
    const fu = new URL(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/fields`); fu.searchParams.set("page_size", "100"); if (fpt) fu.searchParams.set("page_token", fpt);
    const fr = await fetch(fu.toString(), { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
    if (fr.code !== 0) { console.log(`[first-chat] đọc fields lỗi code=${fr.code} — DỪNG, không tạo cột (tránh trùng)`); return; }
    fieldItems.push(...(fr.data?.items || [])); if (!fr.data?.has_more) break; fpt = fr.data.page_token;
  }
  if (!fieldItems.length) { console.log("[first-chat] fields rỗng — DỪNG (tránh tạo cột trùng)"); return; }
  const fR = { data: { items: fieldItems } };
  const COL = "Ngày chat đầu";
  const existing = new Set(fieldItems.map((f: any) => f.field_name));
  if (!existing.has(COL)) {
    await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/fields`, { method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" }, body: JSON.stringify({ field_name: COL, type: 5, property: { date_formatter: "yyyy-MM-dd", auto_fill: false } }) });
    console.log(`[first-chat] đã tạo cột "${COL}"`);
  }
  if (!existing.has("Hot Score")) await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/fields`, { method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" }, body: JSON.stringify({ field_name: "Hot Score", type: 2, property: { formatter: "0" } }) });
  // "Lần cập nhật cuối" = lúc job này quét/refresh row (độ tươi dữ liệu — để soi
  // vì sao lead mới chưa có ngày). "Báo cáo ngày" = Ngày chat đầu (ngày lead thuộc
  // về). "Ngày check" = Báo cáo ngày + 1 (hôm sau — khớp 4.1/4.2 Check Lead).
  const CHK = "Lần cập nhật cuối", BC = "Báo cáo ngày", NC = "Ngày check";
  for (const [name, fmt] of [[CHK, "yyyy-MM-dd HH:mm"], [BC, "yyyy-MM-dd"], [NC, "yyyy-MM-dd"]] as const)
    if (!existing.has(name)) await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/fields`, { method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" }, body: JSON.stringify({ field_name: name, type: 5, property: { date_formatter: fmt, auto_fill: false } }) });
  // cột "…lúc" (datetime) — đảm bảo tồn tại cho mọi tag đang có
  for (const col of lucSet) if (!existing.has(col)) await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/fields`, { method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" }, body: JSON.stringify({ field_name: col, type: 5, property: { date_formatter: "yyyy-MM-dd HH:mm", auto_fill: false } }) });
  // fill mọi cột "…lúc" đang tồn tại trên base (kể cả tag hiếm không có trong batch)
  const lucCols = [...new Set<string>([...lucSet, ...(fR.data?.items || []).map((f: any) => f.field_name).filter((n: string) => / lúc$/.test(n))])];
  // "Communication Channels" (multi-select) — các kênh lead từng chat (gộp)
  const CHAN = "Communication Channels";
  if (!existing.has(CHAN)) await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/fields`, { method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" }, body: JSON.stringify({ field_name: CHAN, type: 4 }) });

  // 5) update ("Ngày chat đầu"/"Báo cáo ngày"/"Ngày check"/"Hot Score" khi lệch; "Lần cập nhật cuối" mọi row)
  const runMs = Date.now();
  const upd: any[] = []; let pt: string | undefined;
  while (true) {
    const url = new URL(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/records`); url.searchParams.set("page_size", "500");
    url.searchParams.set("field_names", JSON.stringify(["Lead ID", COL, "Hot Score", CHAN, "Tag SMAX", "ID", "Phone", "Email", ...lucCols]));
    if (pt) url.searchParams.set("page_token", pt);
    const d = await fetch(url.toString(), { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
    for (const r of d.data?.items || []) {
      const lid = txt(r.fields?.["Lead ID"]); if (!lid) continue;
      const patch: Record<string, unknown> = {};
      const want = firstMs.get(lid);
      if (want != null) {
        const cur = typeof r.fields?.[COL] === "number" ? r.fields[COL] : null; if (want !== cur) patch[COL] = want;
        const curBC = typeof r.fields?.[BC] === "number" ? r.fields[BC] : null; if (want !== curBC) patch[BC] = want;   // báo cáo ngày = ngày chat đầu
        const nc = want + 86400000; const curNC = typeof r.fields?.[NC] === "number" ? r.fields[NC] : null; if (nc !== curNC) patch[NC] = nc; // ngày check = +1 ngày
      }
      const ws = scoreMap.get(lid); const cs = typeof r.fields?.["Hot Score"] === "number" ? r.fields["Hot Score"] : (r.fields?.["Hot Score"] ? Number(r.fields["Hot Score"]) : null);
      if (ws != null && ws !== cs) patch["Hot Score"] = ws;
      // tag-time ("…lúc")
      const tt = tagTimes.get(lid) || {};
      for (const col of lucCols) { const w = tt[col]; if (w == null) continue; const curL = typeof r.fields?.[col] === "number" ? r.fields[col] : null; if (w !== curL) patch[col] = w; }
      // communication channels (multi-select) — chỉ update khi tập kênh thay đổi
      const cs2 = chans.get(lid); if (cs2 && cs2.size) { const want2 = [...cs2].sort(); const rawc = r.fields?.[CHAN]; const cur2 = (Array.isArray(rawc) ? rawc.map((x: any) => typeof x === "object" ? (x.text ?? x.name ?? "") : x) : []).sort(); if (want2.join("|") !== cur2.join("|")) patch[CHAN] = want2; }
      // Tag SMAX (multi-select) — mirror từ dim_lead.smax_tags (đảm bảo tag không kẹt
      // rỗng khi lark-push snapshot bỏ sót lead chat cũ). Chỉ đổi khi tập tag khác.
      const tg = tagsByLead.get(lid); if (tg) { const wantT = [...new Set(tg)].sort(); const rawt = r.fields?.["Tag SMAX"]; const curT = (Array.isArray(rawt) ? rawt.map((x: any) => typeof x === "object" ? (x.text ?? x.name ?? "") : x) : (rawt ? [rawt] : [])).sort(); if (wantT.join("|") !== curT.join("|")) patch["Tag SMAX"] = wantT; }
      // Phone/Email — điền khi ô Lark TRỐNG mà dim_lead có (không đè giá trị sẵn có)
      const ph2 = curPhone.get(lid); if (ph2 && !txt(r.fields?.["Phone"]).trim()) patch["Phone"] = ph2;
      const em2 = curEmail.get(lid); if (em2 && !txt(r.fields?.["Email"]).trim()) patch["Email"] = em2;
      // "ID" (SMAX id) — mirror từ external_profile_id (fallback smax_customer_id) để MỌI lead có ID
      const pid = leadToPid.get(lid); const cid2 = leadToCid.get(lid);
      const wantId = pid ? stripSmaxId(pid) : (cid2 || "");
      if (wantId) { const curId = txt(r.fields?.["ID"]).trim(); if (wantId !== curId && !curId) patch["ID"] = wantId; else if (pid && stripSmaxId(pid) !== curId) patch["ID"] = stripSmaxId(pid); }
      patch[CHK] = runMs; // dấu thời gian quét — luôn ghi để thấy row được refresh lúc nào
      upd.push({ record_id: r.record_id, fields: patch });
    }
    if (!d.data?.has_more) break; pt = d.data.page_token;
  }
  let uw = 0;
  for (let i = 0; i < upd.length; i += 400) { const rr = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/records/batch_update`, { method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" }, body: JSON.stringify({ records: upd.slice(i, i + 400) }) }).then(r => r.json()); if (rr.code === 0) uw += upd.slice(i, i + 400).length; else console.log(`[first-chat] batch lỗi: ${rr.code} ${rr.msg}`); }
  console.log(`[first-chat] SMAX_Database "${COL}" + Hot Score + ${lucCols.length} tag-time + Channels: cập nhật ${uw} dòng`);
}

runLeadFirstChat().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
