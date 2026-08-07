/**
 * GET /api/radar — dữ liệu cho trang /radar.html (Sales Lead Radar).
 * Đọc thẳng Lark SMAX_Database (nguồn đã dedup + reconcile mỗi giờ), trả về
 * lead 40 ngày gần nhất (ngày chat đầu hoặc ngày lên Hot trong cửa sổ).
 * Cache 5 phút để không dội Lark API mỗi lần mở trang.
 */
import { NextResponse } from "next/server";

export const revalidate = 300;

const U = "https://open.larksuite.com/open-apis";

type LarkCell = unknown;
const g = (v: LarkCell): string[] => Array.isArray(v) ? v.map((x) => (typeof x === "object" && x !== null ? ((x as { text?: string; name?: string }).text ?? (x as { name?: string }).name ?? "") : String(x))).filter(Boolean) : [];
const gs = (v: LarkCell): string => Array.isArray(v) ? (v as { text?: string }[]).map((x) => x?.text ?? "").join("") : (v == null ? "" : String(v));
const vnDate = (ms: LarkCell): string | null => typeof ms === "number" ? new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10) : null;
const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

export async function GET() {
  const ID = process.env.LARK_APP_ID, SEC = process.env.LARK_APP_SECRET, APP = process.env.LARK_BASE_APP_TOKEN;
  if (!ID || !SEC || !APP) return NextResponse.json({ error: "missing lark env" }, { status: 500 });

  const auth = await fetch(`${U}/auth/v3/tenant_access_token/internal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: ID, app_secret: SEC }), cache: "no-store" }).then(r => r.json());
  const tk = auth.tenant_access_token;
  if (!tk) return NextResponse.json({ error: "lark auth failed" }, { status: 502 });
  const H = { Authorization: `Bearer ${tk}` };

  const tR = await fetch(`${U}/bitable/v1/apps/${APP}/tables?page_size=100`, { headers: H, cache: "no-store" }).then(r => r.json());
  const db = tR.data?.items?.find((t: { name: string; table_id: string }) => t.name === "SMAX_Database")?.table_id;
  if (!db) return NextResponse.json({ error: "SMAX_Database not found" }, { status: 502 });

  const cutoff = new Date(Date.now() - 40 * 86400_000).toISOString().slice(0, 10);
  const leads: unknown[] = [];
  let pt: string | undefined;
  while (true) {
    const url = new URL(`${U}/bitable/v1/apps/${APP}/tables/${db}/records`);
    url.searchParams.set("page_size", "500");
    url.searchParams.set("field_names", JSON.stringify(["Lead Name", "Báo cáo ngày", "Hot Lead lúc", "Tag SMAX", "Communication Channels", "Phone", "Chưa phản hồi"]));
    if (pt) url.searchParams.set("page_token", pt);
    const d = await fetch(url.toString(), { headers: H, cache: "no-store" }).then(r => r.json());
    if (d.code !== 0) return NextResponse.json({ error: `lark read ${d.code}` }, { status: 502 });
    for (const r of (d.data?.items ?? [])) {
      const f = r.fields ?? {};
      const bc = vnDate(f["Báo cáo ngày"]), ha = vnDate(f["Hot Lead lúc"]);
      if ((!bc || bc < cutoff) && (!ha || ha < cutoff)) continue;
      const tags = g(f["Tag SMAX"]);
      const cls = tags.map(t => ({ hotlead: "H", coldlead: "C", warmlead: "W", prospect: "P" } as Record<string, string>)[norm(t)]).filter(Boolean);
      leads.push({
        n: gs(f["Lead Name"]) || "(?)", d: bc, ha, cls,
        bi: tags.some(t => /^kh?\d{2,3}$/i.test(t.trim())),
        fa: tags.some(t => /^f\d(\.\d)?$/i.test(t.trim())),
        ch: g(f["Communication Channels"]), ph: gs(f["Phone"]),
        cph: f["Chưa phản hồi"] === true,
      });
    }
    if (!d.data?.has_more) break; pt = d.data.page_token;
  }
  const asOf = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
  return NextResponse.json({ asOf, leads });
}
