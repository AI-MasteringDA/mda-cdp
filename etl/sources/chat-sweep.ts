/**
 * Vòng quét transcript xoay vòng — đảm bảo cột "Chat History" luôn bám SMAX,
 * không transcript nào cũ quá ~1 ngày.
 *
 * Vì sao cần: chat-refresh trong lark-push chỉ chạm lead VỪA ĐỔI (≤150/run), nên
 * lead im lâu rồi có tin mới ngoài cửa sổ 6h có thể bị bỏ sót → transcript cũ.
 * Vòng quét này mỗi lần chạy kéo lại 1 LÔ lead (offset lưu trong etl_state), xoay
 * hết bảng Lark sau ~1 ngày. Miễn phí (SMAX API), 0 Supabase-IO đáng kể.
 *
 * Chạy: npm run etl:chat:sweep   (cron mỗi giờ)
 */
import { admin } from "../lib/supabase-admin";
import { getThreadsForLeads, buildChatHistoryFields } from "../lib/smax-chat";

const LARK_APP_ID = process.env.LARK_APP_ID || "";
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || "";
const APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || "";
const BASE_URL = "https://open.larksuite.com/open-apis";
const BATCH = Number(process.env.CHAT_SWEEP_BATCH || 400);

function txt(v: unknown): string {
  return Array.isArray(v) ? (v as { text?: string }[]).map((x) => x?.text ?? "").join("") : (v == null ? "" : String(v));
}

export async function runChatSweep() {
  if (!LARK_APP_ID || !APP_TOKEN) { console.log("[chat-sweep] thiếu Lark creds, bỏ qua"); return; }
  const auth = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET }),
  }).then((r) => r.json());
  const token = auth.tenant_access_token;
  const tRes = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables?page_size=100`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const tableId = tRes.data.items.find((t: { name: string }) => t.name === "SMAX_Database").table_id;

  // Universe = mọi dòng Lark (lead_id → record_id + transcript hiện tại)
  const rows: Array<{ leadId: string; recordId: string; chat: string }> = [];
  let pageToken: string | undefined;
  while (true) {
    const url = new URL(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`);
    url.searchParams.set("page_size", "500");
    url.searchParams.set("field_names", JSON.stringify(["Lead ID", "Chat History 1", "Chat History 2", "Chat History 3", "Chat History 4", "Chat History 5"]));
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const d = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    for (const r of d.data?.items ?? []) {
      const leadId = txt(r.fields?.["Lead ID"]);
      if (leadId) rows.push({ leadId, recordId: r.record_id, chat: [1, 2, 3, 4, 5].map((i) => txt(r.fields?.[`Chat History ${i}`])).join("") });
    }
    if (!d.data?.has_more) break;
    pageToken = d.data.page_token;
  }
  rows.sort((a, b) => (a.leadId < b.leadId ? -1 : 1)); // thứ tự ổn định để xoay vòng

  // Offset xoay vòng trong etl_state
  const { data: off } = await admin.from("etl_state").select("value").eq("source", "chat_sweep").eq("key", "offset").maybeSingle();
  let offset = off?.value ? parseInt(off.value, 10) || 0 : 0;
  if (offset >= rows.length) offset = 0;
  const batch = rows.slice(offset, offset + BATCH);
  console.log(`[chat-sweep] ${rows.length} dòng · quét offset ${offset}..${offset + batch.length}`);

  // pid cho lô
  const leadIds = batch.map((b) => b.leadId);
  const pidByLead = new Map<string, string | null>();
  for (let i = 0; i < leadIds.length; i += 100) {
    const { data } = await admin.from("dim_lead").select("lead_id, external_profile_id").in("lead_id", leadIds.slice(i, i + 100));
    for (const l of data ?? []) pidByLead.set(l.lead_id, l.external_profile_id);
  }
  const threadsByLead = await getThreadsForLeads(admin as never, leadIds, pidByLead);

  // Kéo transcript + cập nhật dòng nào ĐỔI
  const updates: Array<{ record_id: string; fields: Record<string, unknown> }> = [];
  let checked = 0;
  const CONC = 8;
  for (let i = 0; i < batch.length; i += CONC) {
    const slice = batch.slice(i, i + CONC);
    await Promise.all(slice.map(async (b) => {
      checked++;
      const threads = threadsByLead.get(b.leadId) ?? [];
      if (threads.length === 0) return;
      const chat = await buildChatHistoryFields(threads);
      if (chat.messageCount === 0) return; // đừng ghi đè bằng rỗng
      const newChat = [1, 2, 3, 4, 5].map((k) => chat.fields[`Chat History ${k}`] ?? "").join("");
      if (newChat === b.chat) return; // không đổi → bỏ
      updates.push({ record_id: b.recordId, fields: { ...chat.fields, "Total Chats": chat.customerMsgCount } });
    }));
  }
  // ghi
  let written = 0;
  for (let i = 0; i < updates.length; i += 400) {
    const chunk = updates.slice(i, i + 400);
    const res = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_update`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ records: chunk }),
    }).then((r) => r.json());
    if (res.code === 0) written += chunk.length;
    await new Promise((r) => setTimeout(r, 300));
  }

  const nextOffset = offset + batch.length >= rows.length ? 0 : offset + batch.length;
  await admin.from("etl_state").upsert({ source: "chat_sweep", key: "offset", value: String(nextOffset), updated_at: new Date().toISOString() }, { onConflict: "source,key" });
  console.log(`[chat-sweep] kiểm ${checked} · cập nhật ${written} transcript · offset kế ${nextOffset}`);
}

runChatSweep().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
