import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  // 3 sample rows mới nhất
  const { data: samples } = await admin
    .from("fact_touchpoint")
    .select("event_type, title, detail, occurred_at, payload, lead_id")
    .eq("source", "instantly")
    .order("occurred_at", { ascending: false })
    .limit(3);

  console.log("\n📊 3 SAMPLE Instantly touchpoints (mới nhất):\n");
  samples?.forEach((row, i) => {
    console.log(`──── Row ${i + 1} ──────────────────────`);
    console.log(`event_type:  ${row.event_type}`);
    console.log(`title:       ${row.title?.slice(0, 70)}`);
    console.log(`detail:      ${row.detail?.slice(0, 100) || '(empty)'}`);
    console.log(`occurred_at: ${row.occurred_at}`);
    console.log(`lead_id:     ${row.lead_id}`);
    console.log(`payload (JSON):`);
    console.log(JSON.stringify(row.payload, null, 2));
    console.log("");
  });

  // Counts per event_type
  console.log("\n📦 Total per event_type:");
  for (const t of ["email_sent", "email_open", "email_click", "email_reply"]) {
    const { count } = await admin.from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("source", "instantly").eq("event_type", t);
    console.log(`   ${t.padEnd(15)}: ${count?.toLocaleString("vi-VN")}`);
  }
}

main().catch(console.error);
