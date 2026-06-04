import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  // Try insert
  const { data, error } = await admin
    .from("ai_cache")
    .upsert({
      cache_key: "test:debug",
      payload: { hello: "world" },
      metadata: { test: true },
      updated_at: new Date().toISOString(),
    }, { onConflict: "cache_key" })
    .select();
  console.log("Insert:", data, "Error:", error);

  // Try select
  const { data: rows, error: e2 } = await admin
    .from("ai_cache")
    .select("*");
  console.log("\nAll rows:", rows?.length, "Error:", e2);
  if (rows) for (const r of rows) console.log("  -", r.cache_key);
}
main().catch(console.error);
