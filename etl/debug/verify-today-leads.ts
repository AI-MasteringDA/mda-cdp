import { admin as _a } from "../lib/supabase-admin";
void _a;

const LARK_APP_ID = process.env.LARK_APP_ID || "";
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || "";
const APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || "";
const BASE_URL = "https://open.larksuite.com/open-apis";

// The 8 leads visible in the user's SMAX screenshot (Jul 10 afternoon VN)
const EXPECTED = [
  "Huan Dong", "My Huỳnh", "Kirsty", "Nguyễn Hải Anh",
  "Dtphuongvy", "Hoài Vy", "Tran Le Quyen", "Hoang Khanh",
];

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

  // Scan all rows, index by name; track today's rows
  const todayStart = new Date("2026-07-10T00:00:00+07:00").getTime();
  const found = new Map<string, { time: string; chat1: boolean }>();
  let todayCount = 0;
  let pageToken: string | undefined;
  let hasChatCols = false;
  while (true) {
    const url = new URL(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`);
    url.searchParams.set("page_size", "500");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
    for (const r of res.data?.items ?? []) {
      const name = String(r.fields?.["Lead Name"] || "");
      const t = typeof r.fields?.Time === "number" ? r.fields.Time : 0;
      if (r.fields?.["Chat History 1"]) hasChatCols = true;
      if (t >= todayStart) todayCount++;
      for (const exp of EXPECTED) {
        if (name.toLowerCase().includes(exp.toLowerCase())) {
          // A person can have multiple rows (multiple SMAX nicks) — keep the
          // NEWEST row so we compare against their latest activity.
          const prev = found.get(exp);
          const prevMs = prev ? Date.parse("2026-" + prev.time.slice(0, 11).replace(" ", "T") + ":00+07:00") : 0;
          if (prev && prevMs >= t) continue;
          const iso = t ? new Date(t + 7 * 3600_000).toISOString().slice(5, 16).replace("T", " ") : "?";
          found.set(exp, { time: `${iso} VN`, chat1: !!r.fields?.["Chat History 1"] });
        }
      }
    }
    if (!res.data?.has_more) break;
    pageToken = res.data.page_token;
  }

  console.log(`Rows with Time >= today (Jul 10 VN): ${todayCount}`);
  console.log(`\nChecklist (8 leads from user's SMAX screenshot):`);
  for (const exp of EXPECTED) {
    const f = found.get(exp);
    console.log(`  ${f ? "✅" : "❌"} ${exp.padEnd(20)} ${f ? `Time=${f.time}  chat=${f.chat1 ? "có" : "chưa"}` : "NOT FOUND"}`);
  }
  console.log(`\nChat History columns exist & populated somewhere: ${hasChatCols ? "yes" : "no"}`);
}
main().catch(e => { console.error(e); process.exit(1); });
