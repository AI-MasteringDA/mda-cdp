import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  // 1) Show current cursor
  const { data: before } = await admin
    .from("etl_state")
    .select("*")
    .eq("source", "instantly")
    .eq("key", "emails_cursor")
    .maybeSingle();
  console.log(`Before: ${before?.value || "(no cursor)"}`);

  // 2) Delete cursor
  const { error } = await admin
    .from("etl_state")
    .delete()
    .eq("source", "instantly")
    .eq("key", "emails_cursor");
  if (error) {
    console.error("Delete failed:", error.message);
    process.exit(1);
  }

  // 3) Verify cleared
  const { data: after } = await admin
    .from("etl_state")
    .select("*")
    .eq("source", "instantly")
    .eq("key", "emails_cursor")
    .maybeSingle();
  console.log(`After: ${after?.value || "(cleared ✓)"}`);

  console.log("\nNext sync will start from last successful sync timestamp (incremental).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
