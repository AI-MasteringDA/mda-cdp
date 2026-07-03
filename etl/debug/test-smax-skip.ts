import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const TOKEN = process.env.SMAX_USER_TOKEN;
  const BASE = "https://api.smax.ai";
  const BIZ_SLUG = "mastering-data-analytics";
  const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

  const PAGE_PID = "fb102323788540150"; // FB Brand

  console.log("🔬 Test SMAX skip pagination on FB Brand\n");

  for (const skip of [0, 100, 200, 500, 1000, 2000, 5000]) {
    const res = await fetch(`${BASE}/bizs/${BIZ_SLUG}/threads`, {
      method: "POST",
      headers,
      body: JSON.stringify({ page_pids: [PAGE_PID], skip, limit: 100 }),
    });
    const data = await res.json() as { data?: unknown[]; total?: number };
    const items = (data.data as { id?: string; last_message_at?: string }[]) || [];
    const firstId = items[0]?.id?.slice(0,15) || "-";
    const lastId = items[items.length-1]?.id?.slice(0,15) || "-";
    const oldest = items.length ? items[items.length-1]?.last_message_at?.slice(0,10) : "-";
    const newest = items.length ? items[0]?.last_message_at?.slice(0,10) : "-";
    console.log(`skip=${String(skip).padEnd(6)} count=${String(items.length).padEnd(4)} total=${String(data.total || "?").padEnd(6)} first_id=${firstId} last=${lastId} range=${oldest}→${newest}`);
  }

  console.log("\n🔬 Try different pagination params:");
  for (const params of [
    { offset: 200, limit: 100 },
    { page: 2, limit: 100 },
    { page: 3, per_page: 100 },
    { from: 200, size: 100 },
  ]) {
    const res = await fetch(`${BASE}/bizs/${BIZ_SLUG}/threads`, {
      method: "POST",
      headers,
      body: JSON.stringify({ page_pids: [PAGE_PID], ...params }),
    });
    const data = await res.json() as { data?: unknown[]; total?: number };
    const items = (data.data as { id?: string; last_message_at?: string }[]) || [];
    const firstId = items[0]?.id?.slice(0,15) || "-";
    console.log(`params=${JSON.stringify(params).padEnd(35)} count=${items.length} first_id=${firstId}`);
  }
}
main().catch(console.error);
