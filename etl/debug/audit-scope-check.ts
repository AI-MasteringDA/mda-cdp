import { admin as _a } from "../lib/supabase-admin";
void _a;

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
  const tRes = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables?page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  const tableId = tRes.data.items.find((t: { name: string }) => t.name === "SMAX_Database").table_id;

  const twoWeeksAgo = Date.now() - 14 * 86400_000;
  let total2w = 0, noContact = 0, noContactWithChat = 0, unreplied = 0;
  let pageToken: string | undefined;
  while (true) {
    const url = new URL(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`);
    url.searchParams.set("page_size", "500");
    url.searchParams.set("field_names", JSON.stringify(["Time", "Email", "Phone", "Chat History 1", "Chưa phản hồi"]));
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
    for (const r of res.data?.items ?? []) {
      const t = typeof r.fields?.Time === "number" ? r.fields.Time : 0;
      if (t < twoWeeksAgo) continue;
      total2w++;
      const hasContact = !!(r.fields?.Email || r.fields?.Phone);
      const hasChat = !!r.fields?.["Chat History 1"];
      if (!hasContact) { noContact++; if (hasChat) noContactWithChat++; }
      if (r.fields?.["Chưa phản hồi"] === true) unreplied++;
    }
    if (!res.data?.has_more) break;
    pageToken = res.data.page_token;
  }
  console.log(`Leads active last 14 days:        ${total2w}`);
  console.log(`  ├─ no email AND no phone:       ${noContact}`);
  console.log(`  │   └─ of those, has chat:      ${noContactWithChat}  ← cần AI đọc chat`);
  console.log(`  └─ đang "Chưa phản hồi":        ${unreplied}`);
}
main().catch(e => { console.error(e); process.exit(1); });
