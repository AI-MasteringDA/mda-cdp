import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

/** Explore Instantly V2 API endpoints to find the one with OPEN events */
async function main() {
  const API_KEY = process.env.INSTANTLY_API_KEY;
  const BASE = process.env.INSTANTLY_BASE_URL || "https://api.instantly.ai/api/v2";
  if (!API_KEY) throw new Error("Missing INSTANTLY_API_KEY");
  const headers = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };

  // Try candidate endpoints
  const endpoints = [
    "/campaigns/analytics",
    "/campaigns/analytics/overview",
    "/campaigns/analytics/opens",
    "/analytics",
    "/analytics/overview",
    "/emails/opens",
    "/events",
    "/events/opens",
    "/activity",
    "/activities",
    "/emails?ue_type=2",  // filter by open type
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(`${BASE}${ep}`, { headers });
      console.log(`${ep.padEnd(35)}: ${res.status}`);
      if (res.status === 200) {
        const data = await res.json();
        const preview = JSON.stringify(data).slice(0, 200);
        console.log(`   ↳ ${preview}`);
      }
    } catch (e) {
      console.log(`${ep.padEnd(35)}: ERROR ${(e as Error).message.slice(0, 40)}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // Get one campaign ID + try analytics endpoints on it
  console.log("\n═══ Try per-campaign analytics ═══");
  const campRes = await fetch(`${BASE}/campaigns?limit=3`, { headers });
  const camps = await campRes.json();
  const items = camps.items || camps.data || [];
  if (items.length > 0) {
    const cid = items[0].id;
    const cname = items[0].name;
    console.log(`Testing on campaign: ${cname}`);
    for (const ep of [
      `/campaigns/${cid}/analytics`,
      `/campaigns/${cid}/emails/analytics`,
      `/campaigns/${cid}/opens`,
      `/campaigns/${cid}/events`,
      `/campaigns/${cid}/leads`,
      `/campaigns/${cid}/stats`,
    ]) {
      try {
        const res = await fetch(`${BASE}${ep}`, { headers });
        console.log(`  ${ep.padEnd(55)}: ${res.status}`);
        if (res.status === 200) {
          const data = await res.json();
          console.log(`     ${JSON.stringify(data).slice(0, 300)}`);
        }
        await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        console.log(`  ${ep}: ERROR`);
      }
    }
  }
}

main().catch(console.error);
