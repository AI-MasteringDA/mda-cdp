import { admin } from "../lib/supabase-admin";
void admin;

const LARK_APP_ID = process.env.LARK_APP_ID || "";
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || "";
const APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || "";
const BASE_URL = "https://open.larksuite.com/open-apis";

async function getToken(): Promise<string> {
  const res = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET }),
  });
  const data = await res.json();
  return data.tenant_access_token;
}

async function main() {
  console.log("APP_TOKEN =", APP_TOKEN);
  const token = await getToken();
  console.log("✅ Got Lark token:", !!token);

  // Find SMAX_Database
  const tRes = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables?page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const tData = await tRes.json();
  const table = tData.data?.items?.find((t: any) => t.name === "SMAX_Database");
  if (!table) { console.log("❌ SMAX_Database not found"); return; }
  console.log(`   Table id: ${table.table_id}`);

  // List fields
  const fRes = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/fields`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const fData = await fRes.json();
  console.log("\n📋 Fields in SMAX_Database:");
  fData.data?.items?.forEach((f: any) => console.log(`   • ${f.field_name}  type=${f.type}  ${f.property ? JSON.stringify(f.property).slice(0, 80) : ""}`));

  // Fetch first 10 records
  const rRes = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/records?page_size=10`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const rData = await rRes.json();
  console.log(`\n📊 Total rows (page 1 sample): ${rData.data?.items?.length || 0} of ${rData.data?.total || "?"}`);
  console.log("\n🔍 First 5 rows Time field:");
  rData.data?.items?.slice(0, 5).forEach((r: any, i: number) => {
    const t = r.fields?.Time;
    const readable = typeof t === "number" ? new Date(t).toISOString() : t;
    console.log(`   ${i + 1}. raw="${t}"  → ${readable}  · Lead: ${r.fields?.["Lead Name"] || "?"}`);
  });

  // Get max & min Time value across all records
  let pageToken: string | undefined;
  let maxT = 0, minT = Number.MAX_SAFE_INTEGER, count = 0, nullCount = 0;
  const dateHist = new Map<string, number>();
  while (true) {
    const url = new URL(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${table.table_id}/records`);
    url.searchParams.set("page_size", "500");
    url.searchParams.set("field_names", JSON.stringify(["Time"]));
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    const items = data.data?.items || [];
    for (const r of items) {
      const t = r.fields?.Time;
      if (t == null) { nullCount++; continue; }
      const n = typeof t === "number" ? t : new Date(t).getTime();
      if (!n || isNaN(n)) { nullCount++; continue; }
      count++;
      if (n > maxT) maxT = n;
      if (n < minT) minT = n;
      const ym = new Date(n).toISOString().slice(0, 7);
      dateHist.set(ym, (dateHist.get(ym) || 0) + 1);
    }
    if (!data.data?.has_more) break;
    pageToken = data.data.page_token;
  }

  console.log(`\n📈 Time field stats across ${count + nullCount} rows:`);
  console.log(`   With Time: ${count}  ·  NULL/invalid: ${nullCount}`);
  if (count > 0) {
    console.log(`   Min Time:  ${new Date(minT).toISOString()}`);
    console.log(`   Max Time:  ${new Date(maxT).toISOString()}`);
  }
  console.log("\n📅 Rows by year-month:");
  const sorted = Array.from(dateHist.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  sorted.forEach(([ym, n]) => console.log(`   ${ym}: ${n}`));
}

main().catch(e => { console.error("ERR:", e); process.exit(1); });
