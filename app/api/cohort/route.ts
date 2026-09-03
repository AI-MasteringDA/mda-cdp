/**
 * GET /api/cohort — so sánh các KHOÁ theo "ngày thứ N kể từ khi mở tuyển sinh".
 *
 * Câu hỏi nghiệp vụ (sếp hỏi 2026-09-03): "K62 mở tới giờ được bao nhiêu, so với
 * các khoá trước ở CÙNG mốc thì hơn hay kém?". So tổng cả khoá là sai — khoá cũ
 * đã chạy xong vài tháng, khoá mới mới ~2 tuần.
 *
 * CHỈ ĐỌC bảng đã tính sẵn "Cohort_Summary" (~27 dòng) nên trả về tức thì.
 * KHÔNG tự tính ở đây: quét đủ dữ liệu nguồn cần 40 trang Lark ≈ 143 giây (đo
 * 2026-09-03) trong khi Vercel cắt hàm ở 60s. Việc tính do job nền
 * etl/sources/cohort-build.ts lo.
 *
 * ?grp=bi|fa|kh  — lọc theo hệ khoá (K## / F# / KH##). Bỏ trống = tất cả.
 */
import { NextResponse } from "next/server";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const U = "https://open.larksuite.com/open-apis";
const TABLE = "Cohort_Summary";
const gs = (v: unknown): string => Array.isArray(v) ? (v as { text?: string }[]).map(x => x?.text ?? "").join("") : (v == null ? "" : String(v));
const num = (v: unknown): number => typeof v === "number" ? v : Number(gs(v)) || 0;
const vnDay = (ms: number) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);

export async function GET(req: Request) {
  const grp = (new URL(req.url).searchParams.get("grp") || "").toUpperCase();
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
  const db = tR.data.items.find((t: { name: string; table_id: string }) => t.name === TABLE)?.table_id;
  // Chưa có bảng = job nền chưa chạy lần nào. Trả rỗng có thông báo rõ để
  // dashboard hiện "chưa có dữ liệu" thay vì lỗi khó hiểu.
  if (!db) return NextResponse.json({ courses: [], asOf: null, note: `chưa có bảng ${TABLE} — chạy npm run etl:cohort:build` });

  const items: Record<string, unknown>[] = [];
  let pt: string | undefined;
  while (true) {
    const url = new URL(`${U}/bitable/v1/apps/${APP}/tables/${db}/records`);
    url.searchParams.set("page_size", "500");
    if (pt) url.searchParams.set("page_token", pt);
    const d = await fetch(url.toString(), { headers: H, cache: "no-store" }).then(r => r.json());
    if (d.code !== 0) return NextResponse.json({ error: `records ${d.code} ${d.msg}` }, { status: 502 });
    for (const r of (d.data?.items ?? []) as { fields?: Record<string, unknown> }[]) items.push(r.fields ?? {});
    if (!d.data?.has_more) break; pt = d.data.page_token;
  }

  let courses = items.map(f => {
    const arr = (k: string): number[] => { try { const p = JSON.parse(gs(f[k]) || "[]"); return Array.isArray(p) ? p.map(Number) : [] } catch { return [] } };
    const curve = arr("Đường Hot"), curveLead = arr("Đường Lead");
    return {
      code: gs(f["Khoá"]).trim(),
      grp: gs(f["Nhóm"]).trim().toUpperCase(),
      openDay: typeof f["Ngày mở"] === "number" ? vnDay(f["Ngày mở"] as number) : null,
      days: num(f["Ngày thứ"]),
      leadsAt: num(f["Lead cùng kỳ"]), hotAt: num(f["Hot cùng kỳ"]),
      leads: num(f["Lead tổng"]), hot: num(f["Hot tổng"]),
      running: f["Đang chạy"] === true,
      // Phễu hiện tại (theo tag đang có) — dùng cho hàng KPI của khoá đang chạy.
      P: num(f["Prospect"]), C: num(f["Cold"]), W: num(f["Warm"]), H: num(f["Hot"]), Un: num(f["Chưa tag"]),
      curve, curveLead,
    };
  }).filter(c => c.code);

  if (grp) courses = courses.filter(c => c.grp === grp);
  // Mới nhất lên đầu — khoá đang chạy luôn ở vị trí số 1 của mỗi hệ.
  courses.sort((a, b) => (b.openDay ?? "").localeCompare(a.openDay ?? ""));

  const stamp = items.map(f => typeof f["Cập nhật lúc"] === "number" ? f["Cập nhật lúc"] as number : 0).sort((a, b) => b - a)[0] || 0;
  return NextResponse.json({
    asOf: stamp ? new Date(stamp + 7 * 3600_000).toISOString().slice(0, 16).replace("T", " ") : null,
    courses,
  }, { headers: { "Cache-Control": "private, max-age=300" } });
}
