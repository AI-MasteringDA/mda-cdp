import { admin as _a } from "../lib/supabase-admin";
void _a;

const LARK_APP_ID = process.env.LARK_APP_ID || "";
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || "";
const APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || "";
const BASE_URL = "https://open.larksuite.com/open-apis";

async function getToken(): Promise<string> {
  const auth = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET }),
  }).then(r => r.json());
  return auth.tenant_access_token;
}

async function main() {
  const token = await getToken();
  const tRes = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables?page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  const table = tRes.data?.items?.find((t: { name: string }) => t.name === "SMAX_Database");

  const rows = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/records?page_size=3`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  console.log("First 3 rows — raw fields:");
  rows.data?.items?.slice(0, 3).forEach((r: { record_id: string; fields: Record<string, unknown> }, i: number) => {
    console.log(`\n--- Row ${i + 1} record_id=${r.record_id} ---`);
    for (const [k, v] of Object.entries(r.fields)) {
      console.log(`  ${k.padEnd(15)}  type=${typeof v}  ${JSON.stringify(v).slice(0, 100)}`);
    }
  });
}
main().catch(e => { console.error(e); process.exit(1); });
