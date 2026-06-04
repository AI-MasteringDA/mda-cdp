import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  // 1) All distinct stage values
  const stages = new Map<string, number>();
  let from = 0;
  while (true) {
    const { data } = await admin
      .from("dim_lead")
      .select("stage")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const l of data) {
      const s = l.stage || "(null)";
      stages.set(s, (stages.get(s) || 0) + 1);
    }
    if (data.length < 1000) break;
    from += 1000;
  }

  console.log(`📊 ALL stage values in dim_lead:\n`);
  const sorted = [...stages.entries()].sort((a, b) => b[1] - a[1]);
  for (const [stage, count] of sorted) {
    console.log(`   "${stage}".padEnd(30) → ${count}`);
  }

  console.log(`\nTotal distinct stages: ${stages.size}`);

  // 2) UI dropdown expected values
  const expected = ["Mới", "Đang tư vấn", "Đang cân nhắc", "Im lặng", "Đã chốt"];
  console.log(`\n🎯 UI dropdown matches:`);
  for (const exp of expected) {
    const count = stages.get(exp) || 0;
    const has = count > 0;
    console.log(`   ${has ? "✅" : "❌"} "${exp}": ${count} leads`);
  }
}

main().catch(console.error);
