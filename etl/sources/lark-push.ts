import { admin } from "../lib/supabase-admin";

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

// SMAX Hotleads table: dedup by lead (1 row per lead) — for Hoàng import to SF
const HOTLEADS_FIELDS = [
  { field_name: "Ngày", type: 5, property: { date_formatter: "yyyy-MM-dd HH:mm", auto_fill: false } },
  { field_name: "Tên", type: 1 },
  { field_name: "Email", type: 1 },
  { field_name: "SĐT", type: 1 },
  { field_name: "Tag SMAX", type: 4 },  // MultiSelect
  { field_name: "Platform", type: 3 },  // SingleSelect (facebook/zalo/zaloweb/instagram/custom)
  { field_name: "Score", type: 2 },
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

async function listFields(token: string, tableId: string) {
  const res = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.data?.items || [];
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

  // Get or create table
  const tables = await listTables(token);
  let table = tables.find((t: { name: string }) => t.name === tableName);
  let tableId: string;
  if (!table) {
    tableId = await createTable(token, tableName);
  } else {
    tableId = table.table_id;
    // Note: field type update requires empty table — done after deleteAllRecords below
  }

  // Pull data from DB (last N days)
  const cutoff = new Date(Date.now() - DAYS_TO_PUSH * 86400_000).toISOString();
  const rows: any[] = [];
  let from = 0;
  while (true) {
    const { data } = await admin.from("fact_touchpoint")
      .select("event_type, title, detail, occurred_at, payload, dim_lead(full_name, email, phone, company, stage, assignee, smax_tags)")
      .eq("source", source)
      .gte("occurred_at", cutoff)
      .order("occurred_at", { ascending: false })
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`   ↳ Loaded ${rows.length} touchpoints (last ${DAYS_TO_PUSH} days)`);

  if (rows.length === 0) return;

  // Transform to Lark records — DateTime fields as Unix milliseconds
  const records = rows.map((r) => {
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
    };
  });

  // Full refresh: delete all → update field types (only works when empty) → insert
  await deleteAllRecords(token, tableId);
  await ensureFieldsExist(token, tableId, STANDARD_FIELDS);
  const inserted = await insertRecords(token, tableId, records);
  console.log(`   ✅ Inserted ${inserted} records to Lark`);
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
  const leadIds = Array.from(scoreMap.keys());
  const leadRows: Record<string, unknown>[] = [];
  for (let i = 0; i < leadIds.length; i += 500) {
    const batch = leadIds.slice(i, i + 500);
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

  // Transform to Lark records — Ngày as DateTime, Score as Number
  const records = leadRows.map((l) => {
    const tags: string[] = Array.isArray(l.smax_tags) ? (l.smax_tags as string[]) : [];
    const ngay = (l.last_chat_at || l.last_engagement_at || l.first_seen_at) as string | null;
    const ngayMs = ngay ? new Date(ngay).getTime() : null;
    return {
      "Ngày": ngayMs || null,
      "Tên": (l.full_name as string) || "",
      "Email": (l.email as string) || "",
      "SĐT": (l.phone as string) || "",
      "Tag SMAX": tags.length > 0 ? tags : null,  // MultiSelect: array
      "Platform": (l.external_platform as string) || "",  // SingleSelect: string
      "Score": Number(scoreMap.get(l.lead_id as string) ?? 0),
    };
  });

  await deleteAllRecords(token, tableId);
  await ensureFieldsExist(token, tableId, HOTLEADS_FIELDS);
  const inserted = await insertRecords(token, tableId, records);
  console.log(`   ✅ Inserted ${inserted} hot leads to Lark (${tableName})`);
}

export async function pushToLark() {
  if (!LARK_APP_ID || !LARK_APP_SECRET || !APP_TOKEN) {
    throw new Error("Missing Lark env vars: LARK_APP_ID, LARK_APP_SECRET, LARK_BASE_APP_TOKEN");
  }

  console.log("📡 [Lark Push] Starting...");
  const token = await getToken();
  console.log("✅ Got Lark access token");

  for (const [source, tableName] of Object.entries(CHANNEL_TABLES)) {
    try {
      await pushChannel(token, source, tableName);
    } catch (err) {
      console.error(`❌ [${source}] failed: ${(err as Error).message}`);
    }
  }

  // New table for Hoàng → SF auto-import
  try {
    await pushSmaxHotleads(token);
  } catch (err) {
    console.error(`❌ [SMAX Hotleads] failed: ${(err as Error).message}`);
  }

  console.log("\n✨ Lark push complete");
}
