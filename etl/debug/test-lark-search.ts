/** Verify the Lark search-API call shape used by lib/smax-audit.ts */
import { admin as _a } from "../lib/supabase-admin";
void _a;

const BASE = "https://open.larksuite.com/open-apis";
const APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || "";

async function main() {
  const auth = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: process.env.LARK_APP_ID, app_secret: process.env.LARK_APP_SECRET }),
  }).then(r => r.json());
  const token = auth.tenant_access_token;
  const tables = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables?page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  const tableId = tables.data.items.find((t: { name: string }) => t.name === "SMAX_Database").table_id;

  const cutoffMs = Date.now() - 14 * 86400_000;
  const res = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      field_names: ["Lead ID", "Chưa xin info", "Chưa phản hồi", "AI Note"],
      filter: {
        conjunction: "and",
        conditions: [{ field_name: "Time", operator: "isGreater", value: ["ExactDate", String(cutoffMs)] }],
      },
      page_size: 500,
    }),
  }).then(r => r.json());

  console.log("code:", res.code, res.msg ?? "");
  console.log("items:", res.data?.items?.length, "has_more:", res.data?.has_more, "total:", res.data?.total);
  const first = res.data?.items?.[0];
  if (first) {
    console.log("sample fields:", JSON.stringify(first.fields).slice(0, 300));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
