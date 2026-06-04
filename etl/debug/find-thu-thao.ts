import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  const { data } = await admin
    .from("dim_lead")
    .select("lead_id, full_name, email")
    .ilike("full_name", "%thu thảo%")
    .limit(5);
  console.log("Matches:", data);

  const { data: byEmail } = await admin
    .from("dim_lead")
    .select("lead_id, full_name, email")
    .eq("email", "thuthao4239@gmail.com")
    .maybeSingle();
  console.log("ByEmail:", byEmail);
}

main().catch(console.error);
