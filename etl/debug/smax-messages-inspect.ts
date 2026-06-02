import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const TOKEN = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY!;
const BASE = "https://api.smax.ai";
const BIZ_SLUG = "mastering-data-analytics";

// 1 sample thread đã biết work (từ DevTools)
const PAGE_PID = "zlw543187459113764384";
const THREAD_TID = "zlw4321478480609282897";

async function main() {
  const url = `${BASE}/bizs/${BIZ_SLUG}/pages/${PAGE_PID}/threads/${THREAD_TID}/messages?sort=-created_at&limit=5`;

  console.log("=== INSPECT SMAX messages endpoint ===");
  console.log(`URL: ${url}\n`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  });

  console.log(`Status: ${res.status}\n`);
  const data = await res.json();

  console.log("=== Top-level keys ===");
  console.log(Object.keys(data).join(", "));

  const items = data.data || data.items || data;
  if (Array.isArray(items)) {
    console.log(`\n=== Got ${items.length} messages ===\n`);

    console.log("=== Sample message #1 (first/newest) ===");
    console.log(JSON.stringify(items[0], null, 2).slice(0, 3000));

    if (items.length > 1) {
      console.log("\n\n=== Sample message #2 ===");
      console.log(JSON.stringify(items[1], null, 2).slice(0, 1500));
    }

    console.log("\n\n=== All message types/senders in sample ===");
    items.forEach((m: Record<string, unknown>, i: number) => {
      const id = m.id || m._id || "?";
      const type = m.type || m.message_type || "?";
      const text = (m.text || m.message || m.content || "").toString().slice(0, 60);
      const sender = m.from || m.sender || m.user_id || m.customer_id || "?";
      const time = m.created_at || m.timestamp || "?";
      console.log(`  ${i + 1}. id=${id} type=${type} sender=${JSON.stringify(sender).slice(0, 40)} time=${time}`);
      console.log(`     text: ${text}`);
    });
  } else {
    console.log("\n⚠️  Unexpected structure:");
    console.log(JSON.stringify(data, null, 2).slice(0, 2000));
  }
}

main().catch(console.error);
