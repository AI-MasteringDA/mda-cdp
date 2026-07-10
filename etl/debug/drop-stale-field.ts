/** One-off: delete the stale "Đã xin info" column (replaced by "Chưa xin info"). */
import { admin as _a } from "../lib/supabase-admin";
void _a;

const LARK_APP_ID = process.env.LARK_APP_ID || "";
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || "";
const APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || "";
const BASE_URL = "https://open.larksuite.com/open-apis";
const STALE = "Đã xin info";

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
  const fRes = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields?page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  const field = fRes.data?.items?.find((f: { field_name: string }) => f.field_name === STALE);
  if (!field) { console.log(`Field "${STALE}" not found — nothing to do.`); return; }
  const del = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields/${field.field_id}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  console.log(del.code === 0 ? `✅ Deleted stale field "${STALE}"` : `⚠️ ${JSON.stringify(del).slice(0, 200)}`);
}
main().catch(e => { console.error(e); process.exit(1); });
