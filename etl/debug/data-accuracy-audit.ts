import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function count(table: string, filter?: any): Promise<number> {
  let q = admin.from(table).select("*", { count: "exact", head: true });
  if (filter?.eq) for (const [k, v] of Object.entries(filter.eq)) q = q.eq(k, v as any);
  if (filter?.gte) for (const [k, v] of Object.entries(filter.gte)) q = q.gte(k, v as any);
  const { count } = await q;
  return count ?? 0;
}

async function main() {
  console.log("🔍 DATA ACCURACY AUDIT\n");

  const now = new Date();
  const iso30 = new Date(now.getTime() - 30 * 86400_000).toISOString();
  const iso7 = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const iso1 = new Date(now.getTime() - 86400_000).toISOString();

  // ═══ 1. dim_lead totals ═══
  console.log("═══ 1. dim_lead — WHO these leads are ═══");
  const totalLeads = await count("dim_lead");
  console.log(`   Total leads:              ${totalLeads.toLocaleString('vi-VN')}`);

  const bySource: Record<string, number> = {};
  for (const src of ["salesforce", "instantly", "smax", "web", "fanpage"]) {
    bySource[src] = await count("dim_lead", { eq: { source: src } });
  }
  console.log(`   By primary source:`);
  for (const [s, c] of Object.entries(bySource)) console.log(`     ${s.padEnd(12)}: ${c.toLocaleString('vi-VN')}`);

  // Stage distribution
  const stages: Record<string, number> = {};
  for (const st of ["Mới", "Đang tư vấn", "Đang cân nhắc", "Im lặng", "Ghi danh", "Đã chốt"]) {
    stages[st] = await count("dim_lead", { eq: { stage: st } });
  }
  console.log(`   By stage:`);
  for (const [s, c] of Object.entries(stages)) console.log(`     ${s.padEnd(15)}: ${c.toLocaleString('vi-VN')}`);

  // Duplicate email check
  const emails = new Map<string, number>();
  let from = 0;
  while (from < 50000) {
    const { data } = await admin.from("dim_lead").select("email").not("email", "is", null).range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const l of data) emails.set(l.email!.toLowerCase().trim(), (emails.get(l.email!.toLowerCase().trim()) || 0) + 1);
    if (data.length < 1000) break;
    from += 1000;
  }
  const dups = [...emails.entries()].filter(([, c]) => c > 1);
  console.log(`   Duplicate emails:         ${dups.length} (should be 0)`);
  if (dups.length > 0) dups.slice(0, 3).forEach(([e, c]) => console.log(`     ${e} × ${c}`));

  // ═══ 2. fact_touchpoint — timing ═══
  console.log("\n═══ 2. fact_touchpoint — WHEN activities happened ═══");
  const totalTp = await count("fact_touchpoint");
  const tp30d = await count("fact_touchpoint", { gte: { occurred_at: iso30 } });
  const tp7d = await count("fact_touchpoint", { gte: { occurred_at: iso7 } });
  const tp1d = await count("fact_touchpoint", { gte: { occurred_at: iso1 } });
  console.log(`   Total touchpoints:        ${totalTp.toLocaleString('vi-VN')}`);
  console.log(`   Last 30 days:             ${tp30d.toLocaleString('vi-VN')} (${(100*tp30d/totalTp).toFixed(1)}%)`);
  console.log(`   Last 7 days:              ${tp7d.toLocaleString('vi-VN')}`);
  console.log(`   Last 24 hours:            ${tp1d.toLocaleString('vi-VN')}`);

  // Breakdown by source × event_type (recent 30 days)
  console.log(`\n   Last 30 days breakdown:`);
  for (const src of ["salesforce", "smax", "instantly", "web"]) {
    for (const et of ["chat", "chat_staff", "email_sent", "email_open", "email_click", "conversion", "lost", "lead_created", "form_submit", "page_view"]) {
      const c = await count("fact_touchpoint", { gte: { occurred_at: iso30 }, eq: { source: src, event_type: et } });
      if (c > 0) console.log(`     ${src}/${et}: ${c}`);
    }
  }

  // ═══ 3. Suspicious patterns ═══
  console.log("\n═══ 3. Suspicious patterns to verify ═══");

  // Check: 25 leads with TVV chat = 1 day ago
  const iso3d = new Date(now.getTime() - 3 * 86400_000).toISOString();
  const { data: tvvActive } = await admin.from("dim_lead")
    .select("full_name, last_chat_staff_at").gte("last_chat_staff_at", iso3d).order("last_chat_staff_at", { ascending: false }).limit(30);
  console.log(`   Leads with TVV chat in 3 days: ${tvvActive?.length}`);
  const groups: Record<string, number> = {};
  tvvActive?.forEach(l => {
    const day = l.last_chat_staff_at?.slice(0, 10);
    groups[day!] = (groups[day!] || 0) + 1;
  });
  console.log(`   Grouped by TVV chat date:`);
  Object.entries(groups).sort().forEach(([d, c]) => console.log(`     ${d}: ${c} leads`));

  // Check same-timestamp TVV chats (broadcast pattern)
  const { data: sameTs } = await admin.from("fact_touchpoint")
    .select("occurred_at, title, lead_id")
    .eq("event_type", "chat_staff").eq("source", "smax")
    .gte("occurred_at", iso3d).limit(50);
  const tsGroups: Record<string, string[]> = {};
  sameTs?.forEach(t => {
    const key = t.occurred_at.slice(0, 16); // group by minute
    tsGroups[key] = tsGroups[key] || [];
    tsGroups[key].push(t.title || '');
  });
  const bursts = Object.entries(tsGroups).filter(([, arr]) => arr.length >= 3);
  console.log(`\n   Same-minute TVV chat bursts (>=3 leads got same message):`);
  if (bursts.length === 0) console.log(`     None → no broadcast pattern detected`);
  bursts.slice(0, 5).forEach(([ts, arr]) => {
    console.log(`     ${ts}: ${arr.length} leads with msg "${arr[0].slice(0, 60)}"`);
  });

  // Data quality: leads with junk names (course names, product names)
  const { data: junkNames } = await admin.from("dim_lead")
    .select("full_name, email, source").ilike("full_name", "%KHOÁ%").limit(10);
  console.log(`\n   Leads with 'KHOÁ' in name (data quality issue):`);
  junkNames?.forEach(l => console.log(`     ${l.full_name?.slice(0, 60)} (${l.email})`));

  // Check: revenue match
  console.log("\n═══ 4. Revenue verification ═══");
  const { data: won } = await admin.from("fact_touchpoint")
    .select("payload").eq("event_type", "conversion").eq("source", "salesforce")
    .gte("occurred_at", iso30);
  const totalRev = (won ?? []).reduce((s, r) => s + (Number((r.payload as any)?.amount) || 0), 0);
  console.log(`   Closed Won 30 days: ${won?.length} deals`);
  console.log(`   Total revenue:      ${totalRev.toLocaleString('vi-VN')} VND`);
  console.log(`   Avg deal:           ${(totalRev / (won?.length || 1)).toLocaleString('vi-VN', {maximumFractionDigits: 0})} VND`);
}

main().catch(console.error);
