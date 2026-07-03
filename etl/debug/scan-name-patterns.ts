import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

async function main() {
  const leads: { lead_id: string; full_name: string | null; phone: string | null; email: string | null; source: string }[] = [];
  let from = 0;
  while (true) {
    const { data } = await s.from("dim_lead").select("lead_id, full_name, phone, email, source").eq("source", "smax").range(from, from + 999);
    if (!data?.length) break;
    leads.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const nullPE = leads.filter((l) => !l.phone && !l.email);
  console.log(`Total SMAX leads: ${leads.length}, null phone+email: ${nullPE.length}\n`);

  // Categorize patterns
  const buckets = {
    "has_at_symbol": [] as string[],
    "underscore_then_email": [] as string[],
    "underscore_then_intl_phone": [] as string[],
    "underscore_then_vn_phone": [] as string[],
    "has_plus84_anywhere": [] as string[],
    "long_digits_no_underscore": [] as string[],
    "just_name": [] as string[],
  };

  for (const l of nullPE) {
    const name = String(l.full_name || "").trim();
    if (!name) continue;
    const hasAt = name.includes("@");
    const parts = name.split("_");
    const lastPart = parts.length > 1 ? parts[parts.length - 1].trim() : "";

    if (hasAt && lastPart.includes("@")) buckets.underscore_then_email.push(name);
    else if (hasAt) buckets.has_at_symbol.push(name);
    else if (/_.*\+84/.test(name)) buckets.underscore_then_intl_phone.push(name);
    else if (parts.length > 1 && /^\+?\d[\d\s]{7,}$/.test(lastPart.replace(/\s/g, ""))) buckets.underscore_then_vn_phone.push(name);
    else if (name.includes("+84")) buckets.has_plus84_anywhere.push(name);
    else if (/\d{7,}/.test(name)) buckets.long_digits_no_underscore.push(name);
    else buckets.just_name.push(name);
  }

  console.log("📊 Pattern breakdown (null phone+email):");
  for (const [k, v] of Object.entries(buckets)) {
    console.log(`   ${k.padEnd(30)} = ${v.length}`);
    v.slice(0, 5).forEach((n) => console.log(`      "${n}"`));
  }
}
main().catch(console.error);
