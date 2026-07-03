import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const TOKEN = process.env.SMAX_USER_TOKEN;
  const BASE = "https://api.smax.ai";
  const BIZ_SLUG = "mastering-data-analytics";
  const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

  for (const size of [12000, 15000, 18000]) {
    const start = Date.now();
    const res = await fetch(`${BASE}/bizs/${BIZ_SLUG}/customers`, {
      method: "POST",
      headers,
      body: JSON.stringify({ size }),
    });
    const data = await res.json() as { data?: { created_at?: string }[]; total?: number };
    const items = data.data || [];
    console.log(`size=${size} → count=${items.length}, oldest=${items[items.length-1]?.created_at?.slice(0,10) || "-"}, elapsed=${Date.now()-start}ms`);
  }
}
main().catch(console.error);
