import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

/**
 * Test Instantly API để lấy HISTORICAL data per lead:
 * - Mỗi lead: opened? clicked? replied?
 * - Aggregate không phải event-by-event
 */
async function main() {
  const API_KEY = process.env.INSTANTLY_API_KEY;
  const BASE = "https://api.instantly.ai/api/v2";
  const headers = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };

  console.log("🔍 Test /leads endpoints for historical engagement\n");

  // Test 1: /leads endpoint list
  const endpoints = [
    "/leads?limit=3",
    "/leads/list?limit=3",
    "/campaigns/analytics?limit=3",
  ];

  for (const ep of endpoints) {
    const res = await fetch(`${BASE}${ep}`, { headers });
    console.log(`${ep.padEnd(45)} → ${res.status}`);
    if (res.status === 200) {
      const data = await res.json() as any;
      const items = data.items || data.data || (Array.isArray(data) ? data : []);
      if (items.length > 0) {
        console.log("  Sample fields:");
        for (const [k, v] of Object.entries(items[0])) {
          const short = typeof v === 'string' ? v.slice(0, 60) : JSON.stringify(v).slice(0, 60);
          console.log(`    ${k.padEnd(30)}: ${short}`);
        }
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Test POST for leads search with filters
  console.log("\n═══ POST /leads/list with filter ═══");
  const searchRes = await fetch(`${BASE}/leads/list`, {
    method: "POST", headers,
    body: JSON.stringify({ limit: 3 }),
  });
  console.log(`POST /leads/list → ${searchRes.status}`);
  if (searchRes.status === 200) {
    const data = await searchRes.json() as any;
    const items = data.items || data.data || [];
    console.log(`  ${items.length} items`);
    if (items.length > 0) {
      console.log("  Fields of first lead:");
      for (const [k, v] of Object.entries(items[0])) {
        const short = typeof v === 'string' ? v.slice(0, 60) : JSON.stringify(v).slice(0, 60);
        console.log(`    ${k.padEnd(35)}: ${short}`);
      }
    }
  }
}

main().catch(console.error);
