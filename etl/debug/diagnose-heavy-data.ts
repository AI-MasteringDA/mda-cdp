import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function tryQuery<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.log(`   ❌ ${label}: ${(e as Error).message.slice(0, 100)}`);
    return null;
  }
}

async function main() {
  console.log("🔍 DIAGNOSTIC — Heavy data analysis\n");

  // 1) Count per table
  console.log("📊 Row counts per table:");
  const tables = ["dim_lead", "fact_touchpoint", "fact_lead_score", "sync_job", "ai_cache", "workspace_secret"];
  for (const t of tables) {
    const result = await tryQuery(t, async () => {
      const { count, error } = await admin
        .from(t)
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      return count;
    });
    if (result !== null) {
      console.log(`   ${t.padEnd(25)}: ${(result ?? 0).toLocaleString("vi-VN")}`);
    }
  }

  // 2) fact_touchpoint breakdown by source
  console.log("\n📦 fact_touchpoint by source:");
  for (const src of ["salesforce", "smax", "instantly", "web"]) {
    const result = await tryQuery(`source=${src}`, async () => {
      const { count } = await admin
        .from("fact_touchpoint")
        .select("*", { count: "exact", head: true })
        .eq("source", src);
      return count;
    });
    if (result !== null) {
      console.log(`   ${src.padEnd(15)}: ${(result ?? 0).toLocaleString("vi-VN")}`);
    }
  }

  // 3) Check duplicate users in dim_lead
  console.log("\n👥 Duplicate users in dim_lead:");
  const dupEmails = await tryQuery("dup emails", async () => {
    // Pull all emails (paginated)
    const emails = new Map<string, number>();
    let from = 0;
    while (from < 100000) {
      const { data } = await admin
        .from("dim_lead")
        .select("email")
        .not("email", "is", null)
        .range(from, from + 999);
      if (!data || data.length === 0) break;
      for (const l of data) {
        const e = (l.email || "").toLowerCase().trim();
        if (!e) continue;
        emails.set(e, (emails.get(e) || 0) + 1);
      }
      if (data.length < 1000) break;
      from += 1000;
    }
    return [...emails.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);
  });
  if (dupEmails) {
    console.log(`   Total leads with duplicate email: ${dupEmails.length}`);
    if (dupEmails.length > 0) {
      console.log(`   Top 5 dup emails:`);
      for (const [email, count] of dupEmails.slice(0, 5)) {
        console.log(`     ${email.padEnd(40)} → ${count} rows`);
      }
    }
  }

  // 4) Phone duplicates
  const dupPhones = await tryQuery("dup phones", async () => {
    const phones = new Map<string, number>();
    let from = 0;
    while (from < 100000) {
      const { data } = await admin
        .from("dim_lead")
        .select("phone")
        .not("phone", "is", null)
        .range(from, from + 999);
      if (!data || data.length === 0) break;
      for (const l of data) {
        const p = (l.phone || "").replace(/\D/g, "").replace(/^0+/, "");
        if (!p) continue;
        phones.set(p, (phones.get(p) || 0) + 1);
      }
      if (data.length < 1000) break;
      from += 1000;
    }
    return [...phones.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);
  });
  if (dupPhones) {
    console.log(`   Total leads with duplicate phone: ${dupPhones.length}`);
    if (dupPhones.length > 0) {
      console.log(`   Top 5 dup phones:`);
      for (const [phone, count] of dupPhones.slice(0, 5)) {
        console.log(`     ${phone.padEnd(20)} → ${count} rows`);
      }
    }
  }

  // 5) Top 10 heaviest leads (most touchpoints)
  console.log("\n🐘 Top 10 heaviest leads (most touchpoints):");
  await tryQuery("heaviest leads", async () => {
    const { data } = await admin
      .from("dim_lead")
      .select("full_name, email, total_touchpoints")
      .order("total_touchpoints", { ascending: false })
      .limit(10);
    for (const l of data ?? []) {
      console.log(`   ${(l.full_name || "—").slice(0, 25).padEnd(28)} ${(l.email || "").slice(0, 30).padEnd(33)} ${l.total_touchpoints?.toLocaleString("vi-VN").padStart(6)} tps`);
    }
  });

  // 6) Storage estimate
  console.log("\n💾 Estimated storage:");
  await tryQuery("storage", async () => {
    const { data } = await admin.rpc("get_db_size" as never);
    if (data) console.log(`   DB size: ${data}`);
    else console.log(`   (no get_db_size RPC available)`);
  });

  console.log("\n✅ Diagnostic done.");
}

main().catch((e) => {
  console.error("Top-level error:", e);
  process.exit(1);
});
