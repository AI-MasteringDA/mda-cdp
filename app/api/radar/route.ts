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
  const haMs = typeof f["Hot Lead lúc"] === "number" ? f["Hot Lead lúc"] as number : null;
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
    n: gs(f["Lead Name"]) || "(?)", d: bc, ha, dMs: bcMs, haMs, cd, up, upFrom: up ? priorCls : "",
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

type Lead = { n: string; n2?: string; d: string | null; ha: string | null; dMs: number | null; haMs: number | null; cd: Record<string, string>; up: boolean; upFrom: string; cls: string[]; bi: boolean; fa: boolean; co: string[]; ch: string[]; ph: string; cph: boolean; ky: string[]; re: string; sf?: boolean };

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
  // key (SĐT/email) → mốc lead vào WEB sớm nhất bên SF. Dùng để quy ngày Hot
  // cho lead web (xem khối "LEAD ĐẾN TỪ WEB" bên dưới).
  const webLead = new Map<string, number>();
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
  const sfTable = tR.data?.items?.find((t: { name: string; table_id: string }) => t.name === "Salesforce_Database")?.table_id;
  if (sfTable) {
    // Khoá của những người ĐÃ được đếm — vừa để gộp lead SF trùng nhau, vừa để
    // không đếm lại người mà nhánh SMAX đã tính (bổ sung cho phép kiểm tag
    // "Hot Lead" bên dưới, vì lead SF có thể không mang tag SMAX nào).
    const sfSeen = new Set<string>();
    for (const l of leads) for (const k of idKeysOf(l.ph, "")) sfSeen.add(k);
    let spt: string | undefined; let pages = 0;
    while (pages < 30) {
      const url = new URL(`${U}/bitable/v1/apps/${APP}/tables/${sfTable}/records/search`);
      url.searchParams.set("page_size", "500"); if (spt) url.searchParams.set("page_token", spt);
      const d = await fetch(url.toString(), {
        method: "POST", headers: H, cache: "no-store",
        body: JSON.stringify({
          field_names: ["Time", "Event", "Lead Name", "Tên SF", "Tag SMAX", "Phone", "Email", "Lead cũ (SF)", "Khoá (SF)", "Rating (SF)", "Đã chốt (SF)", "Kênh (SF)"],
          filter: { conjunction: "and", conditions: [
            { field_name: "Event", operator: "is", value: ["lead_created"] },
            { field_name: "Time", operator: "isGreater", value: ["ExactDate", String(cutoffMs)] },
          ] },
        }),
      }).then(r => r.json()).catch(() => ({ code: -1 }));
      if (d.code !== 0) break;
      for (const r of (d.data?.items ?? []) as LarkRecord[]) {
        const f = r.fields ?? {};
        const keys = keysOf(gs(f["Phone"]), gs(f["Email"]));
        // KHÁCH QUAY LẠI: "Lead cũ (SF)" (RelevantLeads__c) liệt kê các khoá
        // trước của chính người này — VD chị Thu Hà "K45 - 2024". Ghi nhận ở
        // ĐÂY, kể cả dòng bị bỏ qua bên dưới, vì người đó có thể đang được đếm
        // bên nhánh SMAX (ca chị Hà: SF bị skip do đã có Tag SMAX).
        const prior = gs(f["Lead cũ (SF)"]).trim();
        if (prior) for (const k of keys) if (!remkt.has(k)) remkt.set(k, prior);
        // LEAD ĐẾN TỪ WEB — ghi nhận mốc vào web để quy ngày Hot cho đúng.
        // Luồng thật (user mô tả 2026-08-18, ca "chị Nhâm"): khách điền form
        // web ⇒ SF tạo lead ngay hôm đó với kênh "Web -> Email + Call"; sau đó
        // khách mới nhắn SMAX và sales gắn tag Hot — có thể LỆCH SANG NGÀY KHÁC.
        // Đếm theo giờ gắn tag SMAX là đẩy công sang ngày sales thao tác chứ
        // không phải ngày lead thật sự vào. Ghi ở ĐÂY (không phải trong nhánh
        // đếm bên dưới) vì phần lớn ca này bị nhánh SF bỏ qua do SMAX đã có tag.
        if (/web\s*->/i.test(gs(f["Kênh (SF)"]))) {
          const wMs = typeof f["Time"] === "number" ? f["Time"] as number : 0;
          if (wMs) for (const k of keys) { const cur = webLead.get(k); if (cur == null || wMs < cur) webLead.set(k, wMs); }
        }
        // KHOÁ BÊN SF: SMAX và SF hay ghi khác khoá cho cùng một người (ca
        // "H Xuan": SMAX ghi K60, SF ghi K61). Gom lại để lead nào cũng lọc
        // được theo khoá của CẢ HAI hệ, không bị hụt khi lọc K61.
        const prodRaw = gs(f["Khoá (SF)"]).trim();
        const pm = prodRaw.match(/^(KH?\d{2,3}|F\d(?:\.\d)?)\b/i);
        if (pm) for (const k of keys) { const s = sfCourse.get(k) ?? new Set<string>(); s.add(coCode(pm[1])); sfCourse.set(k, s); }
        // CHỐNG ĐẾM ĐÔI — chỉ bỏ khi SMAX THẬT SỰ đếm người này là Hot. Trước
        // đây bỏ khi có BẤT KỲ tag SMAX nào, nên ai có tag "SF_Done"/"BI Student"
        // mà không có "Hot Lead" thì lọt khe: SF bỏ vì "SMAX đếm rồi", còn SMAX
        // không đủ điều kiện để đếm ⇒ mất hẳn (16 ca khoá K61, đo 2026-08-10).
        if (g(f["Tag SMAX"]).some(t => norm(t) === "hotlead")) continue;
        const ha = vnDate(f["Time"]); if (!ha || ha < cutoff) continue;
        const haMs2 = typeof f["Time"] === "number" ? f["Time"] as number : null;
        // Tên SF thường khác tên SMAX (SMAX "K40-Bảo Lee" ↔ SF "Lý Hồng Bảo") →
        // hiện tên SF làm chính để tra trên Salesforce được ngay, kèm tên SMAX.
        const sfName = gs(f["Tên SF"]).trim(), smaxName = gs(f["Lead Name"]).trim();
        // Nhánh này chỉ bổ sung HOT. Trước đây coi MỌI lead SF là Hot — sai, vì
        // riêng khoá K61 trên SF đã có 80 lead Cold.
        //
        // RATING TRỐNG: trước kia VẪN tính, vì dữ liệu đi qua Supabase có thể
        // chưa backfill xong nên trống = "chưa biết". Từ 2026-08-18 KHÔNG tính
        // nữa (user chốt): sf-lark-bridge.ts luôn ghi Rating thẳng từ Salesforce
        // ⇒ trống nghĩa là sales THẬT SỰ chưa đánh giá, không phải thiếu dữ liệu.
        // Đo lúc đổi: 21/86 lead SF đang được tính Hot chỉ nhờ rating trống — ca
        // "Julie Vu" (không email, không SĐT, không rating) là ví dụ user bắt được.
        const rating = norm(gs(f["Rating (SF)"]));
        if (rating !== "hot") continue;
        // ĐÃ CHỐT SALES thì thôi đếm Hot (user chốt 2026-08-18): lead convert
        // sang Contact/Opportunity bên SF đã thành KHÁCH, không còn nằm trong
        // phễu "Hot lead" nữa. Cột này do sf-lark-bridge.ts ghi từ IsConverted.
        // Đo lúc thêm: 51 lead convert trong 45 ngày, 10 mang Rating=Hot vẫn
        // đang được đếm (ca "Vũ Thị Thu Uyên" user bắt được).
        if (f["Đã chốt (SF)"] === true) continue;
        // GỘP LEAD TRÙNG BÊN SF (user chốt 2026-08-18 "gộp lead chính xác trên
        // SF, để k dup"). Salesforce cho phép cùng một người tồn tại nhiều Lead
        // — đo trên 486 lead/90 ngày: 17 nhóm trùng email, 16 nhóm trùng SĐT.
        // Không gộp thì mỗi bản ghi đếm một lần ⇒ thổi phồng Hot.
        // Khoá gộp đã LỌC BỎ liên hệ công ty (idKeysOf) vì 0961486648 đang nằm
        // trên 2 lead của hai người khác nhau — gộp theo đó là sai người.
        // Lead không có cả email lẫn SĐT thì KHÔNG có căn cứ nào để gộp (2 ca:
        // "Julie Vu", "Mai Trinh") — đành để riêng, phải sửa dữ liệu bên SF.
        const idKeys = idKeysOf(gs(f["Phone"]), gs(f["Email"]));
        if (idKeys.some(k => sfSeen.has(k))) continue;
        for (const k of idKeys) sfSeen.add(k);
        // "K61 - ONL - 2026" → "K61" để lọc chung một rổ với tag SMAX.
        const prod = gs(f["Khoá (SF)"]).trim();
        const m = prod.match(/^(KH?\d{2,3}|F\d(?:\.\d)?)\b/i);
        leads.push({
          n: sfName || smaxName || "(?)", n2: sfName && smaxName && sfName !== smaxName ? smaxName : "",
          d: null, ha, dMs: null, haMs: haMs2, cd: ha ? { H: ha } : {}, up: false, upFrom: "", cls: ["H"],
          bi: /^KH?\d/i.test(prod), fa: /^F\d/i.test(prod),
          co: m ? [coCode(m[1])] : [],
          ch: ["Salesforce"], ph: gs(f["Phone"]), cph: false, sf: true,
          ky: keys, re: "",
        });
      }
      pages++;
      if (!d.data?.has_more) break; spt = d.data.page_token;
    }
  }

  // Dán nhãn reMKT cho MỌI lead (cả SMAX lẫn SF) khớp người đã học khoá trước.
  // Dashboard hiện nhãn để sales biết đây là re-marketing, KHÔNG đếm vào lead
  // mới trong ngày. Lark không có nhãn này (theo yêu cầu 2026-08-10).
  let reCount = 0, webFix = 0;
  for (const l of leads) {
    for (const k of l.ky) { const lab = remkt.get(k); if (lab) { l.re = lab; reCount++; break; } }
    // Bổ sung khoá bên SF vào lead SMAX (và ngược lại) → lọc theo khoá không hụt
    for (const k of l.ky) { const s = sfCourse.get(k); if (s) for (const c of s) if (!l.co.includes(c)) l.co.push(c); }
    // MẢNG (BI/FA) phải suy lại TỪ danh sách khoá SAU KHI đã gộp khoá bên SF.
    // Trước đây bi/fa chỉ đọc tag SMAX, nên lead có khoá K62 lấy từ SF (Đỗ Trung
    // Đức, Linh Nhâm, Anh Auto, Nguyễn Đức Trọng) mang co=["K62"] nhưng bi=false
    // ⇒ lọc "KHOÁ K62 + mảng BI" bị hụt 4 người (44 thay vì 48). 2026-09-03.
    if (l.co.some(c => /^KH?\d/i.test(c))) l.bi = true;
    if (l.co.some(c => /^F\d/i.test(c))) l.fa = true;
    // QUY NGÀY HOT CHO LEAD WEB (user chốt 2026-08-18).
    // Khách điền form web ⇒ SF tạo lead ngay hôm đó. Sau đó khách mới nhắn SMAX
    // và sales gắn tag Hot — thường LỆCH SANG NGÀY KHÁC. Đếm theo giờ gắn tag là
    // ghi công vào ngày sales thao tác, không phải ngày lead thật sự vào.
    // Ca "chị Nhâm": vào web 17/08 09:46, chat SMAX 18/08 14:09, tag Hot 18/08
    // 14:15 ⇒ trước đây bị đếm 18/08, đúng ra phải là 17/08.
    // Chỉ LÙI về trước, không bao giờ đẩy tới: mốc web muộn hơn tag thì giữ tag.
    if (!l.sf && l.haMs != null) {
      let w: number | null = null;
      for (const k of l.ky) { const t = webLead.get(k); if (t != null && (w == null || t < w)) w = t; }
      if (w != null && w < l.haMs) { l.haMs = w; l.ha = vnDate(w); l.cd = { ...l.cd, H: l.ha ?? l.cd.H }; webFix++; }
    }
  }

  // `ky` chỉ dùng để ghép reMKT ở trên, client không cần → bỏ đi cho nhẹ
  // (kỳ "Tất cả" ~8.3k lead: 1,46 MB → 1,33 MB).
  const out = leads.map(({ ky, ...rest }) => { void ky; return rest; });

  const asOf = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
  return NextResponse.json({ asOf, days, leads: out, reCount, webFix }, { headers: { "Cache-Control": "private, max-age=120" } });
}
