import { admin as _admin } from "../lib/supabase-admin";
void _admin;
const LARK_APP_ID = process.env.LARK_APP_ID || "";
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || "";
const APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || "";
const BASE_URL = "https://open.larksuite.com/open-apis";

async function main() {
  const auth = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET }),
  }).then(r => r.json());
  const token = auth.tenant_access_token;
  console.log("APP_TOKEN =", APP_TOKEN);
  console.log("Got token:", !!token);

  const res = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables?page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  console.log("\nAll tables in this Base:");
  res.data?.items?.forEach((t: any) => console.log(`  • "${t.name}"  (${t.table_id})`));
  if (!res.data?.items?.length) console.log("  (none — raw response:", JSON.stringify(res).slice(0, 400), ")");
}
main().catch(e => { console.error(e); process.exit(1); });
