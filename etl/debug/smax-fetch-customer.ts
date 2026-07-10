import { admin as _admin } from "../lib/supabase-admin";
void _admin;

const TOKEN = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const BASE = process.env.SMAX_BASE_URL || "https://api.smax.ai";
const BIZ_SLUG = "mastering-data-analytics";

async function main() {
  const targetCustomerId = "6a4ca1c99dfa73a50749b864";  // Đức Hiếu SMAX customer

  // 1. Try /customers/{id} direct
  console.log(`=== Trying direct GET /customers/${targetCustomerId} ===`);
  const direct = await fetch(`${BASE}/bizs/${BIZ_SLUG}/customers/${targetCustomerId}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  console.log("status:", direct.status);
  const dText = await direct.text();
  console.log("body:", dText.slice(0, 800));

  // 2. Also do POST /customers to pull first page and find this customer
  console.log(`\n=== POST /customers to find ${targetCustomerId} in first 500 ===`);
  const listRes = await fetch(`${BASE}/bizs/${BIZ_SLUG}/customers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ size: 500 }),
  });
  const listData = await listRes.json() as { data?: Array<Record<string, unknown>>; total?: number };
  console.log(`total=${listData.total}, returned=${listData.data?.length}`);
  const match = listData.data?.find(c => c.id === targetCustomerId);
  if (match) {
    console.log("\n✅ FOUND in list. Full customer object:");
    console.log(JSON.stringify(match, null, 2));
  } else {
    console.log("❌ Not in first 500. Trying pagination or filter...");
    // Try to look for anyone named "Đức Hiếu" or with phone 0986362979
    const named = listData.data?.filter(c => {
      const n = String(c.name || c.profile_name || "").toLowerCase();
      return n.includes("đức hiếu") || n.includes("duc hieu") || n.includes("hieu");
    });
    console.log(`\nFound ${named?.length ?? 0} matching customers by name:`);
    named?.slice(0, 5).forEach(c => console.log(JSON.stringify(c, null, 2)));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
