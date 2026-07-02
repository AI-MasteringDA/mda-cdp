import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

/** Investigate what ue_type=3 and ue_type=4 actually mean in Instantly */
async function main() {
  const API_KEY = process.env.INSTANTLY_API_KEY;
  const BASE = "https://api.instantly.ai/api/v2";
  const headers = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };

  console.log("🔍 Explore Instantly ue_types\n");

  // Test each ue_type separately, show ALL fields of first result
  for (const ueType of [1, 2, 3, 4, 5]) {
    const url = new URL(`${BASE}/emails`);
    url.searchParams.set("limit", "3");
    url.searchParams.set("ue_type", String(ueType));

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      console.log(`ue_type=${ueType}: HTTP ${res.status}`);
      continue;
    }
    const data: any = await res.json();
    const items = data.items || [];
    console.log(`\n═══ ue_type=${ueType} — ${items.length} items ═══`);
    if (items.length > 0) {
      const sample = items[0];
      console.log("Full fields of sample #1:");
      for (const [k, v] of Object.entries(sample)) {
        const short = typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v).slice(0, 80);
        console.log(`  ${k.padEnd(30)}: ${short}`);
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Also test /emails without filter — see what default is
  console.log("\n═══ /emails no filter (limit=3) ═══");
  const noFilter = await fetch(`${BASE}/emails?limit=3`, { headers });
  const noData: any = await noFilter.json();
  const nfItems = noData.items || [];
  console.log(`  ${nfItems.length} items`);
  nfItems.forEach((item: any, i: number) => {
    console.log(`  #${i+1} ue_type=${item.ue_type} eaccount=${item.eaccount?.slice(0,30)} subject=${item.subject?.slice(0,40)}`);
  });

  // Try /campaigns/analytics endpoint (from earlier we know it works)
  console.log("\n═══ Campaign analytics overview ═══");
  const analRes = await fetch(`${BASE}/campaigns/analytics/overview`, { headers });
  const analData: any = await analRes.json();
  console.log(`  open_count:              ${analData.open_count}`);
  console.log(`  open_count_unique:       ${analData.open_count_unique}`);
  console.log(`  link_click_count:        ${analData.link_click_count}`);
  console.log(`  link_click_count_unique: ${analData.link_click_count_unique}`);
  console.log(`  reply_count:             ${analData.reply_count}`);
  console.log(`  bounce_count:            ${analData.bounce_count}`);
  console.log(`  emails_sent_count:       ${analData.emails_sent_count}`);
  console.log(`  contacted_count:         ${analData.contacted_count}`);
}

main().catch(console.error);
