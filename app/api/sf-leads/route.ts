/**
 * GET /api/sf-leads — LEAD TẠO TRÊN SALESFORCE, ĐẾM THEO NGÀY.
 *
 * Số lấy THẲNG TỪ SALESFORCE bằng SOQL, không đi qua bản sao trên Lark.
 *
 * VÌ SAO KHÔNG DÙNG BẢNG Salesforce_Database TRÊN LARK (đo 2026-09-10):
 * bảng đó có 110 dòng lead_created cho khoá K62 trong khi Salesforce chỉ có 67
 * lead — 35 người bị nhân đôi dòng (hai lần import), 3 người đã bị đổi sản phẩm
 * bên SF mà Lark còn giữ giá trị cũ, 2 người SF đã xoá. Khử trùng kiểu gì cũng
 * không về đúng được. User chốt: "đúng sai gì kệ, sai thì trên SF fix, dưới này
 * chỉnh theo" ⇒ Salesforce là nguồn sự thật, dashboard phản chiếu y nguyên.
 *
 * Chi phí: mỗi lần gọi tốn 2 lượt API (1 lấy token + 1 query). Hạn mức đo được
 * là 101.000 lượt/ngày, pipeline đang dùng chưa tới 0,3% — không đáng lo.
 *
 * ?days=N   số ngày lùi về (mặc định 60, tối đa 400)
 */
import { NextResponse } from "next/server";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * "K62 - ONL - 2026" -> "K62". CỐ Ý KHÔNG gộp KH62 vào K62 ở đây, khác với chỗ
 * còn lại của dashboard: Salesforce coi "K62" và "KH62" là HAI sản phẩm riêng,
 * mà mục đích của biểu đồ này là khớp 100% với báo cáo bên SF. Gộp vào thì K62
 * vống từ 67 lên 77 và lại lệch với SF.
 */
const coCode = (s: string): string => {
  const m = String(s || "").trim().match(/^(KH?\d{2,3}|F\d(?:\.\d)?)\b/i);
  return m ? m[1].toUpperCase() : "";
};

export async function GET(req: Request) {
  const INST = process.env.SALESFORCE_INSTANCE_URL, CID = process.env.SALESFORCE_CLIENT_ID,
        CSEC = process.env.SALESFORCE_CLIENT_SECRET, V = process.env.SALESFORCE_API_VERSION || "v59.0";
  if (!INST || !CID || !CSEC) return NextResponse.json({ error: "missing salesforce env" }, { status: 500 });

  const n = Math.min(400, Math.max(1, Number(new URL(req.url).searchParams.get("days") || 60)));
  const from = new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10) + "T00:00:00Z";

  const tr = await fetch(`${INST}/services/oauth2/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: CID, client_secret: CSEC }),
    cache: "no-store",
  }).then(r => r.json()).catch(() => null);
  if (!tr?.access_token) return NextResponse.json({ error: "salesforce auth failed" }, { status: 502 });

  // convertTimezone() để DAY_ONLY cắt theo múi giờ của org (VN), không phải UTC
  // — nếu không thì lead tạo lúc 8h tối bị đẩy sang ngày hôm sau.
  const soql = `SELECT DAY_ONLY(convertTimezone(CreatedDate)) d, Rating r, Product__r.Name p, COUNT(Id) n `
    + `FROM Lead WHERE CreatedDate >= ${from} `
    + `GROUP BY DAY_ONLY(convertTimezone(CreatedDate)), Rating, Product__r.Name`;
  const q = await fetch(`${INST}/services/data/${V}/query?q=${encodeURIComponent(soql)}`,
    { headers: { Authorization: `Bearer ${tr.access_token}` }, cache: "no-store" }).then(r => r.json()).catch(() => null);
  if (!q || q[0]?.errorCode) return NextResponse.json({ error: q?.[0]?.message || "soql failed" }, { status: 502 });

  // Gộp lại theo (ngày, rating, mã khoá) — nhiều biến thể sản phẩm cùng một
  // khoá ("K62 - 2026", "K62 - ONL - 2026") phải cộng chung.
  const acc = new Map<string, { d: string; r: string; co: string; n: number }>();
  for (const x of (q.records || []) as { d: string; r: string | null; p: string | null; n: number }[]) {
    const d = String(x.d).slice(0, 10);
    const r = x.r === "Hot" ? "H" : x.r === "Cold" ? "C" : x.r === "Warm" ? "W" : "";
    const co = coCode(x.p || "");
    const k = `${d}|${r}|${co}`;
    const cur = acc.get(k);
    if (cur) cur.n += x.n; else acc.set(k, { d, r, co, n: x.n });
  }
  const rows = [...acc.values()].sort((a, b) => a.d.localeCompare(b.d));
  return NextResponse.json({ days: n, rows, total: rows.reduce((s, x) => s + x.n, 0) },
    { headers: { "Cache-Control": "private, max-age=300" } });
}
