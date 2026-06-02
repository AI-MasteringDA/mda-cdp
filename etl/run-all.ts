import { admin } from "./lib/supabase-admin";
import { pullFromSmaxSimulator } from "./sources/smax-simulator";
import { pullFromSalesforceSimulator } from "./sources/salesforce-simulator";
import { pullFromInstantlySimulator } from "./sources/instantly-simulator";
import { pullFromInstantlyReal } from "./sources/instantly-real";
import { pullFromSmaxReal } from "./sources/smax-real";
import { pullSmaxMessages } from "./sources/smax-messages";
import { pullFromSalesforceReal } from "./sources/salesforce-real";
import { pullFromWixReal } from "./sources/wix-real";

const SOURCE = process.argv[2] ?? "all";

async function main() {
  const startedAt = Date.now();
  console.log("=".repeat(60));
  console.log(`🚀 MDA ETL — source = "${SOURCE}"`);
  console.log("=".repeat(60));

  let totalInserted = 0;

  try {
    if (SOURCE === "all" || SOURCE === "smax") {
      const r = await pullFromSmaxSimulator();
      totalInserted += r.inserted;
      console.log("");
    }
    if (SOURCE === "all" || SOURCE === "salesforce" || SOURCE === "sf") {
      const r = await pullFromSalesforceSimulator();
      totalInserted += r.inserted;
      console.log("");
    }
    if (SOURCE === "all" || SOURCE === "instantly") {
      const r = await pullFromInstantlySimulator();
      totalInserted += r.inserted;
      console.log("");
    }
    if (SOURCE === "instantly:real") {
      const r = await pullFromInstantlyReal();
      totalInserted += r.inserted;
      console.log("");
    }
    if (SOURCE === "smax:real") {
      const r = await pullFromSmaxReal();
      totalInserted += r.inserted;
      console.log("");
    }
    if (SOURCE === "smax:messages") {
      const r = await pullSmaxMessages();
      totalInserted += r.inserted;
      console.log("");
    }
    if (SOURCE === "sf:real" || SOURCE === "salesforce:real") {
      const r = await pullFromSalesforceReal();
      totalInserted += r.inserted;
      console.log("");
    }
    if (SOURCE === "wix" || SOURCE === "wix:real" || SOURCE === "web") {
      await pullFromWixReal();
      console.log("");
    }

    // Recompute scores 1 lần ở cuối (không cần gọi sau mỗi source)
    console.log("⚙️  [Scoring] Gọi recompute_lead_scores()...");
    const { error } = await admin.rpc("recompute_lead_scores");
    if (error) console.warn(`   ⚠️ ${error.message}`);
    else console.log("✅ [Scoring] Scores đã update");

    const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log("=".repeat(60));
    console.log(`✨ Hoàn tất trong ${duration}s — tổng ${totalInserted} touchpoint mới`);
    console.log("   Mở http://localhost:3000/dashboard để xem");
    console.log("=".repeat(60));
  } catch (e) {
    console.error("❌ ETL thất bại:", e);
    process.exit(1);
  }
}

main();
