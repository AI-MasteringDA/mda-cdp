import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

const ids = [
  "cc467de5-dce5-42da-9b79-33d0d3c539eb",
  "6ed5c4a3-d880-4846-a6d9-3e509b54fdf2",
  "bb9bed73-b3a9-47f5-ace9-e7efe5878bd4",
  "60a824f1-82da-4541-8406-c5178d7976e1",
  "97cd31a4-bcec-44bc-8951-0d08161af6eb",
  "9246d090-6f6f-4487-9e2f-3c316f217026",
  "ff4b9432-b3ed-4c93-aaed-75c0b590a848",
  "c7bd7f9f-0d3b-5a9a-b25e-6e5537cd0d32",
  "85b17bba-684a-44e0-9a55-970cf2542283",
  "e4d50c18-efc5-40f0-b444-3f0800fafb73",
  "fdc77375-5a91-4a51-a06d-fbea852bec5a",
  "99b7c9a2-2753-400b-8194-b2521de429d5",
];

async function main() {
  const { data, error } = await admin.from("dim_lead").select("lead_id, full_name, phone, email, external_profile_id, smax_customer_id, smax_tags").in("lead_id", ids);
  if (error) { console.log("ERR", error); process.exit(1); }
  for (const r of data || []) console.log(JSON.stringify(r));
  console.log(`\nTìm thấy ${data?.length || 0}/${ids.length}`);
  process.exit(0);
}
main();
