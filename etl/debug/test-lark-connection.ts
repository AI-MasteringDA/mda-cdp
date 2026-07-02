import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const LARK_APP_ID = "cli_aa82a6d1f7f89ed3";
const LARK_APP_SECRET = "FlxoaVdlMGN6uugDP2QQXd6TVE0koH34";
const APP_TOKEN = "YioObV8P2aNl0Gsgc69lLWZugWe";
const BASE_URL = "https://open.larksuite.com/open-apis";

async function main() {
  console.log("🔍 Test Lark connection\n");

  // Step 1: Get tenant_access_token
  console.log("═══ 1. Get tenant_access_token ═══");
  const tokenRes = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET }),
  });
  const tokenData = await tokenRes.json();
  console.log("Response:", JSON.stringify(tokenData).slice(0, 200));
  const token = tokenData.tenant_access_token;
  if (!token) {
    console.error("❌ Failed to get token");
    return;
  }
  console.log(`✅ Got token: ${token.slice(0, 30)}...`);
  console.log(`   Expires in: ${tokenData.expire}s\n`);

  // Step 2: List tables in Base
  console.log("═══ 2. List tables in Base ═══");
  const tablesRes = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const tablesData = await tablesRes.json();
  console.log("Response:", JSON.stringify(tablesData).slice(0, 300));

  if (tablesData.data?.items) {
    console.log(`\n✅ Found ${tablesData.data.items.length} tables:`);
    tablesData.data.items.forEach((t: any) => {
      console.log(`   - ${t.name} (${t.table_id})`);
    });
  }

  // Step 3: List fields in first table
  const firstTableId = tablesData.data?.items?.[0]?.table_id;
  if (firstTableId) {
    console.log(`\n═══ 3. List fields in "${tablesData.data.items[0].name}" ═══`);
    const fieldsRes = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${firstTableId}/fields`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const fieldsData = await fieldsRes.json();
    console.log("Fields:");
    fieldsData.data?.items?.forEach((f: any) => {
      console.log(`   - ${f.field_name} (type=${f.type})`);
    });
  }
}

main().catch(console.error);
