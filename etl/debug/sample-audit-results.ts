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

  const samples: Array<{ name: string; note: string; time: string }> = [];
  let pageToken: string | undefined;
  while (samples.length < 10) {
    const url = new URL(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`);
    url.searchParams.set("page_size", "500");
    url.searchParams.set("field_names", JSON.stringify(["Lead Name", "Chưa xin info", "AI Note", "Time"]));
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
    for (const r of res.data?.items ?? []) {
      if (r.fields?.["Chưa xin info"] === true && samples.length < 10) {
        const t = typeof r.fields?.Time === "number" ? new Date(r.fields.Time + 7 * 3600_000).toISOString().slice(5, 16).replace("T", " ") : "?";
        samples.push({
          name: String(r.fields?.["Lead Name"] ?? ""),
          note: String(r.fields?.["AI Note"] ?? "").slice(0, 110),
          time: t,
        });
      }
    }
    if (!res.data?.has_more) break;
    pageToken = res.data.page_token;
  }
  console.log(`Sample "Chưa xin info" leads:`);
  samples.forEach(s => console.log(`  • ${s.name.slice(0, 28).padEnd(28)} ${s.time}  ${s.note}`));
}
main().catch(e => { console.error(e); process.exit(1); });
