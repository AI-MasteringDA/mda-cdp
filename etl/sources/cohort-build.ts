/**
 * Tính sẵn bảng SO SÁNH KHOÁ và ghi vào Lark "Cohort_Summary".
 *
 * Câu hỏi nghiệp vụ (sếp hỏi 2026-09-03): "K62 mở tới giờ được bao nhiêu, so với
 * các khoá trước ở CÙNG mốc thì hơn hay kém?". So tổng cả khoá là sai — khoá cũ
 * đã chạy xong vài tháng, khoá mới mới ~2 tuần. Phải so cùng số ngày kể từ ngày
 * mở tuyển sinh.
 *
 * VÌ SAO PHẢI TÍNH SẴN: quét đủ dữ liệu cần 40 trang Lark ≈ 143 giây (đo
 * 2026-09-03), trong khi Vercel cắt hàm ở 60s. Nên job này chạy nền rồi ghi kết
 * quả gọn (~27 dòng) lên Lark; /api/cohort chỉ đọc bảng đó nên trả về tức thì.
 *
 * NGÀY MỞ TUYỂN SINH suy ra từ dữ liệu, KHÔNG nhập tay: = mốc gắn tag khoá SỚM
 * NHẤT. Đã đối chiếu thực tế và khớp — các khoá bàn giao liền mạch (K60 hết
 * 19/06 đúng ngày K61 mở; K61 hết 15/08 đúng ngày K62 mở).
 *
 * Chạy: npm run etl:cohort:build
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const U = "https://open.larksuite.com/open-apis";
const ID = process.env.LARK_APP_ID || "", SEC = process.env.LARK_APP_SECRET || "", APP = process.env.LARK_BASE_APP_TOKEN || "";
const DAY = 86400_000;
const TABLE = "Cohort_Summary";
const COURSE_COL = /^(KH?\d{2,3}|F\d(?:\.\d)?) lúc$/i;
const vnDay = (ms: number) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);
const txt = (v: unknown): string => Array.isArray(v) ? (v as { text?: string }[]).map(x => x?.text ?? "").join("") : (v == null ? "" : String(v));

// Cột của bảng tổng hợp. Giữ tên tiếng Việt để sếp mở thẳng Lark cũng đọc được.
const COLS: [string, number, Record<string, unknown>?][] = [
  ["Khoá", 1],
  ["Nhóm", 1],                                   // BI (K##/KH##) hay FA (F#)
  ["Ngày mở", 5, { date_formatter: "yyyy-MM-dd", auto_fill: false }],
  ["Ngày thứ", 2, { formatter: "0" }],            // số ngày đã chạy tính tới lúc chốt
  ["Lead cùng kỳ", 2, { formatter: "0" }],        // cắt tại cùng mốc "Ngày thứ" của khoá đang chạy
  ["Hot cùng kỳ", 2, { formatter: "0" }],
  ["Lead tổng", 2, { formatter: "0" }],           // cả khoá, chỉ để tham khảo
  ["Hot tổng", 2, { formatter: "0" }],
  ["Đường Hot", 1],                               // JSON mảng tích luỹ theo ngày, cho biểu đồ
  ["Đang chạy", 7],
  ["Cập nhật lúc", 5, { date_formatter: "yyyy-MM-dd HH:mm", auto_fill: false }],
];

async function larkToken(): Promise<string> {
  const r = await fetch(`${U}/auth/v3/tenant_access_token/internal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: ID, app_secret: SEC }) }).then(r => r.json());
  return r.tenant_access_token;
}

export async function runCohortBuild() {
  if (!APP) { console.log("[cohort] thiếu creds Lark, dừng"); return; }
  const tk = await larkToken();
  const H = { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" };

  const tR = await fetch(`${U}/bitable/v1/apps/${APP}/tables?page_size=100`, { headers: H }).then(r => r.json());
  if (tR.code !== 0) throw new Error(`đọc tables lỗi: ${tR.code} ${tR.msg}`);
  const srcId = tR.data.items.find((t: { name: string }) => t.name === "SMAX_Database")?.table_id;
  if (!srcId) { console.log("[cohort] không thấy SMAX_Database"); return; }

  const fR = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${srcId}/fields?page_size=100`, { headers: H }).then(r => r.json());
  if (fR.code !== 0) throw new Error(`đọc fields lỗi: ${fR.code} ${fR.msg}`);
  const courseCols: string[] = (fR.data?.items ?? []).map((f: { field_name: string }) => f.field_name).filter((n: string) => COURSE_COL.test(n));
  if (!courseCols.length) { console.log("[cohort] không có cột khoá nào"); return; }

  // ── quét dữ liệu nguồn
  type Row = { course: string; tagMs: number; hotMs: number | null };
  const rows: Row[] = [];
  let pt: string | undefined, pages = 0;
  while (true) {
    const url = new URL(`${U}/bitable/v1/apps/${APP}/tables/${srcId}/records`);
    url.searchParams.set("page_size", "500");
    url.searchParams.set("field_names", JSON.stringify(["Hot Lead lúc", ...courseCols]));
    if (pt) url.searchParams.set("page_token", pt);
    const d = await fetch(url.toString(), { headers: H }).then(r => r.json());
    if (d.code !== 0) throw new Error(`đọc records lỗi: ${d.code} ${d.msg}`);
    for (const r of (d.data?.items ?? [])) {
      const f = r.fields ?? {};
      const hot = typeof f["Hot Lead lúc"] === "number" ? f["Hot Lead lúc"] as number : null;
      for (const c of courseCols) {
        const t = f[c];
        if (typeof t === "number") rows.push({ course: c.replace(/ lúc$/, ""), tagMs: t, hotMs: hot });
      }
    }
    pages++;
    if (!d.data?.has_more) break; pt = d.data.page_token;
  }
  console.log(`[cohort] quét ${pages} trang · ${rows.length} (lead × khoá) · ${courseCols.length} khoá`);
  if (!rows.length) { console.log("[cohort] 0 dòng — DỪNG, không ghi (tránh xoá trắng)."); return; }

  // ── tính
  const byCourse = new Map<string, Row[]>();
  for (const r of rows) { const a = byCourse.get(r.course) ?? []; a.push(r); byCourse.set(r.course, a); }
  // Mốc "hiện tại" lấy từ chính dữ liệu (tag mới nhất) chứ không dùng Date.now()
  // — số không nhảy lung tung khi máy chủ lệch giờ.
  const nowMs = Math.max(...rows.map(r => r.tagMs));

  type C = { code: string; grp: string; openMs: number; days: number; leads: number; hot: number; leadsAt: number; hotAt: number; curve: number[] };
  const list: C[] = [];
  for (const [code, rs] of byCourse) {
    if (rs.length < 5) continue;   // khoá quá ít dữ liệu = nhiễu (tag gõ nhầm)
    const openMs = Math.min(...rs.map(r => r.tagMs));
    // BA hệ khoá riêng biệt, KHÔNG gộp: K## (BI chính), KH## (hệ khác, quy mô
    // nhỏ hơn hẳn), F# (FA). Gộp K với KH là sai: KH62 mở 18/08 (9 lead) sẽ
    // giành mất vai "khoá đang chạy" của K62 mở 15/08 (200 lead), rồi mọi khoá
    // K bị cắt theo mốc của KH — số vô nghĩa. (Bắt được lúc chạy thử 2026-09-03.)
    const grp = /^F\d/i.test(code) ? "FA" : (/^KH/i.test(code) ? "KH" : "BI");
    list.push({ code, grp, openMs, days: Math.floor((nowMs - openMs) / DAY), leads: rs.length, hot: rs.filter(r => r.hotMs != null).length, leadsAt: 0, hotAt: 0, curve: [] });
  }
  if (!list.length) { console.log("[cohort] không khoá nào đủ dữ liệu"); return; }

  // Với MỖI nhóm (BI/FA), khoá mở gần nhất là khoá "đang chạy"; mọi khoá cùng
  // nhóm đều cắt tại đúng số ngày khoá đó đã chạy — đó mới là so cùng kỳ.
  const running = new Map<string, C>();
  for (const c of list) { const cur = running.get(c.grp); if (!cur || c.openMs > cur.openMs) running.set(c.grp, c); }
  for (const c of list) {
    const dayN = Math.max(0, running.get(c.grp)!.days);
    const rs = byCourse.get(c.code)!;
    const cut = c.openMs + dayN * DAY;
    const inWin = rs.filter(r => r.tagMs <= cut);
    c.leadsAt = inWin.length;
    c.hotAt = inWin.filter(r => r.hotMs != null && r.hotMs <= cut).length;
    const curve: number[] = [];
    for (let d = 0; d <= dayN; d++) { const lim = c.openMs + d * DAY; curve.push(rs.filter(r => r.hotMs != null && r.hotMs <= lim).length); }
    c.curve = curve;
  }
  list.sort((a, b) => b.openMs - a.openMs);
  for (const [g, c] of running) console.log(`[cohort] ${g}: khoá đang chạy ${c.code} (mở ${vnDay(c.openMs)}, ngày thứ ${c.days}) · ${c.hotAt} Hot cùng kỳ`);

  // ── ghi vào bảng tổng hợp (tạo bảng + cột nếu chưa có)
  let dstId: string | undefined = tR.data.items.find((t: { name: string }) => t.name === TABLE)?.table_id;
  if (!dstId) {
    const cr = await fetch(`${U}/bitable/v1/apps/${APP}/tables`, { method: "POST", headers: H, body: JSON.stringify({ table: { name: TABLE, fields: COLS.map(([field_name, type, property]) => ({ field_name, type, ...(property ? { property } : {}) })) } }) }).then(r => r.json());
    if (cr.code !== 0) throw new Error(`tạo bảng ${TABLE} lỗi: ${cr.code} ${cr.msg}`);
    dstId = cr.data.table_id; console.log(`[cohort] đã tạo bảng "${TABLE}"`);
  } else {
    const dF = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dstId}/fields?page_size=100`, { headers: H }).then(r => r.json());
    const have = new Set<string>((dF.data?.items ?? []).map((f: { field_name: string }) => f.field_name));
    for (const [field_name, type, property] of COLS) {
      if (have.has(field_name)) continue;
      await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dstId}/fields`, { method: "POST", headers: H, body: JSON.stringify({ field_name, type, ...(property ? { property } : {}) }) });
      console.log(`[cohort] đã thêm cột "${field_name}"`);
    }
  }

  // Bảng nhỏ (~27 dòng) nên ghi lại toàn bộ cho đơn giản: xoá hết rồi tạo lại.
  // An toàn vì đây là bảng DẪN XUẤT, không ai nhập tay vào — và ở trên đã chặn
  // trường hợp nguồn rỗng nên không có chuyện xoá sạch rồi không ghi lại được.
  const old: string[] = []; let opt: string | undefined;
  while (true) {
    const u = new URL(`${U}/bitable/v1/apps/${APP}/tables/${dstId}/records`); u.searchParams.set("page_size", "500");
    if (opt) u.searchParams.set("page_token", opt);
    const d = await fetch(u.toString(), { headers: H }).then(r => r.json());
    if (d.code !== 0) break;
    for (const r of (d.data?.items ?? [])) old.push(r.record_id);
    if (!d.data?.has_more) break; opt = d.data.page_token;
  }
  for (let i = 0; i < old.length; i += 400) {
    await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dstId}/records/batch_delete`, { method: "POST", headers: H, body: JSON.stringify({ records: old.slice(i, i + 400) }) });
  }
  const stamp = Date.now();
  const recs = list.map(c => ({ fields: {
    "Khoá": c.code, "Nhóm": c.grp, "Ngày mở": c.openMs, "Ngày thứ": c.days,
    "Lead cùng kỳ": c.leadsAt, "Hot cùng kỳ": c.hotAt, "Lead tổng": c.leads, "Hot tổng": c.hot,
    "Đường Hot": JSON.stringify(c.curve), "Đang chạy": running.get(c.grp)!.code === c.code,
    "Cập nhật lúc": stamp,
  } }));
  let wrote = 0;
  for (let i = 0; i < recs.length; i += 400) {
    const rr = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dstId}/records/batch_create`, { method: "POST", headers: H, body: JSON.stringify({ records: recs.slice(i, i + 400) }) }).then(r => r.json());
    if (rr.code === 0) wrote += recs.slice(i, i + 400).length; else console.log(`[cohort] ghi lỗi: ${rr.code} ${rr.msg}`);
  }
  console.log(`[cohort] ✅ đã ghi ${wrote}/${recs.length} khoá vào "${TABLE}" (xoá ${old.length} dòng cũ)`);
  void txt;
}

runCohortBuild().then(() => process.exit(0)).catch((e) => { console.error("[cohort] LỖI:", e.message); process.exit(1); });
