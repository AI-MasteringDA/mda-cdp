/**
 * Xem RAW tag data trên SMAX cho vài lead bị thiếu "Hot Lead lúc" (tìm bởi
 * check-hotluc-missing.ts) — kiểm tra tg.time có tồn tại trên SMAX không.
 * Chạy: npx tsx etl/debug/check-smax-tag-time.ts
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const T = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const B = process.env.SMAX_BASE_URL || "https://api.smax.ai";
const BIZ = "mastering-data-analytics";
const post = (b: any) => fetch(`${B}/bizs/${BIZ}/customers`, { method: "POST", headers: { Authorization: `Bearer ${T}`, "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json());

const PIDS = ["3048646863386651879", "6144481555658176", "6590525254340343", "7289545460950893696", "2750002339399878528"];
const NAMES = ["Chinh Nguyen", "Tri Nguyen", "Quang Phạm", "Nguyen Hoang Minh", "My Vo"];

async function main() {
  console.log("=== theo PID ===");
  for (const pid of PIDS) {
    const r = await post({ size: 5, q: pid });
    for (const c of (r.data || [])) {
      if (String(c.pid) !== pid) continue;
      console.log(`\n"${c.name}" pid=${c.pid}`);
      console.log(`  created_at=${c.created_at} interaction.first=${c.interaction?.first}`);
      console.log(`  tags=${JSON.stringify(c.tags)}`);
    }
  }
  console.log("\n=== theo tên (lead chưa từng có Ngày chat đầu) ===");
  for (const nm of NAMES) {
    const r = await post({ size: 5, q: nm });
    for (const c of (r.data || [])) {
      console.log(`\n"${c.name}" pid=${c.pid} id=${c.id}`);
      console.log(`  created_at=${c.created_at} interaction.first=${c.interaction?.first}`);
      console.log(`  tags=${JSON.stringify(c.tags)}`);
    }
  }
  process.exit(0);
}
main();
