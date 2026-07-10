/**
 * One-time LOCAL backfill: fill "Chat History 1..5" for every SMAX_Database
 * row that doesn't have chat yet. Run from your machine (takes ~30-60 min for
 * 9k leads) — the 10-min GitHub workflow timeout can't fit this.
 *
 * Usage:
 *   npx tsx etl/debug/backfill-chat-history.ts            # only rows missing chat
 *   LIMIT=20 npx tsx etl/debug/backfill-chat-history.ts   # smoke test on 20 rows
 *   ALL=1 npx tsx etl/debug/backfill-chat-history.ts      # rebuild everyone
 */
import { admin } from "../lib/supabase-admin";
import { buildChatHistoryFields, getThreadsForLeads } from "../lib/smax-chat";

const LARK_APP_ID = process.env.LARK_APP_ID || "";
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || "";
const APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || "";
const BASE_URL = "https://open.larksuite.com/open-apis";
const LIMIT = Number(process.env.LIMIT || 0);
const ALL = process.env.ALL === "1";

async function getToken(): Promise<string> {
  const r = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET }),
  }).then(x => x.json());
  return r.tenant_access_token;
}

async function main() {
  const token = await getToken();
  const tRes = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables?page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  const tableId = tRes.data.items.find((t: { name: string }) => t.name === "SMAX_Database").table_id;

  // 1. All Lark rows: record_id, Lead ID, has chat?, external pid via "ID" col? (we need pid from DB)
  console.log("Reading Lark rows...");
  const rows: Array<{ record_id: string; leadId: string; hasChat: boolean }> = [];
  let pageToken: string | undefined;
  while (true) {
    const url = new URL(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`);
    url.searchParams.set("page_size", "500");
    url.searchParams.set("field_names", JSON.stringify(["Lead ID", "Chat History 1"]));
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
    for (const r of res.data?.items ?? []) {
      const leadId = typeof r.fields?.["Lead ID"] === "string" ? r.fields["Lead ID"]
        : Array.isArray(r.fields?.["Lead ID"]) ? (r.fields["Lead ID"][0]?.text ?? "") : "";
      if (!leadId) continue;
      rows.push({ record_id: r.record_id, leadId, hasChat: !!r.fields?.["Chat History 1"] });
    }
    if (!res.data?.has_more) break;
    pageToken = res.data.page_token;
  }
  let targets = ALL ? rows : rows.filter(r => !r.hasChat);
  if (LIMIT > 0) targets = targets.slice(0, LIMIT);
  console.log(`Lark rows: ${rows.length}  ·  to backfill: ${targets.length}`);
  if (targets.length === 0) return;

  // 2. pid per lead from dim_lead (batched)
  console.log("Loading external pids from dim_lead...");
  const pidByLead = new Map<string, string | null>();
  const leadIds = targets.map(t => t.leadId);
  for (let i = 0; i < leadIds.length; i += 100) {
    const batch = leadIds.slice(i, i + 100);
    const { data } = await admin.from("dim_lead").select("lead_id, external_profile_id").in("lead_id", batch);
    for (const l of data ?? []) pidByLead.set(l.lead_id, l.external_profile_id);
  }

  // 3. Resolve threads (batched 100 per query inside)
  console.log("Resolving chat threads...");
  const threadsByLead = await getThreadsForLeads(admin as never, leadIds, pidByLead);
  console.log(`   threads resolved for ${threadsByLead.size} leads`);

  // 4. Fetch + write, small parallel batches
  const CONC = 8;
  let done = 0, written = 0, empty = 0;
  const pending: Array<{ record_id: string; fields: Record<string, unknown> }> = [];

  async function flush() {
    while (pending.length >= 400) {
      const chunk = pending.splice(0, 400);
      const res = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_update`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ records: chunk }),
      }).then(r => r.json());
      if (res.code === 0) written += chunk.length;
      else console.warn(`   ⚠️ batch_update: ${JSON.stringify(res).slice(0, 150)}`);
      await new Promise(r => setTimeout(r, 400));
    }
  }

  for (let i = 0; i < targets.length; i += CONC) {
    const batch = targets.slice(i, i + CONC);
    const results = await Promise.all(batch.map(async (t) => {
      const threads = threadsByLead.get(t.leadId) ?? [];
      if (!threads.length) return null;
      const chat = await buildChatHistoryFields(threads);
      if (chat.messageCount === 0) return null;
      return {
        record_id: t.record_id,
        fields: { ...chat.fields, "Chưa phản hồi": chat.lastFromCustomer },
      };
    }));
    for (const r of results) {
      if (r) pending.push(r);
      else empty++;
    }
    done += batch.length;
    if (done % 200 === 0 || done >= targets.length) {
      console.log(`   ${done}/${targets.length} processed · ${pending.length + written} with chat · ${empty} empty`);
      await flush();
    }
  }
  // final flush (any remainder)
  while (pending.length > 0) {
    const chunk = pending.splice(0, 400);
    const res = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_update`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: chunk }),
    }).then(r => r.json());
    if (res.code === 0) written += chunk.length;
    else console.warn(`   ⚠️ batch_update: ${JSON.stringify(res).slice(0, 150)}`);
  }
  console.log(`\n✅ Backfill done: ${written} rows got chat history · ${empty} had no reachable thread`);
}
main().catch(e => { console.error(e); process.exit(1); });
