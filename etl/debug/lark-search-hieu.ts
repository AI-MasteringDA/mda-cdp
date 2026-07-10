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
  const tableId = table.table_id;

  let pageToken: string | undefined;
  let totalRows = 0;
  const targets: Array<Record<string, unknown>> = [];
  while (true) {
    const url = new URL(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`);
    url.searchParams.set("page_size", "500");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    const items = data.data?.items || [];
    totalRows += items.length;
    for (const r of items) {
      const email = String(r.fields?.Email || "").toLowerCase();
      const name = String(r.fields?.["Lead Name"] || "");
      if (email.includes("hieupd054") || name === "Đức Hiếu" || name === "Hiếu Phạm") {
        targets.push({
          name,
          email: r.fields?.Email,
          phone: r.fields?.Phone,
          tags: r.fields?.["Tag SMAX"],
          time: r.fields?.Time ? new Date(r.fields.Time as number).toISOString() : null,
          chats: r.fields?.["Total Chats"],
        });
      }
    }
    if (!data.data?.has_more) break;
    pageToken = data.data.page_token;
  }

  console.log(`SMAX_Database total rows: ${totalRows}`);
  console.log(`\n🎯 Matches for Đức Hiếu / Hiếu Phạm / hieupd054@gmail.com:`);
  for (const t of targets) console.log(JSON.stringify(t, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
