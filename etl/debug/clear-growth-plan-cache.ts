import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  const { error } = await admin
    .from("ai_cache")
    .delete()
    .eq("cache_key", "growth_plan:default");
  if (error) {
    console.error("Failed:", error.message);
    process.exit(1);
  }
  console.log("✅ Cleared growth_plan:default cache row.");

  const { count } = await admin
    .from("ai_cache")
    .select("*", { count: "exact", head: true });
  console.log(`   Remaining ai_cache rows: ${count ?? 0}`);
}

main().catch(console.error);
