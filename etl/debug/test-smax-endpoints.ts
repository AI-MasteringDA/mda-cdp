import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const TOKEN = process.env.SMAX_USER_TOKEN;
  const BASE = "https://api.smax.ai";
  const BIZ_SLUG = "mastering-data-analytics";
  const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
  const PAGE_PID = "fb102323788540150";

  console.log("🔬 Try /threads with date filter\n");
  for (const body of [
    { page_pids: [PAGE_PID], last_message_at_from: "2025-01-01", last_message_at_to: "2025-06-01", limit: 100 },
    { page_pids: [PAGE_PID], from_date: "2025-01-01", to_date: "2025-06-01", limit: 100 },
    { page_pids: [PAGE_PID], start_date: "2025-01-01", end_date: "2025-06-01", limit: 100 },
    { page_pids: [PAGE_PID], date_from: "2025-01-01", date_to: "2025-06-01", limit: 100 },
    { page_pids: [PAGE_PID], created_from: "2025-01-01", created_to: "2025-06-01", limit: 100 },
    { page_pids: [PAGE_PID], sort: "asc", limit: 100 },  // oldest first
    { page_pids: [PAGE_PID], order: "asc", limit: 100 },
    { page_pids: [PAGE_PID], sort_by: "last_message_at", sort_order: "asc", limit: 100 },
  ]) {
    const res = await fetch(`${BASE}/bizs/${BIZ_SLUG}/threads`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json() as { data?: unknown[] };
    const items = (data.data as { id?: string; last_message_at?: string }[]) || [];
    const first = items[0];
    console.log(`body=${JSON.stringify(body).slice(0,80).padEnd(85)} count=${items.length} newest=${first?.last_message_at?.slice(0,10) || "-"} first=${first?.id?.slice(0,15) || "-"}`);
  }

  console.log("\n🔬 Try /customers endpoint");
  for (const path of [
    `/bizs/${BIZ_SLUG}/customers`,
    `/bizs/${BIZ_SLUG}/customers/search`,
    `/bizs/${BIZ_SLUG}/messages`,
    `/bizs/${BIZ_SLUG}/messages/search`,
    `/bizs/${BIZ_SLUG}/threads/search`,
    `/bizs/${BIZ_SLUG}/threads/history`,
    `/bizs/${BIZ_SLUG}/threads/all`,
  ]) {
    for (const method of ["GET", "POST"] as const) {
      const opts: RequestInit = { method, headers };
      if (method === "POST") opts.body = JSON.stringify({ page_pids: [PAGE_PID], limit: 100 });
      const res = await fetch(`${BASE}${path}`, opts);
      const text = await res.text();
      const truncated = text.slice(0, 100);
      console.log(`${method} ${path.padEnd(55)} → ${res.status} ${truncated.slice(0,80)}`);
      if (res.status === 200) {
        try {
          const j = JSON.parse(text);
          console.log(`      data count: ${Array.isArray(j.data) ? j.data.length : "no data array"}`);
        } catch { /* not json */ }
      }
    }
  }
}
main().catch(console.error);
