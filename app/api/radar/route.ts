/**
 * GET /api/radar — dữ liệu cho trang /radar.html (Sales Lead Radar).
 * Đọc Lark SMAX_Database bằng records/search có FILTER 40 ngày (Báo cáo ngày
 * hoặc Hot Lead lúc) → chỉ ~2-3 trang thay vì quét 9.7k dòng (tránh timeout
 * 10s của Vercel — nguyên nhân trang trắng 2026-08-07). Fallback quét đủ nếu
 * search lỗi. maxDuration 60s cho chắc.
 */
import { NextResponse } from "next/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const U = "https://open.larksuite.com/open-apis";
const FIELDS = ["Lead Name", "Báo cáo ngày", "Chat đầu lúc", "Hot Lead lúc", "Prospect lúc", "Cold Lead lúc", "Warm Lead lúc", "Tag SMAX", "Communication Channels", "Phone", "Email", "Chưa phản hồi"];
// Lead chỉ-comment (chưa inbox) được đánh dấu bằng option riêng trong
// "Communication Channels" — vì app Lark hiện KHÔNG tạo được cột mới (lỗi 9499).
const COMMENT_ONLY = "Comment (chưa inbox)";

type Cell = unknown;
type LarkRecord = { fields?: Record<string, Cell> };
const g = (v: Cell): string[] => Array.isArray(v) ? v.map((x) => (typeof x === "object" && x !== null ? ((x as { text?: string; name?: string }).text ?? (x as { name?: string }).name ?? "") : String(x))).filter(Boolean) : [];
const gs = (v: Cell): string => Array.isArray(v) ? (v as { text?: string }[]).map((x) => x?.text ?? "").join("") : (v == null ? "" : String(v));
const vnDate = (ms: Cell): string | null => typeof ms === "number" ? new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10) : null;
const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
// MÃ KHOÁ CHUẨN. "KH62" và "K62" là CÙNG MỘT KHOÁ, chỉ khác cách sales gõ tag
// (user chốt 2026-09-03: "KH và K như nhau, K62 và KH62 là 1"). Quy hết về K##
// ngay tại nguồn ⇒ bộ lọc KHOÁ chỉ hiện một mục, số cộng đủ, không phải nhớ
// chọn kèm mục KH.
const coCode = (s: string) => s.trim().toUpperCase().replace(/^KH(\d)/, "K$1");
// Khoá nhận diện người xuyên hệ thống: tên bên SMAX và SF thường khác nhau
// ("K40-Bảo Lee" ↔ "Lý Hồng Bảo") nên chỉ khớp bằng 9 số cuối của điện thoại
// và email viết thường.
const keysOf = (phone: string, email: string): string[] => {
  const out: string[] = [];
  const d = phone.replace(/\D/g, "");
  if (d.length >= 9) out.push("p:" + d.slice(-9));
  const m = email.toLowerCase().trim();
  if (m.includes("@")) out.push("e:" + m);
  return out;
};

// SĐT/EMAIL CỦA CHÍNH CÔNG TY — không được dùng làm khoá nhận diện người.
// SMAX/sales hay gõ hotline ngay trong đoạn chat rồi bị gán nhầm vào hồ sơ
// khách. Đo 2026-08-18 trên Salesforce: số 0961486648 đang nằm trên 2 lead của
// HAI người khác nhau ("Nhi Hoàng", "Nguyễn Trung Tấn") — gộp theo đó là dồn
// người lạ vào một, đúng ca "Sơn Huyền" cũ. Giữ đồng bộ với
// etl/lib/company-contacts.ts (đó là nguồn chuẩn cho các job ETL).
const COMPANY_PHONE_TAILS = new Set(["961486648"]);
const COMPANY_EMAIL_RE = /@mastering-da\.com$|^(sales|info|ketoan|admin|contact|hotro|support)@/i;
/** Khoá nhận diện đã LỌC BỎ liên hệ của công ty. */
const idKeysOf = (phone: string, email: string): string[] =>
  keysOf(phone, email).filter(k =>
    k.startsWith("p:") ? !COMPANY_PHONE_TAILS.has(k.slice(2))
      : !COMPANY_EMAIL_RE.test(k.slice(2)));

/**
 * MÃ KHOÁ ĐÚNG NHƯ SALESFORCE GHI — "KH62" KHÔNG gộp vào "K62".
 * Khác hẳn coCode() ở trên (dùng cho tag SMAX). Lý do: bộ lọc "Product (Lead)"
 * trên dashboard Salesforce chỉ có các mục "contains K59 / K60 / K61 / K62 /
 * F2 / F3 / F4" — KHÔNG hề có mục KH nào, nên "contains K62" không bắt được
 * "KH62 - 2026" và con số Sales đọc hằng ngày là 72 (user chốt 2026-09-11:
 * "k có KH62, 72 là đúng rồi"). Cột Hot bên mình mirror Salesforce 1:1 nên
 * phải gom y hệt: KH62 đứng riêng, không cộng vào K62.
 * ⚠ Trên các khoá cũ chênh này KHÔNG nhỏ — KH58 có 107 lead trong khi K58 có
 * 98; nếu sau này BU xác nhận KH## chính là K## thì đổi hàm này thành coCode().
 */
const sfCo = (s: string): string => {
  const m = String(s || "").trim().match(/^(KH?\d{2,3}|F\d(?:\.\d)?)\b/i);
  return m ? m[1].toUpperCase() : "";
};

type SfLead = {
  Id: string; Name: string | null; Phone: string | null; MobilePhone: string | null;
  Email: string | null; Rating: string | null; IsConverted: boolean; RelevantLeads__c: string | null;
  CreatedDate: string; Product__r: { Name: string | null } | null;
};

/**
 * KÉO THẲNG LEAD TỪ SALESFORCE (SOQL), không qua bản sao trên Lark.
 * Bản sao "Salesforce_Database" từng có 110 dòng lead_created cho khoá K62
 * trong khi Salesforce chỉ có 72 lead — nhân đôi do hai job ghi bằng hai khoá
 * chống trùng khác nhau, cộng thêm dòng đã đổi sản phẩm / đã xoá bên SF mà
 * Lark còn giữ. Khử kiểu gì cũng không về đúng được, nên bỏ hẳn.
 * Trả null nếu thiếu biến môi trường hoặc SF lỗi — khi đó dashboard vẫn chạy,
 * chỉ là cột Hot bằng 0 và `sfErr` nói rõ lý do (không im lặng ra số sai).
 */
/**
 * TRẦN CỬA SỔ LẤY LEAD SALESFORCE — 420 ngày.
 * Salesforce đang có 50.120 Lead từ 2023 (đo 2026-09-11). Kỳ "Tất cả" của
 * dashboard xin tới 3000 ngày; kéo hết chừng đó vừa nặng (~7 MB nhét thêm vào
 * /api/radar) vừa vô ích — dashboard đã chốt chỉ quan tâm từ K58 (mở
 * 10/01/2026, tức ~245 ngày) trở đi. 420 ngày phủ K58 còn dư nửa năm.
 */
const SF_MAX_DAYS = 420;

async function pullSf(sinceMs: number): Promise<{ rows: SfLead[] } | { err: string }> {
  const INST = process.env.SALESFORCE_INSTANCE_URL, CID = process.env.SALESFORCE_CLIENT_ID,
        CSEC = process.env.SALESFORCE_CLIENT_SECRET, V = process.env.SALESFORCE_API_VERSION || "v59.0";
  if (!INST || !CID || !CSEC) return { err: "thiếu biến môi trường Salesforce" };
  const tr = await fetch(`${INST}/services/oauth2/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: CID, client_secret: CSEC }),
    cache: "no-store",
  }).then(r => r.json()).catch(() => null);
  if (!tr?.access_token) return { err: "đăng nhập Salesforce thất bại" };
  const gioiHan = Date.now() - SF_MAX_DAYS * 86400_000;
  const from = new Date(Math.max(sinceMs, gioiHan)).toISOString().slice(0, 19) + "Z";
  // ORDER BY ... DESC: nếu có chạm trần phân trang thì phần bị cắt là lead CŨ
  // NHẤT, không phải lead mới. Lần đầu viết để ASC nên trần 20.000 cắt mất toàn
  // bộ lead gần đây — dashboard ra Hot = 0 cho K62 (bắt được 2026-09-11).
  const soql = `SELECT Id, Name, Phone, MobilePhone, Email, Rating, IsConverted, RelevantLeads__c, `
    + `CreatedDate, Product__r.Name FROM Lead WHERE CreatedDate >= ${from} ORDER BY CreatedDate DESC`;
  const rows: SfLead[] = [];
  let url: string | null = `${INST}/services/data/${V}/query?q=${encodeURIComponent(soql)}`;
  // SOQL trả tối đa 2000 bản ghi/lượt; nextRecordsUrl để lấy trang tiếp.
  // 15 trang = 30.000 lead, dư xa cho 420 ngày (đo được ~2.800).
  for (let i = 0; url && i < 15; i++) {
    const q: { records?: SfLead[]; nextRecordsUrl?: string } | { 0: { message: string } } | null =
      await fetch(url, { headers: { Authorization: `Bearer ${tr.access_token}` }, cache: "no-store" })
        .then(r => r.json()).catch(() => null);
    if (!q) return { err: "gọi SOQL thất bại" };
    const bad = (q as Record<number, { message?: string }>)[0];
    if (bad?.message) return { err: `SOQL: ${bad.message}` };
    const ok = q as { records?: SfLead[]; nextRecordsUrl?: string };
    rows.push(...(ok.records ?? []));
    url = ok.nextRecordsUrl ? `${INST}${ok.nextRecordsUrl}` : null;
  }
  return { rows };
}

function toLead(f: Record<string, Cell>, cutoff: string) {
  const tags = g(f["Tag SMAX"]);
  // RULE SALES: Spam / Đã Block là rác — KHÔNG phải lead.
  if (tags.some(t => norm(t) === "spam" || norm(t).includes("block"))) return null;
  // RULE SALES: comment CHƯA gắn tag → không tính là lead. Comment ĐÃ gắn tag → vẫn tính.
  if (!tags.length && g(f["Communication Channels"]).includes(COMMENT_ONLY)) return null;
  const bc = vnDate(f["Báo cáo ngày"]), ha = vnDate(f["Hot Lead lúc"]);
  if ((!bc || bc < cutoff) && (!ha || ha < cutoff)) return null;
  // Mốc GIỜ CHÍNH XÁC (epoch ms thật, KHÔNG dịch +7h như vnDate) — vnDate() bên
  // trên chỉ giữ được ngày, mất giờ. Cần cho báo cáo theo khung giờ (VD
  // "17:00 hôm qua → 10:30 hôm nay") không rơi khớp biên ngày lịch.
  // Ưu tiên "Chat đầu lúc" (giờ THẬT của tin đầu, do smax-lark-bridge ghi) rồi
  // mới tới "Báo cáo ngày". LÝ DO: "Báo cáo ngày" cố ý lưu 00:00 để gom theo
  // NGÀY — dùng nó cho bộ lọc khung giờ thì nửa đêm không bao giờ nằm trong
  // 10:30–17:00 ⇒ báo cáo Chiều luôn ra 0 (bug phát hiện 2026-08-17). Lead cũ
  // chưa có cột này vẫn rơi về mốc nửa đêm như trước, không hỏng view theo ngày.
  const bcMs = typeof f["Chat đầu lúc"] === "number" ? f["Chat đầu lúc"] as number
    : (typeof f["Báo cáo ngày"] === "number" ? f["Báo cáo ngày"] as number : null);
  // LUỒNG CHỊ LA (chốt 2026-08-10): ĐÃ gắn tag phân loại từ trước thì hôm nay
  // lên Hot chỉ là NÂNG HẠNG, không phải "Hot lead mới trong ngày". Mốc gắn tag
  // nằm ngay trên cùng dòng (SMAX gộp mọi tag của 1 khách vào 1 bản ghi) nên
  // không cần quét lịch sử — so ngày sớm nhất trong 3 cột dưới với ngày lên Hot.
  const priorCls = [vnDate(f["Prospect lúc"]), vnDate(f["Cold Lead lúc"]), vnDate(f["Warm Lead lúc"])]
    .filter((x): x is string => !!x).sort()[0] ?? null;
  const up = !!(ha && priorCls && priorCls < ha);
  // NGÀY GẮN TAG của từng phân loại. Trước đây chỉ Hot đếm theo mốc gắn tag còn
  // Cold/Warm/Prospect đếm theo NGÀY CHAT ĐẦU → hai thước đo khác nhau, số lệch
  // (10/08: Lark có 4 Cold theo mốc tag nhưng dashboard hiện khác). Giờ trả về
  // cả 4 mốc để đếm nhất quán. Chỉ tính khi tag đó CÒN trên lead.
  const cd: Record<string, string> = {};
  for (const [k, col, tag] of [["P", "Prospect lúc", "prospect"], ["C", "Cold Lead lúc", "coldlead"],
                               ["W", "Warm Lead lúc", "warmlead"], ["H", "Hot Lead lúc", "hotlead"]] as const) {
    if (!tags.some(t => norm(t) === tag)) continue;
    const dd = vnDate(f[col]); if (dd) cd[k] = dd;
  }
  return {
    // ha/haMs = MỐC HOT. Từ 2026-09-11 Hot lấy 100% từ Salesforce (user chốt:
    // "Hot lead luôn luôn lấy từ SF, SF chuẩn 100%, lấy số nó để dùng") nên
    // lead SMAX KHÔNG còn mang mốc Hot nữa — tag "Hot Lead" bên SMAX chỉ còn
    // giữ ở `hs` để HIỂN THỊ trong bảng chi tiết và để đo độ trễ nhập liệu
    // ("SMAX đã gắn Hot mà SF chưa có dòng"), tuyệt đối không vào phép đếm.
    n: gs(f["Lead Name"]) || "(?)", d: bc, ha: null as string | null, dMs: bcMs, haMs: null as number | null, hs: ha, cd, up, upFrom: up ? priorCls : "",
    cls: tags.map(t => ({ hotlead: "H", coldlead: "C", warmlead: "W", prospect: "P" } as Record<string, string>)[norm(t)]).filter(Boolean),
    bi: tags.some(t => /^kh?\d{2,3}$/i.test(t.trim())),
    fa: tags.some(t => /^f\d(\.\d)?$/i.test(t.trim())),
    // Tag KHOÁ để lọc trên dashboard (K61, KH61, F3…). Viết hoa cho đồng nhất
    // vì Sales gõ lẫn lộn "k61"/"K61". 1 lead có thể mang nhiều khoá.
    co: [...new Set(tags.filter(t => /^(kh?\d{2,3}|f\d(\.\d)?)$/i.test(t.trim())).map(t => coCode(t)))],
    ch: g(f["Communication Channels"]), ph: gs(f["Phone"]),
    cph: f["Chưa phản hồi"] === true,
    ky: keysOf(gs(f["Phone"]), gs(f["Email"])), re: "",
  };
}

type Lead = { n: string; n2?: string; d: string | null; ha: string | null; hs?: string | null; sfR?: string; sfConv?: boolean; dMs: number | null; haMs: number | null; cd: Record<string, string>; up: boolean; upFrom: string; cls: string[]; bi: boolean; fa: boolean; co: string[]; ch: string[]; ph: string; cph: boolean; ky: string[]; re: string; sf?: boolean };

export async function GET(req: Request) {
  // Cửa sổ dữ liệu tính bằng ngày. Mặc định 40 cho nhanh (~2,6s); dashboard tự
  // gọi lại với số lớn hơn khi người dùng chọn kỳ dài — khoá như K61 chạy 3
  // tháng nên 40 ngày là không đủ. Đo 2026-08-10: 180 ngày ~8,9s · toàn bộ
  // (3000) ~18,9s, vẫn dưới maxDuration 60s.
  const qs = new URL(req.url).searchParams.get("days");
  const days = Math.min(Math.max(Number(qs) || 40, 1), 3000);
  const ID = process.env.LARK_APP_ID, SEC = process.env.LARK_APP_SECRET, APP = process.env.LARK_BASE_APP_TOKEN;
  if (!ID || !SEC || !APP) return NextResponse.json({ error: "missing lark env" }, { status: 500 });

  const auth = await fetch(`${U}/auth/v3/tenant_access_token/internal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: ID, app_secret: SEC }), cache: "no-store" }).then(r => r.json());
  const tk = auth.tenant_access_token;
  if (!tk) return NextResponse.json({ error: "lark auth failed" }, { status: 502 });
  const H = { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" };

  const tR = await fetch(`${U}/bitable/v1/apps/${APP}/tables?page_size=100`, { headers: H, cache: "no-store" }).then(r => r.json());
  const db = tR.data?.items?.find((t: { name: string; table_id: string }) => t.name === "SMAX_Database")?.table_id;
  if (!db) return NextResponse.json({ error: "SMAX_Database not found" }, { status: 502 });

  const cutoffMs = Date.now() - days * 86400_000;
  const cutoff = new Date(cutoffMs + 7 * 3600_000).toISOString().slice(0, 10);
  const leads: Lead[] = [];
  // key → nhãn khoá cũ ("K45 - 2024"). Đọc từ cột "Lead cũ (SF)" = RelevantLeads__c.
  const remkt = new Map<string, string>();
  // key → mã khoá bên SF ("K61"), để bù cho lead mà SMAX ghi khoá khác.
  const sfCourse = new Map<string, Set<string>>();

  // Nhanh: search có filter (bc > cutoff OR hot-lúc > cutoff)
  let searched = false;
  try {
    // Trần trang phải dư: kỳ "Tất cả" cần ~20 trang, chạm trần thì `searched`
    // vẫn false và rơi xuống nhánh fallback quét lại từ đầu (chậm gấp đôi).
    let pt: string | undefined; let pages = 0;
    while (pages < 60) {
      const url = new URL(`${U}/bitable/v1/apps/${APP}/tables/${db}/records/search`);
      url.searchParams.set("page_size", "500"); if (pt) url.searchParams.set("page_token", pt);
      const d = await fetch(url.toString(), {
        method: "POST", headers: H, cache: "no-store",
        body: JSON.stringify({
          field_names: FIELDS,
          filter: { conjunction: "or", conditions: [
            { field_name: "Báo cáo ngày", operator: "isGreater", value: ["ExactDate", String(cutoffMs)] },
            { field_name: "Hot Lead lúc", operator: "isGreater", value: ["ExactDate", String(cutoffMs)] },
          ] },
        }),
      }).then(r => r.json());
      if (d.code !== 0) throw new Error(`search ${d.code} ${d.msg}`);
      for (const r of (d.data?.items ?? []) as LarkRecord[]) { const l = toLead(r.fields ?? {}, cutoff); if (l) leads.push(l); }
      pages++;
      if (!d.data?.has_more) { searched = true; break; }
      pt = d.data.page_token;
    }
  } catch { /* fallback dưới */ }

  if (!searched) {
    // Fallback: quét đủ (chậm hơn nhưng maxDuration 60s chịu được)
    leads.length = 0;
    let pt: string | undefined;
    while (true) {
      const url = new URL(`${U}/bitable/v1/apps/${APP}/tables/${db}/records`);
      url.searchParams.set("page_size", "500");
      url.searchParams.set("field_names", JSON.stringify(FIELDS));
      if (pt) url.searchParams.set("page_token", pt);
      const d = await fetch(url.toString(), { headers: H, cache: "no-store" }).then(r => r.json());
      if (d.code !== 0) return NextResponse.json({ error: `lark read ${d.code}` }, { status: 502 });
      for (const r of (d.data?.items ?? []) as LarkRecord[]) { const l = toLead(r.fields ?? {}, cutoff); if (l) leads.push(l); }
      if (!d.data?.has_more) break; pt = d.data.page_token;
    }
  }

  // ── HOT từ SALESFORCE (quy tắc Sales 2026-08-10) ────────────────────────────
  // Hot ngày X = Hot của SMAX + lead SF chỉ-có-trên-SF. Dòng SF có "Tag SMAX"
  // CÓ dữ liệu ⇒ SMAX đã đếm rồi ⇒ bỏ qua (chống đếm đôi). Quy ngày theo Time
  // của lead_created = CreatedDate của Lead gốc (đã sửa 2026-08-10).
  // (Trước 2026-09-11 chỗ này quét bảng Lark "Salesforce_Database" tới 30
  //  trang chỉ để lấy hai thứ: nhãn khách-quay-lại và mã khoá bên SF. Nay cả
  //  hai lấy luôn từ chính lượt SOQL bên dưới — bớt ~30 lượt gọi Lark, và
  //  không còn phụ thuộc bản sao vốn có dòng trùng / dòng chết.)

  // ── HOT = LEAD TRÊN SALESFORCE, MIRROR 1:1 ────────────────────────────────
  // User chốt 2026-09-11: "Hot lead luôn luôn lấy từ SF, SF chuẩn 100%, lấy số
  // nó để dùng" — và trước đó "đúng sai gì kệ, sai thì trên SF fix, dưới này
  // chỉnh theo". Nên khối này CỐ Ý KHÔNG lọc và KHÔNG gộp gì cả:
  //   · không lọc Rating — Sales coi khách để lại contact là đã ghi nhận, Cold
  //     hay Hot đếm như nhau (user xác nhận với đội sales 2026-09-10);
  //   · không bỏ lead đã convert — dashboard SF đếm cả 15 lead đã chốt của K62
  //     trong con số 72 (ô "No. of Leads" 72 vs "Not yet Convert" 57);
  //   · không gộp lead trùng người — SF đếm theo BẢN GHI. Trùng thì sửa bên SF.
  //   · không loại khách quay lại (reMKT) — vẫn dán nhãn để sales nhìn thấy,
  //     nhưng vẫn cộng, vì bên SF họ cũng được đếm.
  // Mỗi Lead bên SF = một dòng ở đây ⇒ đếm ra đúng con số trên dashboard SF.
  const sf = await pullSf(cutoffMs);
  let sfHot = 0;
  const sfErr = "err" in sf ? sf.err : "";
  if ("rows" in sf) {
    for (const r of sf.rows) {
      const ms = Date.parse(r.CreatedDate);
      if (!Number.isFinite(ms)) continue;
      // Múi giờ org Salesforce là Asia/Ho_Chi_Minh (UTC+7, đã kiểm 2026-09-11)
      // ⇒ cộng 7h rồi cắt ngày cho ra ĐÚNG cột ngày mà report bên SF hiển thị.
      const ha = vnDate(ms); if (!ha || ha < cutoff) continue;
      const code = sfCo(r.Product__r?.Name ?? "");
      const phone = gs(r.Phone) || gs(r.MobilePhone);
      const keys = idKeysOf(phone, gs(r.Email));
      // KHÁCH QUAY LẠI: RelevantLeads__c liệt kê lead/khoá trước của chính người
      // này (VD chị Thu Hà → "K45 - 2024"). Dashboard hiện nhãn để sales biết
      // đây là re-marketing; riêng "Lead mới" của MKT thì không đếm.
      const prior = gs(r.RelevantLeads__c).trim();
      if (prior) for (const k of keys) if (!remkt.has(k)) remkt.set(k, prior);
      // KHOÁ BÊN SF: SMAX và SF hay ghi khác khoá cho cùng một người (ca
      // "H Xuan": SMAX ghi K60, SF ghi K61). Gom lại để lead SMAX lọc được theo
      // khoá của cả hai hệ. Ở đây gộp KH→K vì bên nhận là tag SMAX.
      if (code) for (const k of keys) {
        const cur = sfCourse.get(k) ?? new Set<string>();
        cur.add(coCode(code)); sfCourse.set(k, cur);
      }
      leads.push({
        n: gs(r.Name) || "(?)", d: null, ha, dMs: null, haMs: ms, hs: null,
        cd: { H: ha }, up: false, upFrom: "", cls: ["H"],
        bi: /^KH?\d/i.test(code), fa: /^F\d/i.test(code), co: code ? [code] : [],
        ch: ["Salesforce"], ph: phone, cph: false, sf: true,
        ky: keys, re: "",
        sfR: r.Rating === "Hot" ? "H" : r.Rating === "Cold" ? "C" : r.Rating === "Warm" ? "W" : "",
        sfConv: r.IsConverted === true,
      });
      sfHot++;
    }
  }

  // Dán nhãn reMKT cho MỌI lead (cả SMAX lẫn SF) khớp người đã học khoá trước.
  // Dashboard hiện nhãn để sales biết đây là re-marketing, KHÔNG đếm vào lead
  // mới trong ngày. Lark không có nhãn này (theo yêu cầu 2026-08-10).
  let reCount = 0;
  for (const l of leads) {
    for (const k of l.ky) { const lab = remkt.get(k); if (lab) { l.re = lab; reCount++; break; } }
    // Bổ sung khoá bên SF vào lead SMAX → lọc theo khoá không hụt.
    // KHÔNG áp cho chính dòng Salesforce: khoá của nó đọc thẳng từ Product bên
    // SF rồi, mà sfCourse lại đã gộp KH→K ⇒ nhét vào là dòng "KH62" bỗng mang
    // thêm "K62" và cộng nhầm vào khoá K62, lệch ngay với dashboard SF.
    if (!l.sf) for (const k of l.ky) { const s2 = sfCourse.get(k); if (s2) for (const c of s2) if (!l.co.includes(c)) l.co.push(c); }
    // MẢNG (BI/FA) phải suy lại TỪ danh sách khoá SAU KHI đã gộp khoá bên SF.
    // Trước đây bi/fa chỉ đọc tag SMAX, nên lead có khoá K62 lấy từ SF (Đỗ Trung
    // Đức, Linh Nhâm, Anh Auto, Nguyễn Đức Trọng) mang co=["K62"] nhưng bi=false
    // ⇒ lọc "KHOÁ K62 + mảng BI" bị hụt 4 người (44 thay vì 48). 2026-09-03.
    if (l.co.some(c => /^KH?\d/i.test(c))) l.bi = true;
    if (l.co.some(c => /^F\d/i.test(c))) l.fa = true;
  }

  // `ky` chỉ dùng để ghép reMKT ở trên, client không cần → bỏ đi cho nhẹ
  // (kỳ "Tất cả" ~8.3k lead: 1,46 MB → 1,33 MB).
  // `ky` chỉ dùng để ghép reMKT ở trên; `cd` (mốc gắn từng tag) không trang nào
  // đọc — bỏ cả hai cho nhẹ đường truyền.
  const out = leads.map(({ ky, cd, ...rest }) => { void ky; void cd; return rest; });

  const asOf = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
  return NextResponse.json({ asOf, days, leads: out, reCount, sfHot, sfDays: Math.min(days, SF_MAX_DAYS), sfErr }, { headers: {
    // CHO EDGE CỦA VERCEL CACHE LẠI.
    // Kỳ "Tất cả" mất ~27s vì bảng SMAX đã hơn 19.000 dòng và Lark chỉ trả
    // 500 dòng/lượt (38 lượt nối tiếp, không song song được vì phải có
    // page_token của lượt trước). Không cache thì MỌI người mở dashboard đều
    // phải chờ ngần ấy. Với s-maxage + stale-while-revalidate: người đầu tiên
    // chịu 27s, những người sau nhận ngay bản đã có rồi edge tự làm mới nền.
    // Dashboard vốn đã public (Supabase Auth chết từ 08/2026) nên để "public"
    // không mở thêm gì mới.
    "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=900",
  } });
}
