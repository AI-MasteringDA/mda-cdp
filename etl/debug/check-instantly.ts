import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  const { data } = await admin
    .from("sync_job")
    .select("*")
    .eq("source", "instantly")
    .order("started_at", { ascending: false })
    .limit(5);
  for (const j of data ?? []) {
    console.log(`${j.started_at} ${j.status} in=${j.records_in} merged=${j.records_merged}`);
    if (j.error_message) console.log(`  ERR: ${j.error_message}`);
  }
}
main().catch(console.error);
