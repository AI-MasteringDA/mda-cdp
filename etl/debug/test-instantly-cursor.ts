import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

const API_KEY = process.env.INSTANTLY_API_KEY!;
const BASE = process.env.INSTANTLY_BASE_URL || "https://api.instantly.ai/api/v2";

async function fetchPage(cursor?: string) {
  const u = new URL(`${BASE}/emails`);
  u.searchParams.set("limit", "100");
  if (cursor) u.searchParams.set("starting_after", cursor);
  const res = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  return { status: res.status, ok: res.ok, body: await res.text() };
}

async function main() {
  // 1) Load saved cursor
  const { data } = await admin
    .from("etl_state")
    .select("value")
    .eq("source", "instantly")
    .eq("key", "emails_cursor")
    .maybeSingle();
  const cursor = data?.value as string | undefined;
  console.log(`Saved cursor: ${cursor || "(none)"}`);

  // 2) Test that exact cursor
  if (cursor) {
    console.log(`\n--- Testing cursor ${cursor.slice(0, 12)}... ---`);
    const r = await fetchPage(cursor);
    console.log(`Status: ${r.status}`);
    console.log(`Body (200 chars): ${r.body.slice(0, 200)}`);
  }

  // 3) Test endpoint freshly (no cursor) — should always work
  console.log(`\n--- Testing /emails without cursor ---`);
  const fresh = await fetchPage();
  console.log(`Status: ${fresh.status}`);
  console.log(`Body (200 chars): ${fresh.body.slice(0, 200)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
