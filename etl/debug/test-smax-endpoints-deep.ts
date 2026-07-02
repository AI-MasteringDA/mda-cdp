import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const TOKEN = process.env.SMAX_USER_TOKEN;
  const BASE = "https://api.smax.ai";
  const BIZ_SLUG = "mastering-data-analytics";
  const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

  const PAGE_PIDS = [
    "fb102323788540150", "fb107203051058856", "zlw543187459113764384",
    "zl2235256473219383054", "ctm68188e11779d16c0779c018c",
    "ig17841446528067260", "ig17841460097450702",
  ];

  console.log("🔍 Test speed up SMAX pull\n");

  // Test 1: Pull each platform SEPARATELY (maybe more data per call)
  console.log("═══ 1. Pull per platform separately ═══");
  for (const pid of PAGE_PIDS) {
    const res = await fetch(`${BASE}/bizs/${BIZ_SLUG}/threads`, {
      method: "POST", headers,
      body: JSON.stringify({ page_pids: [pid], skip: 0, limit: 100 }),
    });
    const data: any = await res.json();
    const items = data.data || [];
    console.log(`   ${pid.padEnd(35)} → ${items.length} threads`);
    await new Promise(r => setTimeout(r, 500));
  }

  // Test 2: Try /messages endpoint
  console.log("\n═══ 2. Try /messages endpoints ═══");
  const messageEndpoints = [
    `/bizs/${BIZ_SLUG}/messages`,
    `/bizs/${BIZ_SLUG}/customers`,
    `/bizs/${BIZ_SLUG}/threads/all`,
    `/bizs/${BIZ_SLUG}/tickets`,
  ];
  for (const ep of messageEndpoints) {
    for (const method of ["GET", "POST"] as const) {
      const opts: RequestInit = { method, headers };
      if (method === "POST") opts.body = JSON.stringify({ page_pids: PAGE_PIDS, skip: 0, limit: 5 });
      const res = await fetch(`${BASE}${ep}`, opts);
      console.log(`   ${method} ${ep.padEnd(45)} → ${res.status}`);
      if (res.status === 200 || res.status === 201) {
        const data: any = await res.json();
        console.log(`      keys: ${Object.keys(data).join(', ').slice(0, 100)}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Test 3: Try with date filter
  console.log("\n═══ 3. Try /threads with date filter ═══");
  const dateFilters = [
    { from_date: "2026-06-01" },
    { since: "2026-06-01" },
    { after: "2026-06-01" },
    { last_message_at_gt: "2026-06-01" },
  ];
  for (const filter of dateFilters) {
    const res = await fetch(`${BASE}/bizs/${BIZ_SLUG}/threads`, {
      method: "POST", headers,
      body: JSON.stringify({ page_pids: PAGE_PIDS, skip: 0, limit: 100, ...filter }),
    });
    const data: any = await res.json();
    const items = data.data || [];
    console.log(`   With ${JSON.stringify(filter).padEnd(40)} → ${items.length} threads`);
    await new Promise(r => setTimeout(r, 500));
  }

  // Test 4: Pagination beyond 100
  console.log("\n═══ 4. Deep pagination test (skip=200, 500, 1000) ═══");
  for (const skip of [100, 200, 500, 1000, 2000]) {
    const res = await fetch(`${BASE}/bizs/${BIZ_SLUG}/threads`, {
      method: "POST", headers,
      body: JSON.stringify({ page_pids: PAGE_PIDS, skip, limit: 100 }),
    });
    const data: any = await res.json();
    const items = data.data || [];
    const oldest = items.length > 0 ? items[items.length-1]?.last_message_at?.slice(0,10) : "—";
    console.log(`   skip=${String(skip).padEnd(6)} → ${items.length} threads (oldest: ${oldest})`);
    await new Promise(r => setTimeout(r, 500));
  }
}

main().catch(console.error);
