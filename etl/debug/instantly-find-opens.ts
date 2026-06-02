import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const KEY = process.env.INSTANTLY_API_KEY!;
const BASE = "https://api.instantly.ai/api/v2";

async function tryEndpoint(method: "GET" | "POST", path: string, body?: object) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = (await res.text()).slice(0, 300);
    console.log(`  ${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  } catch (e) {
    console.log(`  ${method} ${path} → ERROR ${(e as Error).message.slice(0, 100)}`);
  }
}

async function main() {
  console.log("=== Probing Instantly v2 endpoints for opens/clicks ===\n");

  // 1. Get one email and inspect fields
  console.log("--- /emails sample (look for is_opened, opens_count, etc) ---");
  const res = await fetch(`${BASE}/emails?limit=2`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  const data = await res.json();
  if (data.items?.[0]) {
    console.log("Fields:", Object.keys(data.items[0]).join(", "));
    console.log("Sample:", JSON.stringify(data.items[0], null, 2).slice(0, 800));
  }

  // 2. Try various endpoints
  console.log("\n--- Probing possible opens endpoints ---");
  await tryEndpoint("GET", "/email-events");
  await tryEndpoint("GET", "/events");
  await tryEndpoint("GET", "/emails/opens");
  await tryEndpoint("POST", "/emails/list", { limit: 1, include_opens: true });
  await tryEndpoint("GET", "/campaigns/analytics");
  await tryEndpoint("GET", "/leads/analytics");
}

main().catch(console.error);
