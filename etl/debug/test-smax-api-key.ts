import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

/** Test SMAX với API_KEY (biz token, dài hạn) thay vì USER_TOKEN */
async function main() {
  const API_KEY = process.env.SMAX_API_KEY;
  const USER_TOKEN = process.env.SMAX_USER_TOKEN;
  const BASE = process.env.SMAX_BASE_URL || "https://api.smax.ai";
  const BIZ_SLUG = "mastering-data-analytics";
  const PAGE_PIDS = [
    "fb102323788540150", "fb107203051058856", "zlw543187459113764384",
    "zl2235256473219383054", "ctm68188e11779d16c0779c018c",
    "ig17841446528067260", "ig17841460097450702",
  ];

  console.log("🔍 Test 2 loại token SMAX:\n");

  for (const [name, token] of [["USER_TOKEN", USER_TOKEN], ["API_KEY", API_KEY]] as const) {
    if (!token) { console.log(`${name}: (không có trong .env)`); continue; }
    const res = await fetch(`${BASE}/bizs/${BIZ_SLUG}/threads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ page_pids: PAGE_PIDS, skip: 0, limit: 5 }),
    });
    const data: any = await res.json();
    const items = data.data || [];
    console.log(`${name.padEnd(15)} status=${res.status} items=${items.length} ${data.message ? `msg=${data.message}` : ''}`);
    if (items.length > 0) {
      const t = items[0];
      console.log(`   Sample: ${t.id} platform=${t.platform} last_msg=${t.last_message_at?.slice(0,19)}`);
    }
  }
}

main().catch(console.error);
