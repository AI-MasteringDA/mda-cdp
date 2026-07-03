import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

/** Extract email/phone from any string, robust to spaces/format variations. */
export function extractContact(text: string): { email: string | null; phone: string | null } {
  if (!text) return { email: null, phone: null };
  const raw = String(text);

  // Email — permissive: any char sequence containing @ followed by domain
  const emailMatch = raw.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch?.[0]?.toLowerCase() || null;

  // Phone — strip spaces/dashes then match VN patterns
  const cleaned = raw.replace(/[\s\-()]/g, "");

  // Try order (most specific first):
  // 1) +84 + 9 digits (int'l): +84869689105
  // 2) 0 + (3|5|7|8|9) + 8 digits (local VN): 0869689105
  // 3) bare 9 digits starting with 3/5/7/8/9 (missing leading 0): 869689105
  let phoneMatch: RegExpMatchArray | null =
    cleaned.match(/\+84(3|5|7|8|9)\d{8}/) ||
    cleaned.match(/0(3|5|7|8|9)\d{8}/) ||
    cleaned.match(/(?<![\d])(3|5|7|8|9)\d{8}(?![\d])/);

  let phone: string | null = null;
  if (phoneMatch) {
    phone = phoneMatch[0].replace(/^\+84/, "0"); // normalize +84 → 0
    if (phone.length === 9) phone = "0" + phone;  // bare 9-digit → prepend 0
  }

  return { email, phone };
}

async function main() {
  console.log("🔍 Backfill SMAX phones/emails from full_name (all patterns)\n");

  const leads: { lead_id: string; full_name: string | null; phone: string | null; email: string | null }[] = [];
  let from = 0;
  while (true) {
    const { data } = await s.from("dim_lead").select("lead_id, full_name, phone, email").eq("source", "smax").range(from, from + 999);
    if (!data?.length) break;
    leads.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Total SMAX leads: ${leads.length}`);

  let phoneUpdates = 0;
  let emailUpdates = 0;
  let bothUpdates = 0;
  let errors = 0;
  const samples: string[] = [];

  for (const l of leads) {
    if (l.phone && l.email) continue;
    if (!l.full_name) continue;
    const { email, phone } = extractContact(l.full_name);
    const patch: Record<string, string> = {};
    if (!l.phone && phone) patch.phone = phone;
    if (!l.email && email) patch.email = email;
    if (Object.keys(patch).length === 0) continue;

    const { error } = await s.from("dim_lead").update(patch).eq("lead_id", l.lead_id);
    if (error) { errors++; continue; }

    if (patch.phone && patch.email) bothUpdates++;
    else if (patch.phone) phoneUpdates++;
    else if (patch.email) emailUpdates++;

    if (samples.length < 10) samples.push(`"${l.full_name}" → phone=${patch.phone || '-'} email=${patch.email || '-'}`);
  }

  console.log(`\n✅ Extracted from full_name:`);
  console.log(`   ${phoneUpdates} phones only`);
  console.log(`   ${emailUpdates} emails only`);
  console.log(`   ${bothUpdates} both`);
  console.log(`   ${errors} errors`);

  console.log(`\n📝 Sample extractions:`);
  samples.forEach((s) => console.log(`   ${s}`));

  // Verify final coverage
  const { count: total } = await s.from("dim_lead").select("*", { count: "exact", head: true }).eq("source", "smax");
  const { count: withPhone } = await s.from("dim_lead").select("*", { count: "exact", head: true }).eq("source", "smax").not("phone", "is", null);
  const { count: withEmail } = await s.from("dim_lead").select("*", { count: "exact", head: true }).eq("source", "smax").not("email", "is", null);
  const { count: withEither } = await s.from("dim_lead").select("*", { count: "exact", head: true }).eq("source", "smax").or("email.not.is.null,phone.not.is.null");

  console.log(`\n📊 SMAX identifier coverage after backfill:`);
  console.log(`   Total:      ${total}`);
  console.log(`   Has phone:  ${withPhone}`);
  console.log(`   Has email:  ${withEmail}`);
  console.log(`   Has either: ${withEither} (${Math.round((withEither! / total!) * 100)}%)`);
}
main().catch(console.error);
