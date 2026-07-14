/** Bao nhiêu lead thực sự chạm trần 5 cột chat? */
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
  const tRes = await fetch(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables?page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  const tableId = tRes.data.items.find((t: { name: string }) => t.name === "SMAX_Database").table_id;

  const buckets = [0, 0, 0, 0, 0, 0]; // số cột đã dùng: 0..5
  let truncated = 0, withChat = 0, maxLen = 0;
  const truncNames: string[] = [];
  let pageToken: string | undefined;
  while (true) {
    const url = new URL(`${BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`);
    url.searchParams.set("page_size", "500");
    url.searchParams.set("field_names", JSON.stringify([
      "Lead Name", "Chat History 1", "Chat History 2", "Chat History 3", "Chat History 4", "Chat History 5",
    ]));
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
    for (const rec of res.data?.items ?? []) {
      const cols = [1, 2, 3, 4, 5].map(i => String(rec.fields?.[`Chat History ${i}`] ?? ""));
      const used = cols.filter(c => c.length > 0).length;
      buckets[used]++;
      if (used > 0) withChat++;
      const total = cols.join("").length;
      if (total > maxLen) maxLen = total;
      if (cols[0].startsWith("(…đã lược bớt")) {
        truncated++;
        if (truncNames.length < 5) truncNames.push(String(rec.fields?.["Lead Name"] ?? ""));
      }
    }
    if (!res.data?.has_more) break;
    pageToken = res.data.page_token;
  }

  console.log(`Leads có chat history: ${withChat}`);
  console.log(`\nSố cột chat đã dùng:`);
  for (let i = 1; i <= 5; i++) {
    const pct = withChat ? ((buckets[i] / withChat) * 100).toFixed(1) : "0";
    console.log(`   ${i} cột: ${String(buckets[i]).padStart(5)}  (${pct}%)`);
  }
  console.log(`\n🚨 Bị cắt tin cũ (vượt 5 cột): ${truncated} leads` +
    (withChat ? ` (${((truncated / withChat) * 100).toFixed(2)}%)` : ""));
  if (truncNames.length) console.log(`   ví dụ: ${truncNames.join(", ")}`);
  console.log(`Chat dài nhất: ${maxLen.toLocaleString()} ký tự (trần: 47,500)`);
}
main().catch(e => { console.error(e); process.exit(1); });
