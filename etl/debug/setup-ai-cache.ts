import { config } from "dotenv";
import { resolve } from "path";
import { readFileSync } from "fs";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  console.log("📋 Setting up ai_cache table...\n");

  // Test if table exists by selecting
  const { error: testErr } = await admin
    .from("ai_cache")
    .select("id", { count: "exact", head: true });

  if (!testErr) {
    console.log("✅ ai_cache table already exists.");
    const { count } = await admin
      .from("ai_cache")
      .select("*", { count: "exact", head: true });
    console.log(`   Current rows: ${count ?? 0}`);
    return;
  }

  console.log("⚠️  ai_cache table not found.");
  console.log("");
  console.log("Manual step:");
  console.log("1. Open Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql");
  console.log("2. Copy + paste the content of: supabase/add-ai-cache.sql");
  console.log("3. Click Run");
  console.log("");

  // Print the SQL to console for convenience
  try {
    const sql = readFileSync(resolve(process.cwd(), "supabase/add-ai-cache.sql"), "utf8");
    console.log("===SQL TO RUN===");
    console.log(sql);
    console.log("===END===");
  } catch (e) {
    console.error("Could not read SQL file:", e);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
