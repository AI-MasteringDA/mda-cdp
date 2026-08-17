import { admin } from "../lib/supabase-admin";
import { buildChatHistoryFields, getThreadsForLeads, CHAT_COL_NAMES } from "../lib/smax-chat";

/**
 * Push MDA CDP data to Lark Base tables.
 * 4 channel tables: SMAX, Salesforce, Instantly, Wix
 * Each row = 1 touchpoint (event).
 * Full refresh strategy: delete all + reinsert (idempotent, no state).
 */

const LARK_APP_ID = process.env.LARK_APP_ID || "";
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || "";
const APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || "";
const BASE_URL = "https://open.larksuite.com/open-apis";
const DAYS_TO_PUSH = Number(process.env.LARK_DAYS_TO_PUSH || 365);

// Lark free tier caps at 20,000 records per table. For Instantly which
// has 29k+ touchpoints in 365 days, use a shorter window that fits the cap.
const DAYS_PER_SOURCE: Record<string, number> = {
  instantly: Number(process.env.LARK_DAYS_INSTANTLY || 60),
};

// Bảng nào cần tự "xoay vòng" (xoá cũ nhất khi gần chạm giới hạn cứng của
// Lark). Chừa biên 500 dưới mức 20.000 thật để không bao giờ chạm sát cạnh.
const MAX_RECORDS_PER_SOURCE: Record<string, number> = {
  instantly: 19_500,
};

/**
 * "Chốt" quyền chạy 1 tác vụ nặng — tác vụ chỉ thực sự thực thi nếu đã cách
 * lần trước ÍT NHẤT `minGapMs`, bất kể cron ngoài gọi function này thường
 * xuyên thế nào. Dùng lại bảng etl_state đã có sẵn (không cần bảng mới).
 *
 * Vì sao cần: hai việc nặng trong file này (full-refresh snapshot 9k lead,
 * pull toàn bộ hot-leads) vốn được "khoá nhịp" ngầm bằng chu kỳ cron 15 phút
 * (đủ chậm để chúng không lặp vô ích). Khi cron được bơm nhanh hơn (7 phút),
 * khoá ngầm đó mất tác dụng — các việc nặng lặp lại nhiều lần trong cùng 1
 * cửa sổ, nhân egress lên đúng lúc Supabase đã vượt quota (phát hiện
 * 2026-07-16). Giờ khoá tường minh bằng etl_state thay vì dựa vào nhịp cron.
 */
async function claimIfDue(source: string, key: string, minGapMs: number): Promise<boolean> {
  const { data } = await admin.from("etl_state").select("value").eq("source", source).eq("key", key).maybeSingle();
  const lastMs = data?.value ? new Date(data.value).getTime() : 0;
  if (Date.now() - lastMs < minGapMs) return false;
  await admin.from("etl_state").upsert(
    { source, key, value: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: "source,key" }
  );
  return true;
}

function daysForSource(source: string): number {
  return DAYS_PER_SOURCE[source] || DAYS_TO_PUSH;
}

const CHANNEL_TABLES: Record<string, string> = {
  smax: "SMAX_Database",
  salesforce: "Salesforce_Database",
  instantly: "Instantly_Database",
  web: "Wix_Database",
};

// Lark field types: 1=Text, 2=Number, 3=SingleSelect, 4=MultiSelect, 5=DateTime, 11=User
// Standard fields for each channel table
const STANDARD_FIELDS = [
  { field_name: "Time", type: 5, property: { date_formatter: "yyyy-MM-dd HH:mm", auto_fill: false } },
  { field_name: "Event", type: 1 },
  { field_name: "Lead Name", type: 1 },
  { field_name: "Email", type: 1 },
  { field_name: "Phone", type: 1 },
  { field_name: "Company", type: 1 },
  { field_name: "Stage", type: 1 },
  { field_name: "TVV", type: 1 },
  { field_name: "Tag SMAX", type: 4 },  // MultiSelect
  { field_name: "Title", type: 1 },
  { field_name: "Detail", type: 1 },
];

// SMAX_Database columns (LEAD SNAPSHOT — 1 row per unique lead, not per event)
// "Lead ID" holds dim_lead.lead_id UUID as a hidden stable key so the diff-based
// UPSERT can match Lark record ↔ DB lead. Users don't need to see it but it must
// exist for the push to work; sales can hide the column in their Lark view.
const SMAX_LEAD_FIELDS = [
  { field_name: "Time", type: 5, property: { date_formatter: "yyyy-MM-dd HH:mm", auto_fill: false } },
  { field_name: "Event", type: 1 },      // latest event type
  { field_name: "Lead Name", type: 1 },
  { field_name: "ID", type: 1 },         // SMAX platform-native customer ID (matches "Id" shown in SMAX UI)
  { field_name: "Email", type: 1 },
  { field_name: "Phone", type: 1 },
  { field_name: "Company", type: 1 },
  { field_name: "Stage", type: 1 },
  { field_name: "TVV", type: 1 },
  { field_name: "Tag SMAX", type: 4 },   // current tags
  { field_name: "Total Chats", type: 2 },
  { field_name: "Title", type: 1 },      // latest chat title
  { field_name: "Detail", type: 1 },     // latest chat detail
  { field_name: "Lead ID", type: 1 },    // dim_lead.lead_id UUID — key for diff-based UPSERT (safe to hide in view)
  // Full chat history split across 5 text cells (Lark caps a cell at 10k
  // chars). Newest-kept when longer. Populated for changed leads each run;
  // bulk backfill via etl/debug/backfill-chat-history.ts. Hide in Sales view.
  // "Chat History 1..5" đã bỏ 2026-08-17 — KHÔNG khai báo lại ở đây, nếu không
  // ensureFields() sẽ tự tạo lại 5 cột vừa xoá.
  // "Chưa phản hồi" is CODE-owned: ticked when the newest message in the chat
  // is from the customer (TVV hasn't replied). Computed deterministically from
  // the chat data during each push — no AI needed.
  { field_name: "Chưa phản hồi", type: 7 },   // Checkbox
  // Optional columns for the Claude connector to fill on-demand (user reads the
  // base via Claude chat, not a scheduled AI job — see 2026-07-27 decision to
  // drop the "Chưa xin info" auto-audit and rely on full chat history instead).
  { field_name: "Cần follow-up", type: 7 },   // Checkbox
  { field_name: "AI Note", type: 1 },
];

// SMAX platform prefixes to strip from external_profile_id so the value
// matches what SMAX's own UI displays (e.g. "zlw3882071168794108534" → "3882071168794108534").
const SMAX_ID_PREFIXES = ["zlw", "fb", "ig", "zl", "ctm"];
function stripSmaxIdPrefix(pid: string | null | undefined): string {
  if (!pid) return "";
  for (const p of SMAX_ID_PREFIXES) {
    if (pid.startsWith(p)) return pid.slice(p.length);
  }
  return pid;
}

// SMAX Hotleads table: dedup by lead (1 row per lead) — for Hoàng import to SF
const HOTLEADS_FIELDS = [
  { field_name: "Ngày", type: 5, property: { date_formatter: "yyyy-MM-dd HH:mm", auto_fill: false } },
  { field_name: "Tên", type: 1 },
  { field_name: "Email", type: 1 },
  { field_name: "SĐT", type: 1 },
  { field_name: "Tag SMAX", type: 4 },  // MultiSelect
  { field_name: "Platform", type: 3 },  // SingleSelect (facebook/zalo/zaloweb/instagram/custom)
  { field_name: "Score", type: 2 },
  { field_name: "Lead ID", type: 1 },   // dim_lead.lead_id UUID — UPSERT key
];

async function getToken(): Promise<string> {
  const res = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET }),
  });
  const data = await res.json();
  if (!data.tenant_access_token) throw new Error(`Lark auth failed: ${JSON.stringify(data)}`);
  return data.tenant_access_token;
}

async function listTables(token: string) {
  const res = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.data?.items || [];
}

async function createTable(token: string, name: string, fields: { field_name: string; type: number }[] = STANDARD_FIELDS): Promise<string> {
  const res = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      table: {
        name,
        default_view_name: "Grid",
        fields,
      },
    }),
  });
  const data = await res.json();
  if (!data.data?.table_id) throw new Error(`Create table failed: ${JSON.stringify(data)}`);
  console.log(`   ✅ Created table "${name}" (${data.data.table_id})`);
  return data.data.table_id;
}

/** Ô text của Lark có thể trả về mảng rich-text [{text}] — gộp lại thành chuỗi. */
function txtOf(v: unknown): string {
  if (Array.isArray(v)) return (v as { text?: string }[]).map(x => x?.text ?? "").join("");
  return v == null ? "" : String(v);
}

async function listFields(token: string, tableId: string) {
  // PHÂN TRANG bắt buộc: Lark mặc định chỉ trả ~20 field/lần. Nếu không lặp hết,
  // ensureFieldsExist tưởng field chưa có → tạo lại → cột trùng "(1)". Lỗi đọc
  // thì THROW (thà fail còn hơn sinh cột trùng).
  const items: { field_id: string; field_name: string; type: number }[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields`);
    url.searchParams.set("page_size", "100"); if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.code !== 0) throw new Error(`listFields failed: ${data.code} ${data.msg}`);
    items.push(...(data.data?.items || []));
    pageToken = data.data?.has_more ? data.data.page_token : undefined;
  } while (pageToken);
  return items;
}

async function createField(token: string, tableId: string, field: { field_name: string; type: number; property?: object }) {
  const body: Record<string, unknown> = { field_name: field.field_name, type: field.type };
  if (field.property) body.property = field.property;
  const res = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.code !== 0) console.warn(`   ⚠️ Create field "${field.field_name}" failed: ${JSON.stringify(data).slice(0, 200)}`);
}

async function updateFieldType(token: string, tableId: string, fieldId: string, field: { field_name: string; type: number; property?: object }) {
  const body: Record<string, unknown> = { field_name: field.field_name, type: field.type };
  if (field.property) body.property = field.property;
  const res = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields/${fieldId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.code !== 0) console.warn(`   ⚠️ Update field "${field.field_name}" failed: ${JSON.stringify(data).slice(0, 200)}`);
}

async function ensureFieldsExist(token: string, tableId: string, fields: { field_name: string; type: number; property?: object }[] = STANDARD_FIELDS) {
  const existingFields = await listFields(token, tableId) as { field_id: string; field_name: string; type: number }[];
  const existingByName = new Map(existingFields.map((f) => [f.field_name, f]));
  for (const std of fields) {
    const existing = existingByName.get(std.field_name);
    if (!existing) {
      await createField(token, tableId, std);
      await new Promise(r => setTimeout(r, 300));
    } else if (existing.type !== std.type) {
      // Type mismatch — Lark cannot change type once records exist. Only try if empty.
      console.log(`   ↻ Field "${std.field_name}" type=${existing.type}, need=${std.type} — attempting update...`);
      await updateFieldType(token, tableId, existing.field_id, std);
      await new Promise(r => setTimeout(r, 300));
    }
  }
}

async function listAllRecords(token: string, tableId: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (true) {
    const url = new URL(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`);
    url.searchParams.set("page_size", "500");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    const items = data.data?.items || [];
    ids.push(...items.map((r: { record_id: string }) => r.record_id));
    if (!data.data?.has_more) break;
    pageToken = data.data.page_token;
  }
  return ids;
}

/**
 * Xoay vòng bảng Lark khi gần chạm giới hạn cứng 20.000 dòng/bảng của Lark.
 *
 * Phát hiện 2026-07-20: Instantly_Database đã ĐẦY 20.000 dòng — MỌI insert từ
 * đó bị Lark từ chối ("RecordExceedLimit"), nên mốc "mới nhất" kẹt cứng ở
 * 07/07 mãi mãi (insert luôn fail nên incremental cutoff không bao giờ tiến
 * lên), và mỗi lần chạy vẫn tải lại HÀNG CHỤC NGÀN dòng từ Supabase cho một
 * việc luôn thất bại — lãng phí egress đúng lúc cần tiết kiệm.
 *
 * Cửa sổ theo NGÀY (DAYS_PER_SOURCE) không đáng tin vì lượng phát sinh dao
 * động (~1.6k-4.4k/ngày, đang tăng) — dùng cửa sổ theo SỐ DÒNG tự xoay vòng:
 * trước khi thêm mới, xoá bớt dòng CŨ NHẤT để luôn có chỗ, bất kể lượng data
 * tăng thế nào trong tương lai.
 */
async function pruneTableToFit(token: string, tableId: string, incomingCount: number, maxRecords: number) {
  const items: Array<{ record_id: string; time: number }> = [];
  let pageToken: string | undefined;
  while (true) {
    const url = new URL(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`);
    url.searchParams.set("page_size", "500");
    url.searchParams.set("field_names", JSON.stringify(["Time"]));
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    for (const r of data.data?.items || []) {
      const v = r.fields?.["Time"];
      items.push({ record_id: r.record_id, time: typeof v === "number" ? v : 0 });
    }
    if (!data.data?.has_more) break;
    pageToken = data.data.page_token;
  }

  const overBy = items.length + incomingCount - maxRecords;
  if (overBy <= 0) return;

  items.sort((a, b) => a.time - b.time); // cũ nhất trước
  const toDelete = items.slice(0, overBy).map((i) => i.record_id);
  console.log(`   ↳ Bảng có ${items.length} dòng, sắp thêm ${incomingCount} → vượt giới hạn ${maxRecords}. Xoá ${toDelete.length} dòng cũ nhất để lấy chỗ.`);
  for (let i = 0; i < toDelete.length; i += 500) {
    const batch = toDelete.slice(i, i + 500);
    await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_delete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: batch }),
    });
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function deleteAllRecords(token: string, tableId: string) {
  const ids = await listAllRecords(token, tableId);
  console.log(`   ↳ Delete ${ids.length} existing records...`);
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_delete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: batch }),
    });
    await new Promise(r => setTimeout(r, 300));
  }
}

/**
 * Get the max value of a DateTime field from a Lark table.
 * Used for incremental push: only insert records newer than what's already in Lark.
 */
async function getMaxDateTimeField(token: string, tableId: string, fieldName: string): Promise<number | null> {
  let pageToken: string | undefined;
  let maxMs = 0;
  let scanned = 0;
  const HARD_CAP = 25000;  // safety guard
  while (scanned < HARD_CAP) {
    const url = new URL(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`);
    url.searchParams.set("page_size", "500");
    // We only need the one field to speed up
    url.searchParams.set("field_names", JSON.stringify([fieldName]));
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    const items = data.data?.items || [];
    for (const r of items) {
      const val = r.fields?.[fieldName];
      const n = typeof val === "number" ? val : (typeof val === "string" ? new Date(val).getTime() : 0);
      if (n > maxMs) maxMs = n;
    }
    scanned += items.length;
    if (!data.data?.has_more) break;
    pageToken = data.data.page_token;
  }
  return maxMs > 0 ? maxMs : null;
}

/**
 * Fetch every record with its fields — used by diff-based UPSERT so we can
 * compare current Lark state to the new snapshot and only mutate what changed.
 */
async function listAllRecordsWithFields(token: string, tableId: string): Promise<Array<{ record_id: string; fields: Record<string, unknown> }>> {
  const out: Array<{ record_id: string; fields: Record<string, unknown> }> = [];
  let pageToken: string | undefined;
  while (true) {
    const url = new URL(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`);
    url.searchParams.set("page_size", "500");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    const items = data.data?.items || [];
    for (const it of items) out.push({ record_id: it.record_id, fields: it.fields || {} });
    if (!data.data?.has_more) break;
    pageToken = data.data.page_token;
  }
  return out;
}

async function updateRecords(token: string, tableId: string, updates: Array<{ record_id: string; fields: Record<string, unknown> }>) {
  let updated = 0;
  for (let i = 0; i < updates.length; i += 500) {
    const batch = updates.slice(i, i + 500);
    const res = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_update`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: batch }),
    });
    const data = await res.json();
    if (data.code === 0) updated += batch.length;
    else console.warn(`   ⚠️ Update batch failed: ${JSON.stringify(data).slice(0, 300)}`);
    await new Promise(r => setTimeout(r, 300));
  }
  return updated;
}

async function deleteRecords(token: string, tableId: string, recordIds: string[]) {
  let deleted = 0;
  for (let i = 0; i < recordIds.length; i += 500) {
    const batch = recordIds.slice(i, i + 500);
    const res = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_delete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: batch }),
    });
    const data = await res.json();
    if (data.code === 0) deleted += batch.length;
    else console.warn(`   ⚠️ Delete batch failed: ${JSON.stringify(data).slice(0, 300)}`);
    await new Promise(r => setTimeout(r, 300));
  }
  return deleted;
}

/**
 * Normalize a Lark field value into a JSON-serializable shape suitable for
 * equality comparison. Text fields come back as either a plain string OR as
 * [{type:'text', text:'...'}] wrappers depending on how they were written,
 * and multi-selects can be null vs [] — normalize both so we don't churn.
 */
function normalizeFieldValue(v: unknown): unknown {
  if (v == null || v === "") return null;
  // Lark OMITS unchecked checkboxes on read — treat false and absent as equal
  if (v === false) return null;
  // Lark rich-text array format: [{type:'text', text:'foo'}]
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null && "text" in (v[0] as Record<string, unknown>)) {
    return (v as Array<{ text: string }>).map(x => x.text).join("");
  }
  // MultiSelect array: sort for stable equality
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    return [...v].map(x => String(x)).sort();
  }
  // Always stringify scalars — Lark returns Number-type fields (e.g. "Total Chats")
  // as strings on read even though they accept numbers on write, so 50 !== "50"
  // would flag every row as changed.
  return String(v);
}

/**
 * Compare a new-record's fields to what's currently in Lark. Returns the
 * subset of fields that actually differ (so we send small patches, not full
 * row overwrites). Returns null if nothing differs — skip the update entirely.
 */
function diffFields(newFields: Record<string, unknown>, existingFields: Record<string, unknown>): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  let changed = false;
  for (const key of Object.keys(newFields)) {
    const a = normalizeFieldValue(newFields[key]);
    const b = normalizeFieldValue(existingFields[key]);
    let equal = false;
    if (a === b) equal = true;
    else if (Array.isArray(a) && Array.isArray(b)) equal = a.length === b.length && a.every((x, i) => x === b[i]);
    if (!equal) {
      patch[key] = newFields[key];
      changed = true;
    }
  }
  return changed ? patch : null;
}

async function insertRecords(token: string, tableId: string, records: unknown[]) {
  let inserted = 0;
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const res = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_create`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: batch.map(fields => ({ fields })) }),
    });
    const data = await res.json();
    if (data.code === 0) {
      inserted += batch.length;
    } else {
      console.warn(`   ⚠️ Insert batch failed: ${JSON.stringify(data).slice(0, 300)}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return inserted;
}

async function pushChannel(token: string, source: string, tableName: string) {
  console.log(`\n📦 [${source}] → ${tableName}`);

  // Env flag: LARK_FULL_REFRESH=1 forces delete-all-and-reinsert (slow but corrects drift)
  // Default: incremental — only insert touchpoints newer than what's already in Lark.
  const fullRefresh = process.env.LARK_FULL_REFRESH === "1";

  // Get or create table
  const tables = await listTables(token);
  let table = tables.find((t: { name: string }) => t.name === tableName);
  let tableId: string;
  let isNewTable = false;
  if (!table) {
    tableId = await createTable(token, tableName);
    isNewTable = true;
  } else {
    tableId = table.table_id;
  }

  // Cột "Tên SF" phải đảm bảo TRƯỚC các nhánh thoát sớm bên dưới, không thì
  // lần chạy nào không có dòng mới sẽ bỏ qua luôn việc tạo cột.
  if (source === "salesforce") {
    await ensureFieldsExist(token, tableId, [
      { field_name: "Tên SF", type: 1 },
      // "Relevant Leads" bên SF: các khoá CŨ của cùng một người (VD chị Thu Hà
      // → "K45 - 2024"). Có giá trị ⇒ KHÁCH QUAY LẠI, dashboard gắn nhãn reMKT
      // và KHÔNG đếm vào lead mới trong ngày. 47/263 lead 40 ngày rơi vào đây.
      { field_name: "Lead cũ (SF)", type: 1 },
      // Khoá + Rating BÊN SF. Không có 2 cột này thì lead chỉ-có-trên-SF không
      // lọc được theo khoá (K61…) và bị mặc định coi là Hot dù SF ghi Cold —
      // sai lệch khi đối chiếu với báo cáo Salesforce.
      { field_name: "Khoá (SF)", type: 1 },
      { field_name: "Rating (SF)", type: 1 },
    ]);
  }

  // Determine cutoff for pulling records
  const daysForThis = daysForSource(source);
  const daysCutoffMs = Date.now() - daysForThis * 86400_000;
  let cutoffMs = daysCutoffMs;
  let mode: "full" | "incremental" = "full";

  // KHÔNG dùng "mốc nước cao" (max Time trên Lark) làm cutoff nữa: nguồn trả sự
  // kiện KHÔNG theo thứ tự thời gian (SF gửi email lúc 07:00 nhưng sync về lúc
  // 9h; conversion dùng CloseDate lùi ngày) → mọi dòng cũ hơn mốc bị bỏ VĨNH VIỄN.
  // Đo 2026-08-10 ngày 06/08: email_sent 4/36, conversion 0/2 (mất sạch deal thắng).
  // Thay bằng: luôn kéo cửa sổ N ngày rồi KHỬ TRÙNG LẶP với dòng đã có trên Lark.
  void getMaxDateTimeField;

  const cutoff = new Date(cutoffMs).toISOString();
  console.log(`   ↳ Mode: ${mode} · cutoff: ${cutoff}`);

  // Pull touchpoints (paginated, Supabase 1000-row cap). Nếu nguồn có giới hạn
  // cứng số dòng trên Lark (maxRecords), DỪNG SỚM ngay khi đã đủ — bảng chỉ
  // giữ được tối đa maxRecords dòng nên kéo thêm cũng không bao giờ được chèn,
  // chỉ tốn egress Supabase vô ích (phát hiện 2026-07-20: Instantly kéo lại
  // 55k+ dòng mỗi lần chạy dù bảng Lark đã đầy, insert luôn fail).
  const maxRecords = MAX_RECORDS_PER_SOURCE[source];
  const rows: any[] = [];
  let from = 0;
  while (true) {
    const { data } = await admin.from("fact_touchpoint")
      .select("event_type, title, detail, occurred_at, payload, dim_lead(full_name, email, phone, company, stage, assignee, smax_tags)")
      .eq("source", source)
      .gt("occurred_at", cutoff)   // strict > to avoid duplicate at boundary
      .order("occurred_at", { ascending: false })
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
    if (maxRecords && rows.length >= maxRecords) break; // đủ dòng mới nhất rồi, dừng sớm
    from += 1000;
  }
  const truncated = maxRecords && rows.length > maxRecords;
  if (truncated) rows.length = maxRecords; // chỉ giữ mới nhất, phần cũ hơn vẫn an toàn trong Supabase
  console.log(`   ↳ Loaded ${rows.length} touchpoints ${mode === "incremental" ? "(new since last push)" : `(last ${daysForThis} days)`}${truncated ? ` — cắt bớt, bảng Lark chỉ giữ tối đa ${maxRecords} dòng` : ""}`);

  if (rows.length === 0) {
    console.log(`   ✓ Nothing new. Skipping.`);
    return;
  }

  // Transform to Lark records — DateTime fields as Unix milliseconds
  const allRecords = rows.map((r) => {
    const l = r.dim_lead || {};
    const tags: string[] = Array.isArray(l.smax_tags) ? l.smax_tags : [];
    const timeMs = r.occurred_at ? new Date(r.occurred_at).getTime() : null;
    return {
      "Time": timeMs || null,
      "Event": r.event_type || "",
      "Lead Name": l.full_name || "",
      "Email": l.email || "",
      "Phone": l.phone || "",
      "Company": l.company || (l.email?.includes("@") ? l.email.split("@")[1] : ""),
      "Stage": l.stage || "",
      "TVV": l.assignee || "",
      "Tag SMAX": tags.length > 0 ? tags : null,  // MultiSelect: array or null
      "Title": (r.title || "").slice(0, 500),
      "Detail": (r.detail || "").slice(0, 500),
      // Tên bên SF thường KHÁC tên SMAX (VD SMAX "K40-Bảo Lee" ↔ SF "Lý Hồng Bảo")
      // → có cột riêng để tra cứu chéo giữa 2 hệ thống.
      ...(source === "salesforce" ? {
        "Tên SF": String((r.payload as { sf_name?: string } | null)?.sf_name || ""),
        "Lead cũ (SF)": String((r.payload as { prior_leads?: string } | null)?.prior_leads || ""),
        "Khoá (SF)": String((r.payload as { product?: string } | null)?.product || ""),
        "Rating (SF)": String((r.payload as { rating?: string } | null)?.rating || ""),
      } : {}),
    };
  });

  // KHỬ TRÙNG LẶP với dòng đã có trên Lark (khóa = Time|Event|Lead Name|Title).
  // Nhờ vậy có thể kéo cả cửa sổ N ngày mà không tạo bản sao, và sự kiện đến
  // MUỘN nhưng có giờ CŨ vẫn được chèn (thứ mà "mốc nước cao" bỏ sót).
  const keyOf = (t: unknown, ev: unknown, nm: unknown, ti: unknown) =>
    `${typeof t === "number" ? t : 0}|${String(ev ?? "")}|${String(nm ?? "")}|${String(ti ?? "").slice(0, 60)}`;
  const existingKeys = new Set<string>();
  if (!isNewTable && !fullRefresh) {
    let pageToken: string | undefined;
    while (true) {
      const url = new URL(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`);
      url.searchParams.set("page_size", "500");
      url.searchParams.set("field_names", JSON.stringify(["Time", "Event", "Lead Name", "Title"]));
      if (pageToken) url.searchParams.set("page_token", pageToken);
      const data = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
      if (data.code !== 0) { console.warn(`   ⚠️ đọc Lark để khử trùng lỗi ${data.code} — bỏ qua bước này`); existingKeys.clear(); break; }
      for (const r of (data.data?.items || [])) {
        const f = r.fields || {};
        existingKeys.add(keyOf(f["Time"], txtOf(f["Event"]), txtOf(f["Lead Name"]), txtOf(f["Title"])));
      }
      if (!data.data?.has_more) break;
      pageToken = data.data.page_token;
    }
  }
  const records = existingKeys.size
    ? allRecords.filter(rec => !existingKeys.has(keyOf(rec["Time"], rec["Event"], rec["Lead Name"], rec["Title"])))
    : allRecords;
  console.log(`   ↳ Đã có trên Lark: ${existingKeys.size} · cần chèn mới: ${records.length}/${allRecords.length}`);
  if (records.length === 0) { console.log(`   ✓ Không có dòng mới. Bỏ qua.`); return; }

  if (maxRecords) {
    await pruneTableToFit(token, tableId, records.length, maxRecords);
  }

  // CHỈ xoá-sạch-rồi-chèn khi ÉP full refresh hoặc bảng mới. Trước đây `mode`
  // rơi về "full" mặc định → mỗi lần chạy XOÁ TOÀN BỘ lịch sử rồi chỉ chèn lại
  // cửa sổ N ngày (mất data cũ). Giờ đã khử trùng lặp nên luôn chèn-thêm.
  if (fullRefresh || isNewTable) {
    if (fullRefresh) await deleteAllRecords(token, tableId);
    await ensureFieldsExist(token, tableId, STANDARD_FIELDS);
  }
  const inserted = await insertRecords(token, tableId, records);
  console.log(`   ✅ Inserted ${inserted} records to Lark (${fullRefresh ? "full refresh" : "append + dedup"})`);
}

/**
 * SMAX_Database — 1 row per lead (snapshot, not per-event).
 * Time = last chat, Tag SMAX = current tags, Title/Detail = latest chat content.
 * Full-refresh every push (small ~10k rows, fast).
 */
async function pushSmaxLeadSnapshot(token: string) {
  const tableName = "SMAX_Database";
  console.log(`\n📦 [smax] → ${tableName} (LEAD SNAPSHOT)`);

  const tables = await listTables(token);
  const table = tables.find((t: { name: string }) => t.name === tableName);
  let tableId: string;
  if (!table) tableId = await createTable(token, tableName, SMAX_LEAD_FIELDS);
  else tableId = table.table_id;

  // Read Lark's current rows FIRST — needed for the diff anyway, and the max
  // "Time" value drives the incremental cutoff below. (Lark API traffic does
  // not count against Supabase's egress/IO budget.)
  const existing = await listAllRecordsWithFields(token, tableId);
  const hasKeyCoverage = existing.length === 0 || existing.some(r => typeof r.fields["Lead ID"] === "string" && r.fields["Lead ID"]);

  // Incremental vs full: dim_lead-only changes (e.g. tag re-mirrored without a
  // new chat) don't bump occurred_at, so a pure-incremental sync would miss
  // them. Do a FULL view read on the first run of every 6-hour window (and on
  // LARK_FULL_REFRESH=1 / bootstrap); incremental otherwise.
  let maxLarkTimeMs = 0;
  for (const r of existing) {
    const v = r.fields["Time"];
    const n = typeof v === "number" ? v : 0;
    if (n > maxLarkTimeMs) maxLarkTimeMs = n;
  }
  const now = new Date();
  const isFullWindow = now.getUTCHours() % 6 === 0 && now.getUTCMinutes() < 15;
  const forcedFullRefresh = process.env.LARK_FULL_REFRESH === "1" || !hasKeyCoverage || maxLarkTimeMs === 0;
  // isFullWindow chỉ là "đủ điều kiện" — còn có THỰC SỰ làm hay không do
  // claimIfDue quyết định, để tránh lặp lại nhiều lần khi cron chạy nhanh
  // hơn 15 phút (xem comment ở claimIfDue).
  const fullRefresh =
    forcedFullRefresh || (isFullWindow && await claimIfDue("lark_push", "smax_snapshot_full_refresh_at", 5.5 * 3600_000));
  // 6h overlap so clock skew / late-arriving rows can't slip through the gap.
  const cutoffISO = new Date(maxLarkTimeMs - 6 * 3600_000).toISOString();
  console.log(`   ↳ Mode: ${fullRefresh ? "full" : `incremental (occurred_at > ${cutoffISO.slice(0, 19)})`}`);

  // Read the server-side snapshot view — Postgres does the "latest touchpoint
  // + chat count + lead metadata" aggregation, we just page the compact result.
  // (Replaces ~180 batched queries that downloaded every touchpoint to Node.)
  type SnapshotRow = {
    lead_id: string;
    event_type: string | null;
    title: string | null;
    detail: string | null;
    occurred_at: string | null;
    fallback_name: string | null;
    total_chats: number | null;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
    stage: string | null;
    assignee: string | null;
    smax_tags: string[] | null;
    external_profile_id: string | null;
    chua_phan_hoi: boolean | null;
  };
  const rows: SnapshotRow[] = [];
  let from = 0;
  while (from < 50000) {
    let q = admin.from("v_smax_lead_snapshot").select("*").range(from, from + 999);
    if (!fullRefresh) q = q.gt("occurred_at", cutoffISO);
    const { data, error } = await q;
    if (error) {
      console.error(`   ❌ v_smax_lead_snapshot: ${error.message} — is the 2026-07-10 migration applied?`);
      return;
    }
    if (!data?.length) break;
    rows.push(...(data as SnapshotRow[]));
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`   ↳ ${rows.length} snapshot rows from view`);
  if (rows.length === 0) { console.log(`   ✓ Nothing new. Skipping.`); return; }

  // FALLBACK "ID" (fix triệt để ID trống): lead mới nhận diện qua email/SĐT chưa có
  // external_profile_id trong dim_lead → lấy tid THẲNG từ touchpoint SMAX (nguồn tạo
  // dòng này — luôn mang tid). ID hiện ngay trong chu kỳ push 7', không chờ job giờ.
  const tidFallback = new Map<string, string>();
  {
    const noPid = rows.filter((r) => !r.external_profile_id).map((r) => r.lead_id);
    for (let i = 0; i < noPid.length; i += 200) {
      const batch = noPid.slice(i, i + 200);
      const { data } = await admin.from("fact_touchpoint").select("lead_id, payload, occurred_at").in("lead_id", batch).eq("source", "smax").order("occurred_at", { ascending: false });
      for (const t of data ?? []) { const p = (t.payload ?? {}) as { tid?: string }; if (p.tid && !tidFallback.has(t.lead_id)) tidFallback.set(t.lead_id, p.tid); }
    }
    if (tidFallback.size) console.log(`   ↳ ID fallback từ touchpoint tid: ${tidFallback.size} lead thiếu pid`);
  }

  const records: Array<{ leadId: string; fields: Record<string, unknown> }> = rows.map((r) => {
    const tags: string[] = Array.isArray(r.smax_tags) ? r.smax_tags : [];
    const timeMs = r.occurred_at ? new Date(r.occurred_at).getTime() : null;
    return {
      leadId: r.lead_id,
      fields: {
        "Time": timeMs || null,
        "Event": r.event_type || "",
        "Lead Name": r.full_name || r.fallback_name || "",
        "ID": stripSmaxIdPrefix(r.external_profile_id || tidFallback.get(r.lead_id) || null),
        "Email": r.email || "",
        "Phone": r.phone || "",
        "Company": r.company || (r.email?.includes("@") ? r.email.split("@")[1] : ""),
        "Stage": r.stage || "",
        "TVV": r.assignee || "",
        "Tag SMAX": tags.length > 0 ? tags : null,
        // "Total Chats" KHÔNG set ở đây nữa. Trước lấy total_chats từ view =
        // SỐ THREAD (1 cuộc = 1). Nay = SỐ TIN KHÁCH GỬI, tính từ message fetch
        // trong khối chat-refresh bên dưới (chat.customerMsgCount).
        "Title": (r.title || "").slice(0, 500),
        "Detail": (r.detail || "").slice(0, 500),
        "Lead ID": r.lead_id,
        // "Chưa phản hồi" tính THUẦN-DB từ view (cột chua_phan_hoi): thread SMAX
        // mới nhất của lead có nhãn 'chat' (khách nhắn cuối) VÀ trong 7 ngày.
        // Chỉ dựa trên touchpoint kiểu thread (có thông tin người gửi) — không
        // đọc history, không nguồn thứ 2. Tự tắt khi TVV rep (thread đổi sang
        // chat_staff ở lần sync SMAX kế). Xem migrations/2026-07-27-chua-phan-hoi-flag.sql
        "Chưa phản hồi": r.chua_phan_hoi === true,
      },
    };
  });
  console.log(`   ↳ Building ${records.length} lead-snapshot rows`);

  // Ensure schema (adds new fields; no-op once table is set up).
  await ensureFieldsExist(token, tableId, SMAX_LEAD_FIELDS);

  if (!hasKeyCoverage) {
    console.log(`   ⚙️  First run after UPSERT refactor — bootstrapping "Lead ID" key via full refresh`);
    await deleteAllRecords(token, tableId);
    const inserted = await insertRecords(token, tableId, records.map(r => r.fields));
    console.log(`   ✅ Bootstrap inserted ${inserted} rows`);
    return;
  }

  // Build map of existing rows: lead_id → {record_id, fields}
  const existingByLeadId = new Map<string, { record_id: string; fields: Record<string, unknown> }>();
  const existingWithoutKey: string[] = []; // record_ids that somehow lost their Lead ID
  const dupRecordIds: string[] = [];       // dòng TRÙNG cùng Lead ID → tự dọn
  for (const r of existing) {
    const key = normalizeFieldValue(r.fields["Lead ID"]);
    if (typeof key === "string" && key) {
      if (existingByLeadId.has(key)) dupRecordIds.push(r.record_id); // đã có 1 dòng → dòng này là dư
      else existingByLeadId.set(key, r);
    } else existingWithoutKey.push(r.record_id);
  }
  // SELF-HEAL: xóa dòng trùng Lead ID mỗi lần push (idempotent). Chặn bảng phình
  // do dòng nhân đôi từ BẤT KỲ nguồn nào — 2026-07-29 phát hiện 9.219 dòng trùng
  // gần chạm cap 20k. Giữ dòng gặp đầu tiên; snapshot bên dưới sẽ refresh dữ liệu.
  if (dupRecordIds.length) {
    for (let i = 0; i < dupRecordIds.length; i += 500) {
      await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_delete`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ records: dupRecordIds.slice(i, i + 500) }),
      });
    }
    console.log(`   🧹 Tự dọn ${dupRecordIds.length} dòng TRÙNG Lead ID`);
  }

  const toInsert: Array<{ leadId: string; fields: Record<string, unknown> }> = [];
  const toUpdate: Array<{ leadId: string; record_id: string; fields: Record<string, unknown> }> = [];
  for (const r of records) {
    const cur = existingByLeadId.get(r.leadId);
    if (!cur) { toInsert.push(r); continue; }
    const patch = diffFields(r.fields, cur.fields);
    if (patch) toUpdate.push({ leadId: r.leadId, record_id: cur.record_id, fields: patch });
  }

  // ── Chat history refresh for changed leads ────────────────────────────
  // A lead only chats a few times a day, so "changed" is dozens per run —
  // fetching straight from the SMAX messages API is cheap and adds zero
  // Supabase IO. Cap at 150 leads/run to stay inside the workflow timeout;
  // anything beyond that gets picked up by the periodic full window.
  // "Chat History 1..5" ĐÃ BỎ HẲN (user chốt 2026-08-17: "chat history cũng k
  // quan trọng, bỏ luôn đi"). 5 cột đã xoá khỏi Lark và job chat-sweep đã tắt
  // (.disabled). Khối dựng transcript bên dưới KHÔNG chạy nữa — giữ code lại để
  // tham chiếu lịch sử; bật lại thì phải tạo lại cột trước, nếu không Lark trả
  // FieldNameNotFound. "Total Chats" cũng nằm trong khối này nên ngừng cập nhật.
  const CHAT_HISTORY_ENABLED = false;
  const CHAT_LEADS_CAP = 150;
  const changedLeadIds = CHAT_HISTORY_ENABLED ? [
    ...toInsert.map((r) => r.leadId),
    ...toUpdate.map((r) => r.leadId),
  ].slice(0, CHAT_LEADS_CAP) : [];
  if (changedLeadIds.length > 0) {
    const pidByLead = new Map<string, string | null>();
    for (const r of rows) pidByLead.set(r.lead_id, r.external_profile_id);
    const threadsByLead = await getThreadsForLeads(admin as never, changedLeadIds, pidByLead);
    let chatUpdated = 0;
    for (const item of [...toInsert, ...toUpdate]) {
      if (!changedLeadIds.includes(item.leadId)) continue;
      const threads = threadsByLead.get(item.leadId) ?? [];
      if (threads.length === 0) continue;
      const chat = await buildChatHistoryFields(threads);
      const hasContent = chat.messageCount > 0;
      const isInsert = toInsert.includes(item as (typeof toInsert)[number]);
      // Never overwrite existing chat with emptiness (API hiccup protection)
      if (!hasContent && !isInsert) continue;
      // LƯU Ý: "Chưa phản hồi" KHÔNG còn ghi đè ở đây. Trước đây khối này set
      // cờ theo chat.lastFromCustomer (quét live) → tạo NGUỒN THỨ 2 đá nhau với
      // view và không có luật 7 ngày → tick kẹt. Giờ cờ tính thuần-DB ở dòng 664.
      // Khối này dựng "Chat History 1..5" + "Total Chats" (= số tin khách gửi).
      const chatOnly = { ...chat.fields, "Total Chats": chat.customerMsgCount };
      if (isInsert) {
        Object.assign(item.fields, chatOnly);
      } else {
        const cur = existingByLeadId.get(item.leadId);
        const chatPatch = cur ? diffFields(chatOnly, cur.fields) : chatOnly;
        if (chatPatch) Object.assign(item.fields, chatPatch);
      }
      chatUpdated++;
    }
    console.log(`   ↳ Chat history refreshed for ${chatUpdated}/${changedLeadIds.length} changed leads`);
  }

  // Intentionally NEVER delete rows from Lark. If a lead drops out of the
  // 365d window or gets removed upstream, we leave its row intact so sales
  // can still find historical contacts. Rows only ever grow.
  // NOTE: watch table size against Lark's 20k free-tier cap (see log below).
  void existingWithoutKey; // silence unused — retained for future diagnostics

  console.log(`   ↻ UPSERT plan (no-delete): insert=${toInsert.length}  update=${toUpdate.length}  unchanged=${records.length - toInsert.length - toUpdate.length}  total-in-lark-after=${existing.length + toInsert.length}`);

  if (toInsert.length) {
    // Strip the leadId wrapper — Lark rejects unknown "fields.fields" nesting
    const n = await insertRecords(token, tableId, toInsert.map((r) => r.fields));
    console.log(`   ✅ Inserted ${n} new leads`);
  }
  if (toUpdate.length) {
    const n = await updateRecords(token, tableId, toUpdate.map(({ record_id, fields }) => ({ record_id, fields })));
    console.log(`   ✅ Updated ${n} changed leads`);
  }
}

/**
 * SMAX Hotleads table — 1 row per hot SMAX lead (dedup, not per-event).
 * Format: Ngày, Tên, Email, SĐT, Tag SMAX, Platform, Score
 * Purpose: Hoàng imports this table to Salesforce to auto-create leads.
 * Filter: hot_score >= 70 (from V11 scoring) AND source lead surfaced by SMAX.
 */
async function pushSmaxHotleads(token: string) {
  const tableName = "SMAX_Hotleads";
  console.log(`\n🔥 [SMAX Hotleads] → ${tableName}`);

  // Hàm này đọc lại TOÀN BỘ hot-lead (fact_lead_score + dim_lead) mỗi lần
  // chạy — không incremental, ~1.16MB/lần đo thực tế (2709 lead × ~448B).
  // Ở nhịp 15 phút: ~3.3GB/tháng. Ở 7 phút sẽ thành ~7GB/tháng CHỈ RIÊNG hàm
  // này — phát hiện 2026-07-16 khi Supabase đã vượt egress quota. Danh sách
  // hot-lead thực ra chỉ đổi 1 lần/ngày (scored_at là cột DATE, scoring chạy
  // 1 lần/ngày), nên chạy dày hơn ~15 phút không mang lại data mới hơn — chốt
  // lại để job cha (Lark push) có thể chạy nhanh cho các phần khác mà không
  // kéo egress của riêng hàm này lên theo.
  if (!(await claimIfDue("lark_push", "smax_hotleads_pull_at", 14 * 60_000))) {
    console.log(`   ↳ Đã pull hot-leads <14 phút trước, skip (chống egress dư thừa)`);
    return;
  }

  // Get or create table
  const tables = await listTables(token);
  let table = tables.find((t: { name: string }) => t.name === tableName);
  let tableId: string;
  if (!table) {
    tableId = await createTable(token, tableName, HOTLEADS_FIELDS);
  } else {
    tableId = table.table_id;
    // Field type update deferred until after deleteAllRecords (Lark requires empty)
  }

  // Pull hot lead ids from latest score date (paginated)
  const { data: latest } = await admin
    .from("fact_lead_score").select("scored_at")
    .order("scored_at", { ascending: false }).limit(1).maybeSingle();
  const scoredAt = latest?.scored_at ?? new Date().toISOString().slice(0, 10);

  const scoreMap = new Map<string, number>();
  let sFrom = 0;
  while (sFrom < 50000) {
    const { data: page } = await admin.from("fact_lead_score")
      .select("lead_id, hot_score")
      .eq("scored_at", scoredAt)
      .gte("hot_score", 70)
      .range(sFrom, sFrom + 999);
    if (!page?.length) break;
    for (const r of page) scoreMap.set(r.lead_id, r.hot_score ?? 0);
    if (page.length < 1000) break;
    sFrom += 1000;
  }
  console.log(`   ↳ ${scoreMap.size} hot-scored leads (score >= 70)`);

  // Load SMAX leads (source = smax OR touched by smax) with metadata
  // Batch 100 — Supabase URL length cap ~8KB, 500 UUIDs silently returns empty.
  const leadIds = Array.from(scoreMap.keys());
  const leadRows: Record<string, unknown>[] = [];
  for (let i = 0; i < leadIds.length; i += 100) {
    const batch = leadIds.slice(i, i + 100);
    const { data } = await admin.from("dim_lead")
      .select("lead_id, full_name, email, phone, source, external_platform, smax_tags, first_seen_at, last_engagement_at, last_chat_at")
      .eq("source", "smax")
      .in("lead_id", batch);
    if (data?.length) leadRows.push(...(data as Record<string, unknown>[]));
  }
  console.log(`   ↳ ${leadRows.length} SMAX-sourced hot leads`);

  if (leadRows.length === 0) return;

  // Sort by score DESC (highest first)
  leadRows.sort((a, b) => (scoreMap.get(b.lead_id as string) ?? 0) - (scoreMap.get(a.lead_id as string) ?? 0));

  // Transform to Lark records — Ngày as DateTime, Score as Number. Each record
  // includes "Lead ID" (UUID) as the UPSERT key.
  const records: Array<{ leadId: string; fields: Record<string, unknown> }> = leadRows.map((l) => {
    const tags: string[] = Array.isArray(l.smax_tags) ? (l.smax_tags as string[]) : [];
    const ngay = (l.last_chat_at || l.last_engagement_at || l.first_seen_at) as string | null;
    const ngayMs = ngay ? new Date(ngay).getTime() : null;
    return {
      leadId: l.lead_id as string,
      fields: {
        "Ngày": ngayMs || null,
        "Tên": (l.full_name as string) || "",
        "Email": (l.email as string) || "",
        "SĐT": (l.phone as string) || "",
        "Tag SMAX": tags.length > 0 ? tags : null,
        "Platform": (l.external_platform as string) || "",
        "Score": Number(scoreMap.get(l.lead_id as string) ?? 0),
        "Lead ID": l.lead_id as string,
      },
    };
  });

  await ensureFieldsExist(token, tableId, HOTLEADS_FIELDS);

  const existing = await listAllRecordsWithFields(token, tableId);
  const hasKeyCoverage = existing.length === 0 || existing.some(r => typeof r.fields["Lead ID"] === "string" && r.fields["Lead ID"]);

  if (!hasKeyCoverage) {
    console.log(`   ⚙️  Bootstrapping "Lead ID" key via full refresh`);
    await deleteAllRecords(token, tableId);
    const n = await insertRecords(token, tableId, records.map(r => r.fields));
    console.log(`   ✅ Bootstrap inserted ${n} rows`);
    return;
  }

  const existingByLeadId = new Map<string, { record_id: string; fields: Record<string, unknown> }>();
  const existingWithoutKey: string[] = [];
  for (const r of existing) {
    const key = normalizeFieldValue(r.fields["Lead ID"]);
    if (typeof key === "string" && key) existingByLeadId.set(key, r);
    else existingWithoutKey.push(r.record_id);
  }

  const toInsert: Array<Record<string, unknown>> = [];
  const toUpdate: Array<{ record_id: string; fields: Record<string, unknown> }> = [];
  for (const r of records) {
    const cur = existingByLeadId.get(r.leadId);
    if (!cur) { toInsert.push(r.fields); continue; }
    const patch = diffFields(r.fields, cur.fields);
    if (patch) toUpdate.push({ record_id: cur.record_id, fields: patch });
  }

  // No deletes on Hotleads either — keep historical hot leads visible.
  void existingWithoutKey;

  console.log(`   ↻ UPSERT plan (no-delete): insert=${toInsert.length}  update=${toUpdate.length}  unchanged=${records.length - toInsert.length - toUpdate.length}`);

  if (toInsert.length) {
    const n = await insertRecords(token, tableId, toInsert);
    console.log(`   ✅ Inserted ${n} new hot leads`);
  }
  if (toUpdate.length) {
    const n = await updateRecords(token, tableId, toUpdate);
    console.log(`   ✅ Updated ${n} changed hot leads`);
  }
}

export async function pushToLark() {
  if (!LARK_APP_ID || !LARK_APP_SECRET || !APP_TOKEN) {
    throw new Error("Missing Lark env vars: LARK_APP_ID, LARK_APP_SECRET, LARK_BASE_APP_TOKEN");
  }

  // LARK_SOURCES=smax → push only SMAX + Hotleads (fast, every 5min)
  // LARK_SOURCES=salesforce,instantly,web → push everything else (slow, hourly)
  // Unset → push all (default, backward-compat)
  const sourcesFilter = (process.env.LARK_SOURCES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const shouldPush = (source: string) =>
    sourcesFilter.length === 0 || sourcesFilter.includes(source);

  console.log("📡 [Lark Push] Starting...");
  if (sourcesFilter.length > 0) {
    console.log(`   ↳ Filter: ${sourcesFilter.join(", ")}`);
  }
  const token = await getToken();
  console.log("✅ Got Lark access token");

  for (const [source, tableName] of Object.entries(CHANNEL_TABLES)) {
    if (!shouldPush(source)) {
      console.log(`\n⏭  [${source}] skipped (not in LARK_SOURCES)`);
      continue;
    }
    try {
      // SMAX gets special lead-snapshot treatment (1 row / lead, dedup)
      // Non-SMAX sources still use per-event rows
      if (source === "smax") {
        await pushSmaxLeadSnapshot(token);
      } else {
        await pushChannel(token, source, tableName);
      }
    } catch (err) {
      console.error(`❌ [${source}] failed: ${(err as Error).message}`);
    }
  }

  // SMAX_Hotleads bảng riêng đã BỎ (2026-07-29): hợp nhất về 1 bảng SMAX_Database.
  // "Hot Score" nay là 1 cột trên SMAX_Database (do tag-sync.ts ghi) — lọc score>=70
  // trực tiếp. Không push bảng Hotleads riêng nữa (tránh tạo lại bảng đã xoá).
  void pushSmaxHotleads; // giữ hàm để tham chiếu lịch sử, không gọi

  console.log("\n✨ Lark push complete");
}
