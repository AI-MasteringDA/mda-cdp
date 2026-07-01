import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

/**
 * Hit Instantly API directly to see raw event counts (opens/clicks/replies).
 * Compare with our DB — if API returns many opens but DB has 3, ETL bug.
 * If API also returns 3, then tracking not enabled in Instantly campaigns.
 */
async function main() {
  const API_KEY = process.env.INSTANTLY_API_KEY;
  const BASE = process.env.INSTANTLY_BASE_URL || "https://api.instantly.ai/api/v2";
  if (!API_KEY) throw new Error("Missing INSTANTLY_API_KEY");

  const headers = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };

  console.log("🔍 INSTANTLY API RAW EVENT COUNTS\n");

  // 1. Overall campaign stats
  console.log("═══ 1. Campaign list + stats ═══");
  const campaignsRes = await fetch(`${BASE}/campaigns?limit=20`, { headers });
  const campaigns = await campaignsRes.json();
  const items = campaigns.items || campaigns.data || campaigns || [];
  console.log(`   Found ${items.length} campaigns\n`);
  items.slice(0, 10).forEach((c: any) => {
    console.log(`   ${c.name || c.id?.slice(0, 12)}`);
    console.log(`     status: ${c.status}`);
  });

  // 2. Pull /emails endpoint (event stream) count by ue_type
  console.log("\n═══ 2. /emails event breakdown (last 30 days) ═══");
  const eventCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const eventLabels: Record<number, string> = { 1: "sent", 2: "opened", 3: "reply", 4: "click", 5: "bounce" };
  let cursor: string | undefined;
  let page = 0;
  const iso30 = new Date(Date.now() - 30 * 86400_000);
  let stopped = false;

  while (!stopped && page < 200) {
    const url = new URL(`${BASE}/emails`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("starting_after", cursor);
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      console.log(`   ❌ API error page ${page}: ${res.status}`);
      break;
    }
    const data: any = await res.json();
    const emails = data.items || data.data || [];
    if (emails.length === 0) break;

    for (const e of emails) {
      const t = new Date(e.timestamp_email || 0).getTime();
      if (t < iso30.getTime()) { stopped = true; break; }
      const ue = e.ue_type;
      if (typeof ue === "number") eventCounts[ue] = (eventCounts[ue] || 0) + 1;
    }
    cursor = data.next_starting_after || emails[emails.length - 1]?.id;
    page++;
    if (page % 20 === 0) {
      const sent = eventCounts[1] || 0, opens = eventCounts[2] || 0;
      console.log(`   page ${page}: sent=${sent} opens=${opens} clicks=${eventCounts[4]} replies=${eventCounts[3]}`);
    }
  }

  console.log(`\n   TỔNG 30 ngày:`);
  for (const [ue, count] of Object.entries(eventCounts)) {
    const label = eventLabels[Number(ue)];
    console.log(`     ${label.padEnd(10)}: ${count.toLocaleString()}`);
  }

  const sent = eventCounts[1] || 0;
  const opens = eventCounts[2] || 0;
  const openRate = sent > 0 ? (100 * opens / sent).toFixed(2) : "0";
  console.log(`\n   📊 Open rate (Instantly API): ${openRate}%`);
  console.log(`   📊 Expected industry avg:      15-25%`);
  console.log(`   📊 Our DB shows:               0.02% (3 opens)\n`);

  if (opens < 10 && sent > 100) {
    console.log("   🚨 CONCLUSION: Instantly API returns almost NO opens");
    console.log("      → Tracking pixel KHÔNG được enable trong campaign settings");
    console.log("      → HOẶC domain reputation bị block khiến pixel không fire");
    console.log("      → Cần vào Instantly UI check campaign settings\n");
  } else if (opens > 10 && page * 100 < opens * 5) {
    console.log("   🚨 CONCLUSION: Instantly API TRẢ opens NHIỀU nhưng DB thiếu");
    console.log("      → ETL bug — có filter accidentally skip event type 2\n");
  } else {
    console.log(`   ℹ️ Similar to DB — no ETL bug, tracking data quality issue\n`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
