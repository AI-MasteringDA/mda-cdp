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

    // Recompute scores — CHẶN TẦN SUẤT. recompute_lead_scores() chấm lại toàn
    // bộ ~50k lead, tốn ~9s CPU. Trước đây gọi sau MỖI lần ETL; SMAX chạy 7
    // phút/lần nên nó chấm 50k lead mỗi 7 phút → vắt kiệt CPU của Nano instance
    // (2026-07-18: "exhausting multiple resources"), tạo vòng lặp tự bóp nghẹt
    // (recompute dày → CPU cạn → recompute chậm → timeout → đốt CPU vô ích).
    // Tier/điểm lead không đổi từng phút, nên chỉ cần chấm lại mỗi ~30 phút.
    // Dùng etl_state làm khoá nhịp (giống lark-push). CLAIM TRƯỚC khi chạy để
    // dù lần này có timeout thì cũng không thử lại ngay — cho CPU nghỉ để hồi.
    const GATE_MIN = Number(process.env.RECOMPUTE_GATE_MIN || 30);
    const { data: gate } = await admin
      .from("etl_state").select("value").eq("source", "_recompute").eq("key", "last_run_at").maybeSingle();
    const lastMs = gate?.value ? new Date(gate.value).getTime() : 0;
    const sinceMin = Math.round((Date.now() - lastMs) / 60_000);
    if (Date.now() - lastMs >= GATE_MIN * 60_000) {
      await admin.from("etl_state").upsert(
        { source: "_recompute", key: "last_run_at", value: new Date().toISOString(), updated_at: new Date().toISOString() },
        { onConflict: "source,key" }
      );
      console.log("⚙️  [Scoring] Gọi recompute_lead_scores()...");
      const { error } = await admin.rpc("recompute_lead_scores");
      if (error) console.warn(`   ⚠️ ${error.message}`);
      else console.log("✅ [Scoring] Scores đã update");
    } else {
      console.log(`⏭  [Scoring] Bỏ qua recompute (mới chạy ${sinceMin} phút trước, gate ${GATE_MIN} phút)`);
    }

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
