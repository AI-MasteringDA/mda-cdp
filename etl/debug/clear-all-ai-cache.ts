import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  const { count: before } = await admin
    .from("ai_cache")
    .select("*", { count: "exact", head: true });
  console.log(`Before: ${before} rows`);

  const { error } = await admin
    .from("ai_cache")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (error) {
    console.error("Failed:", error.message);
    process.exit(1);
  }

  const { count: after } = await admin
    .from("ai_cache")
    .select("*", { count: "exact", head: true });
  console.log(`After:  ${after} rows`);
  console.log("✅ All ai_cache rows cleared. Next gen will produce fresh Vietnamese output.");
}

main().catch(console.error);
