/**
 * GET /api/cohort — so sánh các KHOÁ theo "ngày thứ N kể từ khi mở tuyển sinh".
 *
 * Câu hỏi nghiệp vụ (sếp hỏi 2026-09-03): "K62 mở tới giờ được bao nhiêu, so với
 * các khoá trước ở CÙNG mốc thời gian thì hơn hay kém?". So tổng cả khoá là sai
 * — khoá cũ đã chạy xong 2 tháng, khoá mới mới 18 ngày. Phải so cùng số ngày.
 *
 * NGÀY MỞ TUYỂN SINH suy ra từ dữ liệu, KHÔNG nhập tay: = mốc gắn tag khoá SỚM
 * NHẤT. Đã kiểm chứng khớp thực tế — các khoá bàn giao liền mạch (K60 hết 19/06
 * đúng ngày K61 mở; K61 hết 15/08 đúng ngày K62 mở).
 *
 * Endpoint RIÊNG chứ không nhét vào /api/radar vì phạm vi dữ liệu khác hẳn:
 * radar chỉ cần ~40 ngày, còn so khoá phải quét từ K50 (2025-05). Ở đây chỉ đọc
 * đúng 2 nhóm cột (mốc gắn tag khoá + "Hot Lead lúc") nên vẫn nhẹ.
 */
import { NextResponse } from "next/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const U = "https://open.larksuite.com/open-apis";
const DAY = 86400_000;
/** Cột "<khoá> lúc" — K##, KH##, F# (bỏ Hot/Cold/Warm/Prospect lúc). */
const COURSE_COL = /^(KH?\d{2,3}|F\d(?:\.\d)?) lúc$/i;
const vnDay = (ms: number) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);

type Row = { course: string; tagMs: number; hotMs: number | null };

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  // "bi" = K##/KH## · "fa" = F# · bỏ trống = tất cả
  const grp = (sp.get("grp") || "").toLowerCase();
  // Số khoá gần nhất muốn trả về (0 = tất cả). Mặc định tất cả — user chốt
  // 2026-09-03 muốn thấy toàn bộ khoá có dữ liệu.
  const limit = Math.max(0, Number(sp.get("limit") || 0));

  const ID = process.env.LARK_APP_ID, SEC = process.env.LARK_APP_SECRET, APP = process.env.LARK_BASE_APP_TOKEN;
  if (!ID || !SEC || !APP) return NextResponse.json({ error: "missing lark env" }, { status: 500 });
  const auth = await fetch(`${U}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: ID, app_secret: SEC }), cache: "no-store",
  }).then(r => r.json());
  const tk = auth.tenant_access_token;
  if (!tk) return NextResponse.json({ error: "lark auth failed" }, { status: 502 });
  const H = { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" };

  const tR = await fetch(`${U}/bitable/v1/apps/${APP}/tables?page_size=100`, { headers: H, cache: "no-store" }).then(r => r.json());
  if (tR.code !== 0) return NextResponse.json({ error: `tables ${tR.code}` }, { status: 502 });
  const db = tR.data.items.find((t: { name: string; table_id: string }) => t.name === "SMAX_Database")?.table_id;
  if (!db) return NextResponse.json({ error: "no SMAX_Database" }, { status: 502 });

  const fR = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${db}/fields?page_size=100`, { headers: H, cache: "no-store" }).then(r => r.json());
  if (fR.code !== 0) return NextResponse.json({ error: `fields ${fR.code}` }, { status: 502 });
  let courseCols: string[] = (fR.data?.items ?? [])
    .map((f: { field_name: string }) => f.field_name)
    .filter((n: string) => COURSE_COL.test(n));
  if (grp === "bi") courseCols = courseCols.filter(n => /^KH?\d/i.test(n));
  else if (grp === "fa") courseCols = courseCols.filter(n => /^F\d/i.test(n));
  if (!courseCols.length) return NextResponse.json({ courses: [], asOf: null });

  const rows: Row[] = [];
  let pt: string | undefined;
  while (true) {
    const url = new URL(`${U}/bitable/v1/apps/${APP}/tables/${db}/records`);
    url.searchParams.set("page_size", "500");
    url.searchParams.set("field_names", JSON.stringify(["Hot Lead lúc", ...courseCols]));
    if (pt) url.searchParams.set("page_token", pt);
    const d = await fetch(url.toString(), { headers: H, cache: "no-store" }).then(r => r.json());
    // Không check code là vòng lặp im lặng thoát và trả về rỗng như thể "không
    // có dữ liệu" — lỗi đã gặp nhiều lần ở các job khác, đừng lặp lại.
    if (d.code !== 0) return NextResponse.json({ error: `records ${d.code} ${d.msg}` }, { status: 502 });
    for (const r of (d.data?.items ?? []) as { fields?: Record<string, unknown> }[]) {
      const f = r.fields ?? {};
      const hot = typeof f["Hot Lead lúc"] === "number" ? f["Hot Lead lúc"] as number : null;
      for (const c of courseCols) {
        const t = f[c];
        if (typeof t === "number") rows.push({ course: c.replace(/ lúc$/, ""), tagMs: t, hotMs: hot });
      }
    }
    if (!d.data?.has_more) break; pt = d.data.page_token;
  }
  if (!rows.length) return NextResponse.json({ courses: [], asOf: null });

  const byCourse = new Map<string, Row[]>();
  for (const r of rows) { const a = byCourse.get(r.course) ?? []; a.push(r); byCourse.set(r.course, a); }

  // Mốc "hiện tại" = tag mới nhất trong toàn bộ dữ liệu (không dùng Date.now()
  // để số không nhảy khi máy chủ lệch giờ, và để khớp đúng dữ liệu đang có).
  const nowMs = Math.max(...rows.map(r => r.tagMs));

  type Course = { code: string; openMs: number; openDay: string; days: number; leads: number; hot: number; curve: number[]; running: boolean };
  const courses: Course[] = [];
  for (const [code, list] of byCourse) {
    // Khoá quá ít dữ liệu là nhiễu (VD tag gõ nhầm) — bỏ.
    if (list.length < 5) continue;
    const openMs = Math.min(...list.map(r => r.tagMs));
    const days = Math.floor((nowMs - openMs) / DAY);
    courses.push({ code, openMs, openDay: vnDay(openMs), days, leads: list.length, hot: list.filter(r => r.hotMs != null).length, curve: [], running: false });
  }
  if (!courses.length) return NextResponse.json({ courses: [], asOf: null });

  // KHOÁ ĐANG CHẠY = khoá mở gần nhất. Mọi so sánh đều cắt tại đúng số ngày mà
  // khoá này đã chạy (dayN) — đó mới là so "cùng kỳ".
  courses.sort((a, b) => b.openMs - a.openMs);
  const current = courses[0];
  current.running = true;
  const dayN = Math.max(0, current.days);

  for (const c of courses) {
    const list = byCourse.get(c.code)!;
    const cut = c.openMs + dayN * DAY;
    // Số liệu CẮT TẠI CÙNG MỐC — đây là con số dùng để so sánh, khác với
    // c.leads/c.hot (tổng cả khoá, chỉ để tham khảo).
    const inWin = list.filter(r => r.tagMs <= cut);
    const hotInWin = inWin.filter(r => r.hotMs != null && r.hotMs <= cut).length;
    const curve: number[] = [];
    for (let d = 0; d <= dayN; d++) {
      const lim = c.openMs + d * DAY;
      curve.push(list.filter(r => r.hotMs != null && r.hotMs <= lim).length);
    }
    Object.assign(c, { leadsAt: inWin.length, hotAt: hotInWin, curve });
  }

  const out = (limit ? courses.slice(0, limit) : courses)
    .map(({ openMs, ...rest }) => { void openMs; return rest; });

  return NextResponse.json({
    asOf: vnDay(nowMs), dayN, current: current.code,
    courses: out,
  }, { headers: { "Cache-Control": "private, max-age=300" } });
}
