import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  const { data, count } = await admin
    .from("ai_cache")
    .select("cache_key, metadata, created_at, updated_at", { count: "exact" })
    .order("updated_at", { ascending: false });

  console.log(`📦 ai_cache total rows: ${count}\n`);
  for (const row of data ?? []) {
    console.log(`Key:        ${row.cache_key}`);
    console.log(`Updated:    ${row.updated_at}`);
    console.log(`Metadata:   ${JSON.stringify(row.metadata).slice(0, 150)}`);
    console.log();
  }
}

main().catch(console.error);
