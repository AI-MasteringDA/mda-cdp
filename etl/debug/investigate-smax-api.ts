import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

/** Test SMAX API pagination — see if skip actually paginates */
async function main() {
  const TOKEN = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
  const BASE = process.env.SMAX_BASE_URL || "https://api.smax.ai";
  const BIZ_SLUG = "mastering-data-analytics";
  const PAGE_PIDS = [
    "fb102323788540150", "fb107203051058856", "zlw543187459113764384",
    "zl2235256473219383054", "ctm68188e11779d16c0779c018c",
    "ig17841446528067260", "ig17841460097450702",
  ];

  const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

  console.log("🔍 SMAX API pagination test\n");

  // Test 1: Pull first 3 pages, check thread IDs overlap
  const seenIds = new Set<string>();
  for (let page = 0; page < 5; page++) {
    const skip = page * 100;
    const res = await fetch(`${BASE}/bizs/${BIZ_SLUG}/threads`, {
      method: "POST", headers,
      body: JSON.stringify({ page_pids: PAGE_PIDS, skip, limit: 100 }),
    });
    const data: { data?: Array<{ id: string; last_message_at?: string }>; total?: number } = await res.json();
    const items = data.data || [];
    const newIds = items.filter(t => !seenIds.has(t.id)).length;
    items.forEach(t => seenIds.add(t.id));
    const oldest = items.map(t => t.last_message_at).sort()[0] || "?";
    const newest = items.map(t => t.last_message_at).sort().reverse()[0] || "?";
    console.log(`Page ${page} (skip=${skip}): ${items.length} items, ${newIds} NEW, oldest=${oldest?.slice(0,10)}, newest=${newest?.slice(0,10)}, total unique so far: ${seenIds.size}`);
    if (data.total) console.log(`   API reports total: ${data.total}`);
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\nUnique threads after 5 pages: ${seenIds.size} (expected ~500)`);

  // Test 2: Try different endpoints
  console.log("\n🔍 Try alternative SMAX endpoints:");
  const endpoints = [
    `/bizs/${BIZ_SLUG}`,
    `/bizs/${BIZ_SLUG}/messages`,
    `/bizs/${BIZ_SLUG}/conversations`,
    `/bizs/${BIZ_SLUG}/analytics`,
    `/bizs/${BIZ_SLUG}/threads/count`,
  ];
  for (const ep of endpoints) {
    try {
      const r = await fetch(`${BASE}${ep}`, { headers });
      console.log(`  ${ep.padEnd(50)} → ${r.status}`);
    } catch (e) { console.log(`  ${ep} error`); }
  }
}

main().catch(console.error);
