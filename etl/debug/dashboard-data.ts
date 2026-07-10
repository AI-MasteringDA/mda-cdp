/** Pull dashboard metrics from Lark SMAX_Database → JSON for the artifact. */
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

  const cutoff14 = Date.now() - 14 * 86400_000;
  const byDay = new Map<string, number>();
  const tagCount = new Map<string, number>();
  const unrepliedLeads: Array<{ name: string; time: number; phone: string }> = [];
  const unaskedLeads: Array<{ name: string; time: number; note: string }> = [];
  let total2w = 0, unreplied2w = 0, unasked2w = 0, hasContact2w = 0, followup2w = 0;

  let pageToken: string | undefined;
  while (true) {
    const url = new URL(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`);
    url.searchParams.set("page_size", "500");
    url.searchParams.set("field_names", JSON.stringify([
      "Time", "Lead Name", "Email", "Phone", "Tag SMAX",
      "Chưa phản hồi", "Chưa xin info", "Cần follow-up", "AI Note",
    ]));
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
    for (const r of res.data?.items ?? []) {
      const t = typeof r.fields?.Time === "number" ? r.fields.Time : 0;
      if (t < cutoff14) continue;
      total2w++;
      const name = String(r.fields?.["Lead Name"] ?? "");
      const day = new Date(t + 7 * 3600_000).toISOString().slice(5, 10); // MM-DD VN
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
      const tags = Array.isArray(r.fields?.["Tag SMAX"]) ? r.fields["Tag SMAX"] : [];
      for (const tg of tags) tagCount.set(String(tg), (tagCount.get(String(tg)) ?? 0) + 1);
      if (r.fields?.Email || r.fields?.Phone) hasContact2w++;
      if (r.fields?.["Cần follow-up"] === true) followup2w++;
      if (r.fields?.["Chưa phản hồi"] === true) {
        unreplied2w++;
        unrepliedLeads.push({ name, time: t, phone: String(r.fields?.Phone ?? "") });
      }
      if (r.fields?.["Chưa xin info"] === true) {
        unasked2w++;
        unaskedLeads.push({ name, time: t, note: String(r.fields?.["AI Note"] ?? "").slice(0, 120) });
      }
    }
    if (!res.data?.has_more) break;
    pageToken = res.data.page_token;
  }

  unrepliedLeads.sort((a, b) => b.time - a.time);
  unaskedLeads.sort((a, b) => b.time - a.time);
  const topTags = Array.from(tagCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const days = Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    window: "14d",
    total2w, unreplied2w, unasked2w, hasContact2w, followup2w,
    contactRate: Math.round((hasContact2w / Math.max(total2w, 1)) * 100),
    days, topTags,
    unrepliedTop: unrepliedLeads.slice(0, 15),
    unaskedTop: unaskedLeads.slice(0, 15),
  }, null, 1));
}
main().catch(e => { console.error(e); process.exit(1); });
