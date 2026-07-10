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
  if (!table) { console.log("❌ SMAX_Database not found"); process.exit(1); }

  const fRes = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/fields?page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  const hasId = fRes.data?.items?.some((f: { field_name: string }) => f.field_name === "ID");
  if (!hasId) { console.log("❌ ID column not yet created"); process.exit(1); }

  // Fetch a few rows to check ID populated
  const rows = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/records?page_size=20`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  const items = rows.data?.items || [];
  const withId = items.filter((r: { fields: Record<string, unknown> }) => {
    const v = r.fields?.ID;
    return typeof v === "string" && v.length > 0;
  });
  if (withId.length === 0) { console.log(`⚠️ ID column exists but 0/${items.length} rows populated`); process.exit(2); }

  console.log(`✅ ID column exists and populated in ${withId.length}/${items.length} sampled rows`);
  console.log(`\nSample 5 rows with ID:`);
  withId.slice(0, 5).forEach((r: { fields: Record<string, unknown> }) =>
    console.log(`  • ${String(r.fields["Lead Name"] || "").padEnd(30)}  ID=${r.fields.ID}`)
  );
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(3); });
