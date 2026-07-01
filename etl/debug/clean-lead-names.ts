import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

/**
 * Auto-clean lead full_name where it equals email or looks like garbage.
 * Extract meaningful name from email prefix.
 * Example: "hongngoc.nguyen@jollibee.com.vn" → "Hong Ngoc Nguyen"
 */

function cleanName(email: string | null): string | null {
  if (!email) return null;
  const prefix = email.split("@")[0].trim();
  if (!prefix) return null;

  // Remove numbers at end (johnykhuong3420 → johnykhuong)
  let clean = prefix.replace(/[0-9]+$/, "");

  // Split by . _ -
  const parts = clean.split(/[._-]+/).filter(p => p.length > 0);
  if (parts.length === 0) return null;

  // Capitalize each part
  const capitalized = parts.map(p => {
    if (p.length <= 1) return p.toUpperCase();
    return p[0].toUpperCase() + p.slice(1).toLowerCase();
  });

  return capitalized.join(" ");
}

async function main() {
  console.log("🧹 Auto-clean lead names from email prefix...\n");

  // Fetch all leads paginated
  type Row = { lead_id: string; full_name: string | null; email: string | null };
  const rows: Row[] = [];
  let from = 0;
  while (true) {
    const { data } = await admin.from("dim_lead")
      .select("lead_id, full_name, email")
      .not("email", "is", null)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Loaded ${rows.length} leads with email`);

  // Find leads where full_name = email OR full_name contains @
  const needsClean = rows.filter(r => {
    if (!r.email || !r.full_name) return false;
    const n = r.full_name.toLowerCase().trim();
    const e = r.email.toLowerCase().trim();
    return n === e || n.includes("@") || n.includes("KHOÁ");
  });
  console.log(`Needs cleaning: ${needsClean.length}`);

  let updated = 0, skipped = 0;
  for (const r of needsClean) {
    const newName = cleanName(r.email);
    if (!newName || newName.toLowerCase() === r.email?.toLowerCase()) {
      skipped++;
      continue;
    }
    const { error } = await admin.from("dim_lead")
      .update({ full_name: newName })
      .eq("lead_id", r.lead_id);
    if (!error) {
      updated++;
      if (updated <= 10) {
        console.log(`   ✓ ${r.email} → "${newName}"`);
      }
    }
  }
  console.log(`\n✅ Updated ${updated} lead names, skipped ${skipped}`);

  // Verify count of leads where full_name = email
  const { data: verify } = await admin.from("dim_lead")
    .select("full_name, email").not("email", "is", null).limit(5000);
  const stillBad = (verify || []).filter(l =>
    l.full_name?.toLowerCase() === l.email?.toLowerCase() || l.full_name?.includes("@")
  ).length;
  console.log(`Remaining leads with name == email: ${stillBad}`);
}

main().catch(console.error);
