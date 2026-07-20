import { admin } from "./lib/supabase-admin";
import { pullFromSmaxSimulator } from "./sources/smax-simulator";
import { pullFromSalesforceSimulator } from "./sources/salesforce-simulator";
import { pullFromInstantlySimulator } from "./sources/instantly-simulator";
import { pullFromInstantlyReal } from "./sources/instantly-real";
import { pullFromInstantlyHistorical } from "./sources/instantly-historical";
import { pushToLark } from "./sources/lark-push";
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
    if (SOURCE === "instantly:historical") {
      const r = await pullFromInstantlyHistorical();
      totalInserted += r.inserted;
      console.log("");
    }
    if (SOURCE === "lark:push") {
      await pushToLark();
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

    // Recompute scores — KHÔNG gọi từ ETL nữa (2026-07-20).
    // recompute_lead_scores() chấm lại ~50k lead (~9.5s). Gọi qua API/PostgREST
    // thì luôn bị cắt ở statement_timeout ~8s (ALTER ROLE service_role không áp
    // được cho đường "SET ROLE" của PostgREST) → mỗi lần gọi đốt 9s CPU rồi
    // timeout vô ích, góp phần làm sập instance free-tier. Giờ recompute chạy
    // BÊN TRONG database bằng pg_cron (như SQL Editor — không dính giới hạn API,
    // luôn chạy xong). Xem supabase/setup-recompute-cron.sql.
    // Đặt LARK khỏi lo: ETL giờ chỉ ingest, nhẹ và không giữ connection lâu.
    console.log("ℹ️  [Scoring] recompute do pg_cron trong DB xử lý (không gọi từ ETL).");

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
