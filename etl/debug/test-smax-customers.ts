import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const TOKEN = process.env.SMAX_USER_TOKEN;
  const BASE = "https://api.smax.ai";
  const BIZ_SLUG = "mastering-data-analytics";
  const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

  console.log("🔬 Test /customers endpoint pagination + full data\n");

  // First call empty
  const first = await fetch(`${BASE}/bizs/${BIZ_SLUG}/customers`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  const firstData = await first.json() as { data?: unknown[]; total?: number };
  console.log(`Empty body → status ${first.status}, data.length = ${(firstData.data as unknown[])?.length}, total = ${firstData.total}`);
  console.log(`Sample record:`, JSON.stringify((firstData.data as unknown[])?.[0], null, 2).slice(0, 1500));

  console.log("\n─── Test pagination ───");
  for (const skip of [0, 100, 500, 1000, 5000, 10000]) {
    const res = await fetch(`${BASE}/bizs/${BIZ_SLUG}/customers`, {
      method: "POST",
      headers,
      body: JSON.stringify({ skip, limit: 100 }),
    });
    const data = await res.json() as { data?: { id?: string; created_at?: string; updated_at?: string }[]; total?: number };
    const items = data.data || [];
    const first = items[0];
    const last = items[items.length-1];
    console.log(`skip=${String(skip).padEnd(6)} count=${String(items.length).padEnd(4)} total=${data.total || "?"} first_created=${first?.created_at?.slice(0,10) || "-"} last_created=${last?.created_at?.slice(0,10) || "-"}`);
  }
}
main().catch(console.error);
