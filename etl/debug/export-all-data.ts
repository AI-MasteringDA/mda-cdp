import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";
import * as XLSX from "xlsx";

/**
 * Export ALL data from 4 channels + dim_lead into 1 Excel file with 5 sheets.
 * User can open + verify data quality.
 */

async function loadAll(source: string) {
  const rows: unknown[] = [];
  let from = 0;
  while (true) {
    const { data } = await admin
      .from("fact_touchpoint")
      .select("*, dim_lead(full_name, email, phone, company, assignee, stage)")
      .eq("source", source)
      .order("occurred_at", { ascending: false })
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

function flatten(row: any) {
  const lead = row.dim_lead || {};
  const payload = row.payload || {};
  return {
    lead_name: lead.full_name || "",
    lead_email: lead.email || "",
    lead_phone: lead.phone || "",
    lead_company: lead.company || "",
    lead_stage: lead.stage || "",
    lead_assignee: lead.assignee || "",
    event_type: row.event_type,
    title: row.title || "",
    detail: row.detail || "",
    occurred_at: row.occurred_at?.slice(0, 19),
    payload_json: JSON.stringify(payload).slice(0, 500),
  };
}

async function main() {
  console.log("📊 Exporting all channels data...\n");

  const wb = XLSX.utils.book_new();

  for (const [source, sheetName] of [
    ["salesforce", "Salesforce"],
    ["smax", "SMAX"],
    ["instantly", "Instantly"],
    ["web", "Wix (Web)"],
  ] as const) {
    console.log(`Loading ${source}...`);
    const rows = await loadAll(source);
    const flat = rows.map(flatten);
    console.log(`  ${rows.length} rows`);
    const ws = XLSX.utils.json_to_sheet(flat);
    // Set column widths
    ws["!cols"] = [
      { wch: 25 }, // name
      { wch: 30 }, // email
      { wch: 15 }, // phone
      { wch: 20 }, // company
      { wch: 15 }, // stage
      { wch: 15 }, // assignee
      { wch: 15 }, // event_type
      { wch: 40 }, // title
      { wch: 40 }, // detail
      { wch: 20 }, // occurred_at
      { wch: 60 }, // payload
    ];
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  // Also add dim_lead sheet
  console.log("\nLoading dim_lead...");
  const leads: unknown[] = [];
  let from = 0;
  while (from < 100_000) {
    const { data } = await admin
      .from("dim_lead")
      .select("full_name, email, phone, company, source, stage, assignee, lead_source, total_touchpoints, email_open_count, email_click_count, email_reply_count, chat_count, chat_staff_count, form_submit_count, login_count, conversion_count, source_count, engagement_count, first_seen_at, last_engagement_at, customer_lifecycle_stage, lifetime_value, total_purchases, months_since_last_purchase")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    leads.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`  ${leads.length} leads`);
  const leadsWs = XLSX.utils.json_to_sheet(leads);
  XLSX.utils.book_append_sheet(wb, leadsWs, "Leads (dim_lead)");

  // Also add scores
  console.log("Loading scores...");
  const today = new Date().toISOString().slice(0, 10);
  const { data: scores } = await admin
    .from("fact_lead_score")
    .select("hot_score, hot_reasons, dim_lead(full_name, email, stage)")
    .eq("scored_at", today)
    .order("hot_score", { ascending: false })
    .limit(1000);
  const flatScores = (scores || []).map((s: any) => ({
    name: s.dim_lead?.full_name || "",
    email: s.dim_lead?.email || "",
    stage: s.dim_lead?.stage || "",
    hot_score: s.hot_score,
    tier: s.hot_score >= 70 ? "NÓNG" : s.hot_score >= 40 ? "ẤM" : s.hot_score >= 20 ? "MÁT" : "NGỦ ĐÔNG",
    reasons: JSON.stringify(s.hot_reasons || []).slice(0, 300),
  }));
  console.log(`  ${flatScores.length} scores`);
  const scoresWs = XLSX.utils.json_to_sheet(flatScores);
  XLSX.utils.book_append_sheet(wb, scoresWs, "Scores");

  const filename = `mda-cdp-data-export-${today}.xlsx`;
  const filepath = resolve(process.cwd(), filename);
  XLSX.writeFile(wb, filepath);
  console.log(`\n✅ Saved: ${filepath}`);
}

main().catch(console.error);
