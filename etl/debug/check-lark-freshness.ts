/**
 * So cột "Time" trên Lark SMAX_Database vs last_message_at bên SMAX — dùng để
 * kiểm chứng cầu nối smax-lark-bridge.ts có thật sự đẩy data tươi hay không
 * (2026-08-17: từng báo "0 dòng cần cập nhật" trong khi Lark đứng ở 15/08).
 * Chạy: npx tsx etl/debug/check-lark-freshness.ts
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
const U = "https://open.larksuite.com/open-apis";
const ID = process.env.LARK_APP_ID!, SEC = process.env.LARK_APP_SECRET!, APP = process.env.LARK_BASE_APP_TOKEN!;
const T = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const B = process.env.SMAX_BASE_URL || "https://api.smax.ai";
const vn = (ms: number) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
(async () => {
  const a = await fetch(`${U}/auth/v3/tenant_access_token/internal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: ID, app_secret: SEC }) }).then(r => r.json());
  const tk = a.tenant_access_token;
  const tR = await fetch(`${U}/bitable/v1/apps/${APP}/tables?page_size=100`, { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
  const dbId = tR.data.items.find((t: any) => t.name === "SMAX_Database").table_id;
  let pt: string | undefined, maxT = 0, n = 0, cnt15 = 0, cnt16 = 0, cnt17 = 0;
  while (true) {
    const url = new URL(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/records`);
    url.searchParams.set("page_size", "500"); url.searchParams.set("field_names", JSON.stringify(["Time"]));
    if (pt) url.searchParams.set("page_token", pt);
    const d = await fetch(url.toString(), { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
    if (d.code !== 0) { console.log(`LARK LỖI: ${d.code} ${d.msg}`); break; }
    for (const r of d.data?.items || []) { const v = r.fields?.["Time"]; n++; if (typeof v === "number") { if (v > maxT) maxT = v; const day = vn(v).slice(0, 10); if (day === "2026-08-15") cnt15++; if (day === "2026-08-16") cnt16++; if (day === "2026-08-17") cnt17++; } }
    if (!d.data?.has_more) break; pt = d.data.page_token;
  }
  console.log(`LARK: đọc ${n} dòng | Time mới nhất = ${vn(maxT)} (VN)`);
  console.log(`      số dòng Time 15/08=${cnt15} · 16/08=${cnt16} · 17/08=${cnt17}`);
  const r = await fetch(`${B}/bizs/mastering-data-analytics/customers`, { method: "POST", headers: { Authorization: `Bearer ${T}`, "Content-Type": "application/json" }, body: JSON.stringify({ size: 10000 }) }).then(r => r.json());
  let sMax = 0, s15 = 0, s16 = 0, s17 = 0;
  for (const c of (r.data || [])) { const v = c.last_message_at ? new Date(c.last_message_at).getTime() : 0; if (v > sMax) sMax = v; const day = v ? vn(v).slice(0, 10) : ""; if (day === "2026-08-15") s15++; if (day === "2026-08-16") s16++; if (day === "2026-08-17") s17++; }
  console.log(`SMAX: ${(r.data || []).length} khách | last_message_at mới nhất = ${vn(sMax)} (VN)`);
  console.log(`      số khách nhắn 15/08=${s15} · 16/08=${s16} · 17/08=${s17}`);
})();
