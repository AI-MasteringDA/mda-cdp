/** Create filtered follow-up views on SMAX_Database. */
import { admin as _a } from "../lib/supabase-admin";
void _a;

const LARK_APP_ID = process.env.LARK_APP_ID || "";
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || "";
const APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || "";
const BASE_URL = "https://open.larksuite.com/open-apis";

const VIEWS: Array<{ name: string; filterField?: string }> = [
  { name: "🔴 Chưa phản hồi", filterField: "Chưa phản hồi" },
  { name: "🟡 Chưa xin info", filterField: "Chưa xin info" },
  { name: "🔵 Cần follow-up", filterField: "Cần follow-up" },
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

  // Existing views (idempotent)
  const vRes = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/views?page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  const existing = new Set((vRes.data?.items ?? []).map((v: { view_name: string }) => v.view_name));

  for (const v of VIEWS) {
    if (existing.has(v.name)) { console.log(`✓ view "${v.name}" exists`); continue; }
    const created = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/views`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ view_name: v.name, view_type: "grid" }),
    }).then(r => r.json());
    if (created.code !== 0) { console.warn(`⚠️ create "${v.name}": ${JSON.stringify(created).slice(0, 120)}`); continue; }
    const viewId = created.data.view.view_id;
    console.log(`✅ Created view "${v.name}"`);

    if (v.filterField) {
      // Try to set filter: checkbox is ticked. If the filter API shape is
      // rejected, the view still exists — user adds the filter in 2 clicks.
      const patch = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/views/${viewId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          property: {
            filter_info: {
              conjunction: "and",
              conditions: [{ field_name: v.filterField, operator: "is", value: ["true"] }],
            },
          },
        }),
      }).then(r => r.json());
      console.log(patch.code === 0
        ? `   ↳ filter set: "${v.filterField}" = ticked`
        : `   ↳ ⚠️ filter API rejected (${JSON.stringify(patch).slice(0, 100)}) — add filter manually`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
