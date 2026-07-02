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
const DAYS_TO_PUSH = Number(process.env.LARK_DAYS_TO_PUSH || 30);

const CHANNEL_TABLES: Record<string, string> = {
  smax: "SMAX_Database",
  salesforce: "Salesforce_Database",
  instantly: "Instantly_Database",
  web: "Wix_Database",
};

// Standard fields for each channel table
const STANDARD_FIELDS = [
  { field_name: "Time", type: 1 },
  { field_name: "Event", type: 1 },
  { field_name: "Lead Name", type: 1 },
  { field_name: "Email", type: 1 },
  { field_name: "Phone", type: 1 },
  { field_name: "Company", type: 1 },
  { field_name: "Stage", type: 1 },
  { field_name: "TVV", type: 1 },
  { field_name: "Title", type: 1 },
  { field_name: "Detail", type: 1 },
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

async function createTable(token: string, name: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      table: {
        name,
        default_view_name: "Grid",
        fields: STANDARD_FIELDS,
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

async function createField(token: string, tableId: string, fieldName: string) {
  const res = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/fields`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ field_name: fieldName, type: 1 }),
  });
  const data = await res.json();
  if (data.code !== 0) console.warn(`   ⚠️ Create field "${fieldName}" failed: ${JSON.stringify(data).slice(0, 200)}`);
}

async function ensureFieldsExist(token: string, tableId: string) {
  const existingFields = await listFields(token, tableId);
  const existingNames = new Set(existingFields.map((f: { field_name: string }) => f.field_name));
  for (const std of STANDARD_FIELDS) {
    if (!existingNames.has(std.field_name)) {
      await createField(token, tableId, std.field_name);
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
    await ensureFieldsExist(token, tableId);
  }

  // Pull data from DB (last N days)
  const cutoff = new Date(Date.now() - DAYS_TO_PUSH * 86400_000).toISOString();
  const rows: any[] = [];
  let from = 0;
  while (true) {
    const { data } = await admin.from("fact_touchpoint")
      .select("event_type, title, detail, occurred_at, payload, dim_lead(full_name, email, phone, company, stage, assignee)")
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

  // Transform to Lark records
  const records = rows.map((r) => {
    const l = r.dim_lead || {};
    return {
      "Time": r.occurred_at?.slice(0, 19) || "",
      "Event": r.event_type || "",
      "Lead Name": l.full_name || "",
      "Email": l.email || "",
      "Phone": l.phone || "",
      "Company": l.company || (l.email?.includes("@") ? l.email.split("@")[1] : ""),
      "Stage": l.stage || "",
      "TVV": l.assignee || "",
      "Title": (r.title || "").slice(0, 500),
      "Detail": (r.detail || "").slice(0, 500),
    };
  });

  // Full refresh: delete all + insert
  await deleteAllRecords(token, tableId);
  const inserted = await insertRecords(token, tableId, records);
  console.log(`   ✅ Inserted ${inserted} records to Lark`);
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

  console.log("\n✨ Lark push complete");
}
