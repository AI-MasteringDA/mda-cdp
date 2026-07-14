/**
 * One-time sync: set "Chưa phản hồi" from Event for rows that never got the
 * chat-based flag (no Chat History → cust-only/unreachable threads).
 * Rows WITH chat keep their chat-derived value — the 15-min push maintains
 * them from now on (event-based, chat-override for refreshed leads).
 */
import { admin } from "../lib/supabase-admin";

const LARK_APP_ID = process.env.LARK_APP_ID || "";
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || "";
const APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || "";
const BASE_URL = "https://open.larksuite.com/open-apis";

async function main() {
  // 1. lead_id → event_type from the snapshot view
  const eventByLead = new Map<string, string>();
  let from = 0;
  while (from < 20000) {
    const { data } = await admin
      .from("v_smax_lead_snapshot")
      .select("lead_id, event_type")
      .range(from, from + 999);
    if (!data?.length) break;
    for (const r of data) eventByLead.set(r.lead_id, r.event_type ?? "");
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`View rows: ${eventByLead.size}`);

  // 2. Lark rows
  const auth = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET }),
  }).then(r => r.json());
  const token = auth.tenant_access_token;
  const tRes = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables?page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  const tableId = tRes.data.items.find((t: { name: string }) => t.name === "SMAX_Database").table_id;

  const updates: Array<{ record_id: string; fields: Record<string, unknown> }> = [];
  let hasChatSkipped = 0, alreadyOk = 0;
  let pageToken: string | undefined;
  while (true) {
    const url = new URL(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`);
    url.searchParams.set("page_size", "500");
    url.searchParams.set("field_names", JSON.stringify(["Lead ID", "Chưa phản hồi", "Chat History 1"]));
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
    for (const rec of res.data?.items ?? []) {
      const leadId = typeof rec.fields?.["Lead ID"] === "string" ? rec.fields["Lead ID"]
        : Array.isArray(rec.fields?.["Lead ID"]) ? (rec.fields["Lead ID"][0]?.text ?? "") : "";
      if (!leadId) continue;
      const hasChat = !!rec.fields?.["Chat History 1"];
      if (hasChat) { hasChatSkipped++; continue; } // chat-based value is better — keep
      const ev = eventByLead.get(leadId);
      if (ev === undefined) continue;
      const target = ev === "chat";
      const current = rec.fields?.["Chưa phản hồi"] === true;
      if (current === target) { alreadyOk++; continue; }
      updates.push({ record_id: rec.record_id, fields: { "Chưa phản hồi": target } });
    }
    if (!res.data?.has_more) break;
    pageToken = res.data.page_token;
  }
  console.log(`Skip (has chat, keep chat-based): ${hasChatSkipped}`);
  console.log(`Already correct: ${alreadyOk}`);
  console.log(`To update: ${updates.length}`);

  let written = 0;
  for (let i = 0; i < updates.length; i += 400) {
    const chunk = updates.slice(i, i + 400);
    const res = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_update`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: chunk }),
    }).then(r => r.json());
    if (res.code === 0) written += chunk.length;
    else console.warn(`⚠️ ${JSON.stringify(res).slice(0, 120)}`);
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`✅ Updated ${written} rows`);
}
main().catch(e => { console.error(e); process.exit(1); });
