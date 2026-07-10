/** One-off: ensure the audit columns exist NOW + drop unwanted "Đủ tag SMAX". */
import { admin as _a } from "../lib/supabase-admin";
void _a;

const LARK_APP_ID = process.env.LARK_APP_ID || "";
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || "";
const APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || "";
const BASE_URL = "https://open.larksuite.com/open-apis";

const WANT = [
  { field_name: "Chưa phản hồi", type: 7 },
  { field_name: "Chưa xin info", type: 7 },
  { field_name: "Cần follow-up", type: 7 },
  { field_name: "AI Note", type: 1 },
];
const DROP = ["Đủ tag SMAX"];

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
  const existing = new Map<string, string>(
    (fRes.data?.items ?? []).map((f: { field_name: string; field_id: string }) => [f.field_name, f.field_id])
  );

  for (const f of WANT) {
    if (existing.has(f.field_name)) { console.log(`✓ "${f.field_name}" already exists`); continue; }
    const res = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ field_name: f.field_name, type: f.type }),
    }).then(r => r.json());
    console.log(res.code === 0 ? `✅ Created "${f.field_name}"` : `⚠️ create "${f.field_name}": ${JSON.stringify(res).slice(0, 150)}`);
    await new Promise(r => setTimeout(r, 300));
  }

  for (const name of DROP) {
    const id = existing.get(name);
    if (!id) { console.log(`✓ "${name}" not present — nothing to drop`); continue; }
    const res = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields/${id}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());
    console.log(res.code === 0 ? `🗑️ Dropped "${name}"` : `⚠️ drop "${name}": ${JSON.stringify(res).slice(0, 150)}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
