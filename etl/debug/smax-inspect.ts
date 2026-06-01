import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const API_KEY = process.env.SMAX_API_KEY!;
const BASE = "https://api.smax.ai";
const BIZ_ID = "680f0fe94a0804d7b6a2deef";

async function probe(method: string, path: string, body?: unknown) {
  const url = `${BASE}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const status = res.status;
    const ct = res.headers.get("content-type") || "";
    let preview = "";
    if (ct.includes("json")) {
      const data = await res.json();
      if (status === 200) {
        preview = `keys: [${Object.keys(data).slice(0, 6).join(", ")}]`;
      } else {
        preview = (data.message || data.error || JSON.stringify(data)).toString().slice(0, 80);
      }
      return { status, preview, data };
    }
    return { status, preview: (await res.text()).slice(0, 100) };
  } catch (e) {
    return { status: 0, preview: (e as Error).message.slice(0, 80) };
  }
}

const TESTS: Array<{ method: string; path: string; body?: unknown; note: string }> = [
  // POST với body filter — common B2B pattern
  { method: "POST", path: `/bizs/${BIZ_ID}/customers/list`, body: { limit: 2 }, note: "POST list customers" },
  { method: "POST", path: `/bizs/${BIZ_ID}/customers/search`, body: { limit: 2 }, note: "POST search customers" },
  { method: "POST", path: `/bizs/${BIZ_ID}/threads/list`, body: { limit: 2 }, note: "POST list threads" },
  { method: "POST", path: `/customers/list`, body: { biz_id: BIZ_ID, limit: 2 }, note: "POST customers with biz_id" },
  { method: "POST", path: `/threads/list`, body: { biz_id: BIZ_ID, limit: 2 }, note: "POST threads with biz_id" },
  { method: "POST", path: `/messages/list`, body: { biz_id: BIZ_ID, limit: 2 }, note: "POST messages with biz_id" },

  // GraphQL?
  { method: "POST", path: `/graphql`, body: { query: "{ me { id } }" }, note: "GraphQL probe" },

  // Webhook subscription endpoints
  { method: "GET", path: `/webhooks`, note: "webhook list" },
  { method: "GET", path: `/triggers`, note: "trigger list (Bot API)" },
  { method: "POST", path: `/triggers`, body: {}, note: "trigger POST (Bot API)" },

  // Try /bizs/{id} with different scope
  { method: "GET", path: `/bizs/${BIZ_ID}/info`, note: "biz info" },
  { method: "GET", path: `/bizs/${BIZ_ID}/stats`, note: "biz stats" },
];

async function main() {
  console.log("=== INSPECT SMAX API (POST + alt patterns) ===\n");
  for (const t of TESTS) {
    const r = await probe(t.method, t.path, t.body);
    const icon = r.status === 200 ? "✅" : r.status === 401 || r.status === 403 ? "🔒" : r.status === 404 ? "  " : r.status === 0 ? "❌" : "⚠️ ";
    console.log(`${icon} ${String(r.status).padStart(3)}  ${t.method.padEnd(5)} ${t.path.padEnd(45)} ${r.preview}`);
  }

  console.log("\n\n=== DETAIL ✅ 200 responses ===");
  for (const t of TESTS) {
    const r = await probe(t.method, t.path, t.body);
    if (r.status === 200 && r.data) {
      console.log(`\n🎯 ${t.method} ${t.path}:`);
      console.log(JSON.stringify(r.data, null, 2).slice(0, 1500));
    }
  }
}

main().catch(console.error);
