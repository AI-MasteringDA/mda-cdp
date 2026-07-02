import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const TOKEN = process.env.SMAX_USER_TOKEN;
  const BASE = "https://api.smax.ai";
  const BIZ_SLUG = "mastering-data-analytics";
  const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

  console.log("🔍 List ALL SMAX channels\n");

  // Try to list pages
  const endpoints = [
    `/bizs/${BIZ_SLUG}/pages`,
    `/bizs/${BIZ_SLUG}/channels`,
    `/bizs/${BIZ_SLUG}/page_pids`,
    `/bizs/${BIZ_SLUG}/platforms`,
  ];

  for (const ep of endpoints) {
    for (const method of ["GET", "POST"] as const) {
      const opts: RequestInit = { method, headers };
      if (method === "POST") opts.body = JSON.stringify({});
      const res = await fetch(`${BASE}${ep}`, opts);
      console.log(`${method} ${ep.padEnd(45)} → ${res.status}`);
      if (res.status === 200 || res.status === 201) {
        const data = await res.json();
        console.log(`  Response: ${JSON.stringify(data).slice(0, 500)}`);
      }
    }
  }

  // Try to get biz info which might contain channels list
  console.log("\n═══ Try /bizs list ═══");
  const listRes = await fetch(`${BASE}/bizs`, { headers });
  console.log(`GET /bizs → ${listRes.status}`);
  if (listRes.status === 200) {
    const data = await listRes.json();
    console.log(JSON.stringify(data).slice(0, 500));
  }
}

main().catch(console.error);
