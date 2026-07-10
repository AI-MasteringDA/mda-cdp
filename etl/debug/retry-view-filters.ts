import { admin as _a } from "../lib/supabase-admin";
void _a;

const LARK_APP_ID = process.env.LARK_APP_ID || "";
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || "";
const APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || "";
const BASE_URL = "https://open.larksuite.com/open-apis";

const TARGETS: Array<{ view: string; field: string }> = [
  { view: "🔴 Chưa phản hồi", field: "Chưa phản hồi" },
  { view: "🟡 Chưa xin info", field: "Chưa xin info" },
  { view: "🔵 Cần follow-up", field: "Cần follow-up" },
];

async function main() {
  const auth = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET }),
  }).then(r => r.json());
  const token = auth.tenant_access_token;
  const tRes = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables?page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  const tableId = tRes.data.items.find((t: { name: string }) => t.name === "SMAX_Database").table_id;
  const vRes = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/views?page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  const viewIdByName = new Map<string, string>(
    (vRes.data?.items ?? []).map((v: { view_name: string; view_id: string }) => [v.view_name, v.view_id])
  );

  // Try a few filter value encodings until one sticks
  const variants: Array<(field: string) => unknown> = [
    (f) => ({ conjunction: "and", conditions: [{ field_name: f, operator: "is", value: [true] }] }),
    (f) => ({ conjunction: "and", conditions: [{ field_name: f, operator: "is", value: true }] }),
    (f) => ({ conjunction: "and", conditions: [{ field_name: f, operator: "isNotEmpty" }] }),
  ];

  for (const t of TARGETS) {
    const viewId = viewIdByName.get(t.view);
    if (!viewId) { console.log(`⚠️ view "${t.view}" missing`); continue; }
    let ok = false;
    for (const [i, mk] of variants.entries()) {
      const res = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/views/${viewId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ property: { filter_info: mk(t.field) } }),
      }).then(r => r.json());
      if (res.code === 0) { console.log(`✅ "${t.view}" filter set (variant ${i + 1})`); ok = true; break; }
    }
    if (!ok) console.log(`⚠️ "${t.view}": all variants rejected — add filter by hand`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
