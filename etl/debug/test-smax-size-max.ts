import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const TOKEN = process.env.SMAX_USER_TOKEN;
  const BASE = "https://api.smax.ai";
  const BIZ_SLUG = "mastering-data-analytics";
  const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

  console.log("🔬 Test max size + search_after pagination\n");

  // Max size
  for (const size of [1000, 5000, 10000, 20000, 25000]) {
    const start = Date.now();
    const res = await fetch(`${BASE}/bizs/${BIZ_SLUG}/customers`, {
      method: "POST",
      headers,
      body: JSON.stringify({ size }),
    });
    const data = await res.json() as { data?: { id?: string; created_at?: string }[]; total?: number };
    const items = data.data || [];
    const first = items[0];
    const last = items[items.length-1];
    console.log(`size=${String(size).padEnd(6)} count=${String(items.length).padEnd(6)} elapsed=${Date.now()-start}ms newest=${first?.created_at?.slice(0,10)} oldest=${last?.created_at?.slice(0,10)}`);
    if (items.length < size) console.log(`   → API cap reached at ${items.length}`);
  }

  // Try search_after with sort
  console.log("\n🔬 Try search_after pagination");
  const first = await fetch(`${BASE}/bizs/${BIZ_SLUG}/customers`, {
    method: "POST",
    headers,
    body: JSON.stringify({ size: 100 }),
  });
  const firstData = await first.json() as { data?: { id?: string; created_at?: string; sort?: unknown[] }[] };
  const lastItem = firstData.data?.[firstData.data.length - 1];
  console.log(`Last item id: ${lastItem?.id}, sort: ${JSON.stringify(lastItem?.sort)}`);

  // Try using last created_at as cursor
  const nextRes = await fetch(`${BASE}/bizs/${BIZ_SLUG}/customers`, {
    method: "POST",
    headers,
    body: JSON.stringify({ size: 100, search_after: [lastItem?.created_at] }),
  });
  const nextData = await nextRes.json() as { data?: { id?: string; created_at?: string }[] };
  const nextFirst = nextData.data?.[0];
  console.log(`With search_after created_at → count=${nextData.data?.length}, first=${nextFirst?.created_at?.slice(0,10)}, same_id=${nextFirst?.id === lastItem?.id}`);
}
main().catch(console.error);
