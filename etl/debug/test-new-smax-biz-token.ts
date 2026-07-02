import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const NEW_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4MGYwZmU5NGEwODA0ZDdiNmEyZGVlZiIsIm9iamVjdCI6ImJpeiIsImlhdCI6MTc4MDMwNTA1MSwiZXhwIjozMTczMjQ3NDc0NTF9.v2KzfZBtgDaE5hJViBiVYGzavzbVJMxndnAp0lbZFnk";
  const BASE = "https://api.smax.ai";
  const BIZ_SLUG = "mastering-data-analytics";
  const PAGE_PIDS = [
    "fb102323788540150", "fb107203051058856", "zlw543187459113764384",
    "zl2235256473219383054", "ctm68188e11779d16c0779c018c",
    "ig17841446528067260", "ig17841460097450702",
  ];

  console.log("🔍 Test NEW biz token trên nhiều endpoints:\n");

  // Decode JWT payload
  const [, payload] = NEW_TOKEN.split(".");
  const decoded = JSON.parse(Buffer.from(payload, "base64").toString());
  console.log("Token info:", decoded);
  const expDate = decoded.exp > 1e12 ? new Date(decoded.exp) : new Date(decoded.exp * 1000);
  console.log(`Expires: ${expDate.toISOString()}`);
  console.log(`Object type: ${decoded.object}`);
  console.log("");

  const headers = { Authorization: `Bearer ${NEW_TOKEN}`, "Content-Type": "application/json" };

  // Test many endpoints
  const tests: [string, string, RequestInit][] = [
    // [name, url, options]
    ["POST /threads", `${BASE}/bizs/${BIZ_SLUG}/threads`, { method: "POST", headers, body: JSON.stringify({ page_pids: PAGE_PIDS, skip: 0, limit: 5 }) }],
    ["GET /bizs/{slug}", `${BASE}/bizs/${BIZ_SLUG}`, { headers }],
    ["GET /users/me", `${BASE}/users/me`, { headers }],
    ["GET /bizs/{slug}/pages", `${BASE}/bizs/${BIZ_SLUG}/pages`, { headers }],
    ["GET /bizs/{slug}/messages", `${BASE}/bizs/${BIZ_SLUG}/messages`, { headers }],
    ["GET /bizs/{slug}/customers", `${BASE}/bizs/${BIZ_SLUG}/customers`, { headers }],
    ["POST /bizs/{slug}/customers/search", `${BASE}/bizs/${BIZ_SLUG}/customers/search`, { method: "POST", headers, body: JSON.stringify({ skip: 0, limit: 5 }) }],
    ["POST /bizs/{slug}/messages/search", `${BASE}/bizs/${BIZ_SLUG}/messages/search`, { method: "POST", headers, body: JSON.stringify({ skip: 0, limit: 5 }) }],
    ["POST /bizs/{slug}/threads/search", `${BASE}/bizs/${BIZ_SLUG}/threads/search`, { method: "POST", headers, body: JSON.stringify({ skip: 0, limit: 5 }) }],
    ["GET /bizs/{slug}/analytics", `${BASE}/bizs/${BIZ_SLUG}/analytics`, { headers }],
    ["GET /bizs/{slug}/statistics", `${BASE}/bizs/${BIZ_SLUG}/statistics`, { headers }],
    ["POST /bizs/{slug}/export/threads", `${BASE}/bizs/${BIZ_SLUG}/export/threads`, { method: "POST", headers, body: JSON.stringify({ from: "2026-06-01", to: "2026-07-02" }) }],
  ];

  for (const [name, url, opts] of tests) {
    try {
      const res = await fetch(url, opts);
      let itemCount = "";
      if (res.status === 200 || res.status === 201) {
        try {
          const data = await res.json();
          const items = data.data || data.items || (Array.isArray(data) ? data : []);
          itemCount = ` items=${items.length}`;
          if (items.length > 0 && items[0].id) {
            itemCount += ` sample=${JSON.stringify(items[0]).slice(0, 100)}`;
          }
        } catch {}
      }
      console.log(`${res.status}  ${name.padEnd(45)}${itemCount}`);
    } catch (e) {
      console.log(`ERR ${name}: ${(e as Error).message.slice(0, 60)}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
}

main().catch(console.error);
