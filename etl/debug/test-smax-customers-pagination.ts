import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const TOKEN = process.env.SMAX_USER_TOKEN;
  const BASE = "https://api.smax.ai";
  const BIZ_SLUG = "mastering-data-analytics";
  const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

  console.log("🔬 Test /customers pagination variations\n");

  for (const body of [
    { limit: 500 },
    { limit: 1000 },
    { size: 100 },
    { size: 500 },
    { per_page: 100 },
    { page: 2, limit: 20 },
    { page: 10, limit: 20 },
    { from: 100, size: 20 },
    { after: "2026-07-02", limit: 100 },
    { sort: [{ created_at: "desc" }], limit: 100 },
    { query: { match_all: {} }, size: 100 },
    { created_at: { gte: "2025-01-01", lte: "2025-06-01" }, limit: 100 },
  ]) {
    const res = await fetch(`${BASE}/bizs/${BIZ_SLUG}/customers`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json() as { data?: { id?: string; created_at?: string }[]; total?: number };
    const items = data.data || [];
    const first = items[0];
    const last = items[items.length-1];
    console.log(`body=${JSON.stringify(body).slice(0,70).padEnd(75)} count=${String(items.length).padEnd(4)} first=${first?.created_at?.slice(0,10) || "-"} last=${last?.created_at?.slice(0,10) || "-"}`);
  }

  console.log("\n🔬 Try scroll_id pattern (ES-style)");
  const initial = await fetch(`${BASE}/bizs/${BIZ_SLUG}/customers`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  const initialData = await initial.json() as Record<string, unknown>;
  console.log("Keys in response:", Object.keys(initialData));
  console.log("Full response (truncated):", JSON.stringify(initialData).slice(0, 500));

  const scrollId = initialData.scroll_id || initialData._scroll_id || initialData.pit_id || initialData.next_token || initialData.next_cursor;
  if (scrollId) {
    console.log(`\nFound scroll/cursor token: ${scrollId}`);
    const next = await fetch(`${BASE}/bizs/${BIZ_SLUG}/customers`, {
      method: "POST",
      headers,
      body: JSON.stringify({ scroll_id: scrollId }),
    });
    const nextData = await next.json() as { data?: unknown[] };
    console.log(`With scroll_id → count = ${(nextData.data as unknown[])?.length}`);
  } else {
    console.log("No scroll/cursor token in response");
  }
}
main().catch(console.error);
