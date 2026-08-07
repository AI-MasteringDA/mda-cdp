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
const FIELDS = ["Lead Name", "Báo cáo ngày", "Hot Lead lúc", "Tag SMAX", "Communication Channels", "Phone", "Chưa phản hồi"];

type Cell = unknown;
type LarkRecord = { fields?: Record<string, Cell> };
const g = (v: Cell): string[] => Array.isArray(v) ? v.map((x) => (typeof x === "object" && x !== null ? ((x as { text?: string; name?: string }).text ?? (x as { name?: string }).name ?? "") : String(x))).filter(Boolean) : [];
const gs = (v: Cell): string => Array.isArray(v) ? (v as { text?: string }[]).map((x) => x?.text ?? "").join("") : (v == null ? "" : String(v));
const vnDate = (ms: Cell): string | null => typeof ms === "number" ? new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10) : null;
const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

function toLead(f: Record<string, Cell>, cutoff: string) {
  const bc = vnDate(f["Báo cáo ngày"]), ha = vnDate(f["Hot Lead lúc"]);
  if ((!bc || bc < cutoff) && (!ha || ha < cutoff)) return null;
  const tags = g(f["Tag SMAX"]);
  return {
    n: gs(f["Lead Name"]) || "(?)", d: bc, ha,
    cls: tags.map(t => ({ hotlead: "H", coldlead: "C", warmlead: "W", prospect: "P" } as Record<string, string>)[norm(t)]).filter(Boolean),
    bi: tags.some(t => /^kh?\d{2,3}$/i.test(t.trim())),
    fa: tags.some(t => /^f\d(\.\d)?$/i.test(t.trim())),
    ch: g(f["Communication Channels"]), ph: gs(f["Phone"]),
    cph: f["Chưa phản hồi"] === true,
  };
}

export async function GET() {
  const ID = process.env.LARK_APP_ID, SEC = process.env.LARK_APP_SECRET, APP = process.env.LARK_BASE_APP_TOKEN;
  if (!ID || !SEC || !APP) return NextResponse.json({ error: "missing lark env" }, { status: 500 });

  const auth = await fetch(`${U}/auth/v3/tenant_access_token/internal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: ID, app_secret: SEC }), cache: "no-store" }).then(r => r.json());
  const tk = auth.tenant_access_token;
  if (!tk) return NextResponse.json({ error: "lark auth failed" }, { status: 502 });
  const H = { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" };

  const tR = await fetch(`${U}/bitable/v1/apps/${APP}/tables?page_size=100`, { headers: H, cache: "no-store" }).then(r => r.json());
  const db = tR.data?.items?.find((t: { name: string; table_id: string }) => t.name === "SMAX_Database")?.table_id;
  if (!db) return NextResponse.json({ error: "SMAX_Database not found" }, { status: 502 });

  const cutoffMs = Date.now() - 40 * 86400_000;
  const cutoff = new Date(cutoffMs + 7 * 3600_000).toISOString().slice(0, 10);
  const leads: unknown[] = [];

  // Nhanh: search có filter (bc > cutoff OR hot-lúc > cutoff)
  let searched = false;
  try {
    let pt: string | undefined; let pages = 0;
    while (pages < 20) {
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

  const asOf = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
  return NextResponse.json({ asOf, leads }, { headers: { "Cache-Control": "private, max-age=120" } });
}
