import { admin as _a } from "../lib/supabase-admin";
void _a;

const LARK_APP_ID = process.env.LARK_APP_ID || "";
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || "";
const APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || "";
const BASE_URL = "https://open.larksuite.com/open-apis";

async function getToken(): Promise<string> {
  const auth = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET }),
  }).then(r => r.json());
  return auth.tenant_access_token;
}

async function main() {
  const token = await getToken();
  // Find SMAX_Database
  const tRes = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables?page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  const table = tRes.data?.items?.find((t: { name: string }) => t.name === "SMAX_Database");
  if (!table) { console.log("❌ SMAX_Database not found"); return; }
  const tableId = table.table_id;

  // Count all + search for "Đức Hiếu" with email
  let pageToken: string | undefined;
  let totalRows = 0;
  const hieuMatches: Array<{ name: string; email: string; phone: string; time: string; chats: number }> = [];
  while (true) {
    const url = new URL(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`);
    url.searchParams.set("page_size", "500");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    const items = data.data?.items || [];
    totalRows += items.length;
    for (const r of items) {
      const name = String(r.fields?.["Lead Name"] || "");
      if (name.toLowerCase().includes("hiếu") || name.toLowerCase().includes("hieu")) {
        hieuMatches.push({
          name,
          email: String(r.fields?.Email || ""),
          phone: String(r.fields?.Phone || ""),
          time: r.fields?.Time ? new Date(r.fields.Time as number).toISOString().slice(0, 19) : "",
          chats: Number(r.fields?.["Total Chats"] || 0),
        });
      }
    }
    if (!data.data?.has_more) break;
    pageToken = data.data.page_token;
  }

  console.log(`Total SMAX_Database rows: ${totalRows}`);
  console.log(`\n"Hiếu"/"hieu" matches (${hieuMatches.length}):`);
  hieuMatches.forEach(m =>
    console.log(`  • ${m.name.padEnd(30)}  email=${m.email.padEnd(30)}  phone=${m.phone.padEnd(12)}  time=${m.time}  chats=${m.chats}`)
  );

  // Find Đức Hiếu specifically
  const ducHieu = hieuMatches.find(m => m.name.toLowerCase().includes("đức hiếu") || m.name.toLowerCase().includes("duc hieu"));
  if (ducHieu && ducHieu.email && ducHieu.phone) {
    console.log("\n✅ Đức Hiếu FOUND with full email + phone");
    process.exit(0);
  } else if (ducHieu) {
    console.log("\n⚠️ Đức Hiếu found but missing email or phone");
    process.exit(2);
  } else {
    console.log("\n❌ Đức Hiếu row not found in Lark");
    process.exit(1);
  }
}
main().catch(e => { console.error(e); process.exit(3); });
