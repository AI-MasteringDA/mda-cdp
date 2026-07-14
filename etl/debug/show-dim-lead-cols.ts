import { admin } from "../lib/supabase-admin";
async function main() {
  const { data } = await admin.from("dim_lead").select("*").limit(1);
  const cols = Object.keys(data?.[0] ?? {});
  console.log(`${cols.length} cột:\n`);
  console.log(cols.join("\n"));
}
main().catch(e => { console.error(e); process.exit(1); });
