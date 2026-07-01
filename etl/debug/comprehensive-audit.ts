import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

/** Full audit — find ALL remaining data quality issues */
async function main() {
  const issues: { severity: string; category: string; description: string; sample?: unknown }[] = [];

  console.log("🔍 COMPREHENSIVE DATA AUDIT — hunt for ALL bugs\n");

  // ═══════════════════════════════════════════════════════
  // CATEGORY A: DUPLICATE DETECTION
  // ═══════════════════════════════════════════════════════
  console.log("═══ A. Duplicate Detection ═══");

  // A1. Load ALL touchpoints paginated
  console.log("Loading all fact_touchpoint (this may take 30s)...");
  type TP = { id: string; lead_id: string; source: string; event_type: string; occurred_at: string; payload: any };
  const all: TP[] = [];
  let from = 0;
  while (true) {
    const { data } = await admin.from("fact_touchpoint")
      .select("id, lead_id, source, event_type, occurred_at, payload")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    all.push(...(data as TP[]));
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`   Loaded ${all.length.toLocaleString()} touchpoints\n`);

  // A1. Duplicate by (lead, source, event_type, date)
  const dateKey = new Map<string, number>();
  for (const t of all) {
    const k = `${t.lead_id}::${t.source}::${t.event_type}::${t.occurred_at.slice(0, 10)}`;
    dateKey.set(k, (dateKey.get(k) || 0) + 1);
  }
  const sameDateDups = [...dateKey.entries()].filter(([, c]) => c > 1);
  if (sameDateDups.length > 0) {
    const total = sameDateDups.reduce((s, [, c]) => s + c - 1, 0);
    issues.push({
      severity: "HIGH",
      category: "duplicate",
      description: `${sameDateDups.length} groups of same-day dups (${total} extra rows)`,
      sample: sameDateDups.slice(0, 5),
    });
    console.log(`   ❌ Same-day dups: ${sameDateDups.length} groups, ${total} extra rows`);
  } else {
    console.log(`   ✅ No same-day dups`);
  }

  // A2. Duplicate by exact (lead, source, event_type, occurred_at, title)
  const exactKey = new Map<string, TP[]>();
  for (const t of all) {
    const p = t.payload as any;
    const idKey = p?.raw_id || p?.task_id || p?.opportunity_id || p?.thread_id || p?.wix_contact_id || p?.wix_member_id || p?.sf_contact_id || p?.sf_lead_id || "";
    const k = `${t.lead_id}::${t.source}::${t.event_type}::${t.occurred_at}::${idKey}`;
    exactKey.set(k, [...(exactKey.get(k) || []), t]);
  }
  const exactDups = [...exactKey.entries()].filter(([, arr]) => arr.length > 1);
  if (exactDups.length > 0) {
    issues.push({
      severity: "HIGH",
      category: "duplicate",
      description: `${exactDups.length} groups of EXACT dups (same timestamp+id)`,
    });
    console.log(`   ❌ Exact dups: ${exactDups.length} groups`);
  } else {
    console.log(`   ✅ No exact dups`);
  }

  // A3. Same-second broadcasts (pattern where N leads got same message at same second)
  console.log("\n═══ B. Broadcast Detection ═══");
  const brdKey = new Map<string, TP[]>();
  for (const t of all) {
    if (t.event_type !== "chat_staff") continue;
    const p = t.payload as any;
    const k = `${t.occurred_at}::${(t as any).title || ""}`;
    brdKey.set(k, [...(brdKey.get(k) || []), t]);
  }
  const bursts = [...brdKey.entries()].filter(([, arr]) => arr.length >= 5);
  if (bursts.length > 0) {
    console.log(`   ⚠️ ${bursts.length} broadcast bursts (5+ leads same second):`);
    bursts.slice(0, 3).forEach(([k, arr]) => {
      const ts = k.split("::")[0].slice(0, 19);
      console.log(`     ${ts}: ${arr.length} leads`);
    });
  } else {
    console.log(`   ✅ No suspicious burst patterns`);
  }

  // ═══════════════════════════════════════════════════════
  // CATEGORY C: SEMANTIC CORRECTNESS
  // ═══════════════════════════════════════════════════════
  console.log("\n═══ C. Semantic Correctness ═══");

  // C1. Lead names quality
  const { data: badNames } = await admin.from("dim_lead")
    .select("full_name, email")
    .or("full_name.ilike.%KHOÁ%,full_name.ilike.%@%,full_name.ilike.%email%,full_name.eq.")
    .limit(20);
  if (badNames && badNames.length > 0) {
    issues.push({
      severity: "MEDIUM",
      category: "data quality",
      description: `${badNames.length}+ leads có tên = email/course-name/blank`,
      sample: badNames.slice(0, 5).map(l => `${l.full_name} (${l.email})`),
    });
    console.log(`   ⚠️ Suspicious names: ${badNames.length}`);
    badNames.slice(0, 5).forEach(l => console.log(`     "${l.full_name}" ${l.email}`));
  }

  // C2. Lead full_name = email (using email as name)
  const { data: nameIsEmail } = await admin.from("dim_lead")
    .select("full_name, email")
    .not("email", "is", null)
    .limit(5000);
  const nameEqEmail = (nameIsEmail || []).filter(l => l.full_name?.toLowerCase() === l.email?.toLowerCase());
  if (nameEqEmail.length > 0) {
    issues.push({
      severity: "LOW",
      category: "data quality",
      description: `${nameEqEmail.length} leads có full_name == email (chưa được set tên thật)`,
    });
    console.log(`   ⚠️ full_name == email: ${nameEqEmail.length} leads`);
  }

  // C3. Check SMAX chat sender misclassification
  console.log("\n═══ D. SMAX Sender Classification ═══");
  const { data: smax } = await admin.from("fact_touchpoint")
    .select("event_type, payload, lead_id")
    .eq("source", "smax")
    .limit(2000);
  const senderIssues = (smax || []).filter(t => {
    const p = t.payload as any;
    const isStaffFlag = p?.sender_is_staff;
    // Chat but flagged staff → misclassification
    if (t.event_type === "chat" && isStaffFlag === true) return true;
    // Chat_staff but sender NOT staff
    if (t.event_type === "chat_staff" && isStaffFlag === false) return true;
    return false;
  });
  if (senderIssues.length > 0) {
    issues.push({
      severity: "MEDIUM",
      category: "SMAX classification",
      description: `${senderIssues.length} SMAX threads có event_type không match sender_is_staff flag`,
    });
    console.log(`   ⚠️ Sender mismatch: ${senderIssues.length} threads`);
  } else {
    console.log(`   ✅ SMAX sender classification OK`);
  }

  // ═══════════════════════════════════════════════════════
  // CATEGORY E: AGGREGATE ACCURACY
  // ═══════════════════════════════════════════════════════
  console.log("\n═══ E. Aggregate Accuracy ═══");

  // E1. Check aggregate counters vs actual counts (sample 5 leads)
  const { data: sample } = await admin.from("dim_lead")
    .select("lead_id, full_name, email, form_submit_count, chat_count, email_open_count, total_touchpoints")
    .gt("total_touchpoints", 5)
    .limit(5);

  let aggInconsistent = 0;
  for (const s of sample || []) {
    const [tps, forms, chats, opens] = await Promise.all([
      admin.from("fact_touchpoint").select("*", {count:"exact", head:true}).eq("lead_id", s.lead_id),
      admin.from("fact_touchpoint").select("*", {count:"exact", head:true}).eq("lead_id", s.lead_id).eq("event_type", "form_submit"),
      admin.from("fact_touchpoint").select("*", {count:"exact", head:true}).eq("lead_id", s.lead_id).eq("event_type", "chat"),
      admin.from("fact_touchpoint").select("*", {count:"exact", head:true}).eq("lead_id", s.lead_id).eq("event_type", "email_open"),
    ]);
    const diff = s.total_touchpoints !== tps.count || s.form_submit_count !== forms.count;
    if (diff) {
      aggInconsistent++;
      console.log(`   ⚠️ ${s.full_name}: cached total=${s.total_touchpoints} vs actual=${tps.count}, form ${s.form_submit_count} vs ${forms.count}`);
    }
  }
  if (aggInconsistent === 0) console.log(`   ✅ Sample aggregates match actual counts`);

  // ═══════════════════════════════════════════════════════
  // CATEGORY F: STAGE SYNC
  // ═══════════════════════════════════════════════════════
  console.log("\n═══ F. Stage Sync ═══");
  const { count: convLeads } = await admin.from("dim_lead")
    .select("*", { count: "exact", head: true })
    .gt("conversion_count", 0)
    .neq("stage", "Đã chốt");
  if ((convLeads ?? 0) > 0) {
    issues.push({
      severity: "HIGH",
      category: "stage sync",
      description: `${convLeads} leads có conversion nhưng stage != 'Đã chốt'`,
    });
    console.log(`   ❌ Leads with conversion but stage != Đã chốt: ${convLeads}`);
  } else {
    console.log(`   ✅ All converted leads correctly marked 'Đã chốt'`);
  }

  // ═══════════════════════════════════════════════════════
  // CATEGORY G: ORPHANS & MISSING
  // ═══════════════════════════════════════════════════════
  console.log("\n═══ G. Orphans & Missing Data ═══");

  // G1. Leads without email AND phone (can't be contacted)
  const { count: noContact } = await admin.from("dim_lead")
    .select("*", { count: "exact", head: true })
    .is("email", null)
    .is("phone", null);
  if ((noContact ?? 0) > 0) {
    issues.push({
      severity: "LOW",
      category: "missing data",
      description: `${noContact} leads không có email VÀ phone (chưa identity resolve được)`,
    });
    console.log(`   ⚠️ Unreachable leads (no email/phone): ${noContact}`);
  } else {
    console.log(`   ✅ All leads have contact info`);
  }

  // G2. Instantly opens vs sends ratio
  const { count: sentSF } = await admin.from("fact_touchpoint")
    .select("*", {count:"exact", head:true}).eq("event_type", "email_sent");
  const { count: opens } = await admin.from("fact_touchpoint")
    .select("*", {count:"exact", head:true}).eq("event_type", "email_open");
  if (opens != null && sentSF != null && sentSF > 100 && opens / sentSF < 0.02) {
    issues.push({
      severity: "HIGH",
      category: "tracking",
      description: `Email open rate = ${(100*opens/sentSF).toFixed(2)}% (${opens}/${sentSF}) — tracking pixel HỎNG`,
    });
    console.log(`   ❌ Email tracking: ${opens} opens / ${sentSF} sent = ${(100*opens/sentSF).toFixed(2)}%`);
  }

  // ═══════════════════════════════════════════════════════
  // CATEGORY H: CROSS-SOURCE CONSISTENCY
  // ═══════════════════════════════════════════════════════
  console.log("\n═══ H. Cross-source Consistency ═══");

  // H1. SF Opps count vs conversion events
  const { count: convEvents } = await admin.from("fact_touchpoint")
    .select("*", {count:"exact", head:true}).eq("event_type", "conversion").eq("source", "salesforce");
  const { count: closedLeads } = await admin.from("dim_lead")
    .select("*", {count:"exact", head:true}).eq("stage", "Đã chốt");
  console.log(`   SF conversion events: ${convEvents}, closed leads: ${closedLeads}`);
  if ((convEvents ?? 0) > (closedLeads ?? 0)) {
    const extra = (convEvents ?? 0) - (closedLeads ?? 0);
    console.log(`   ℹ️ ${extra} multi-purchase customers (normal)`);
  }

  // ═══════════════════════════════════════════════════════
  // CATEGORY I: SCORING SANITY
  // ═══════════════════════════════════════════════════════
  console.log("\n═══ I. Scoring Sanity ═══");
  const today = new Date().toISOString().slice(0, 10);
  const { data: extremeScores } = await admin.from("fact_lead_score")
    .select("hot_score, hot_reasons, lead_id, dim_lead!inner(full_name, engagement_count)")
    .eq("scored_at", today)
    .or("hot_score.eq.100,hot_score.eq.0")
    .limit(10);
  console.log(`   Extreme scores (0 or 100): ${extremeScores?.length}`);
  extremeScores?.forEach((s: any) => {
    const eng = s.dim_lead.engagement_count;
    const nReasons = (s.hot_reasons || []).length;
    if (s.hot_score === 100 && eng === 0) {
      issues.push({
        severity: "HIGH",
        category: "scoring anomaly",
        description: `Lead ${s.dim_lead.full_name}: score 100 nhưng engagement=0`,
      });
      console.log(`   ❌ ${s.dim_lead.full_name}: 100 pts, 0 engagement`);
    }
  });

  // ═══════════════════════════════════════════════════════
  // CATEGORY J: DIM_LEAD ANOMALIES
  // ═══════════════════════════════════════════════════════
  console.log("\n═══ J. dim_lead Anomalies ═══");

  // Leads with negative counts (impossible)
  const { count: negTps } = await admin.from("dim_lead")
    .select("*", {count:"exact", head:true}).lt("total_touchpoints", 0);
  if ((negTps ?? 0) > 0) {
    issues.push({severity: "HIGH", category: "data corruption", description: `${negTps} leads có total_touchpoints < 0`});
  }

  // Leads with last_email_at in future
  const { data: futureLeads } = await admin.from("dim_lead")
    .select("full_name, last_email_at, last_chat_at, last_form_submit_at")
    .or(`last_email_at.gt.${new Date().toISOString()},last_chat_at.gt.${new Date().toISOString()}`)
    .limit(5);
  if (futureLeads && futureLeads.length > 0) {
    issues.push({
      severity: "MEDIUM",
      category: "temporal",
      description: `${futureLeads.length} leads có timestamp trong tương lai`,
    });
    console.log(`   ⚠️ Future timestamps: ${futureLeads.length}`);
    futureLeads.forEach(l => console.log(`     ${l.full_name}: email=${l.last_email_at}, chat=${l.last_chat_at}`));
  }

  // ═══════════════════════════════════════════════════════
  // FINAL REPORT
  // ═══════════════════════════════════════════════════════
  console.log("\n╔═══════════════════════════════════════════╗");
  console.log("║  🎯 FINAL AUDIT REPORT                     ║");
  console.log("╚═══════════════════════════════════════════╝");
  console.log(`\nTotal issues found: ${issues.length}`);
  const bySev = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  issues.forEach(i => bySev[i.severity as keyof typeof bySev]++);
  console.log(`   HIGH:   ${bySev.HIGH}`);
  console.log(`   MEDIUM: ${bySev.MEDIUM}`);
  console.log(`   LOW:    ${bySev.LOW}\n`);

  issues.sort((a, b) => ["HIGH", "MEDIUM", "LOW"].indexOf(a.severity) - ["HIGH", "MEDIUM", "LOW"].indexOf(b.severity));
  issues.forEach((i, idx) => {
    console.log(`${idx+1}. [${i.severity}] ${i.category}: ${i.description}`);
    if (i.sample) console.log(`   Sample:`, JSON.stringify(i.sample).slice(0, 200));
    console.log();
  });
}

main().catch(console.error);
