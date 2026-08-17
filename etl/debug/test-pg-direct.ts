/**
 * Test xem kết nối Postgres TRỰC TIẾP (không qua PostgREST/REST API) có còn
 * dùng được không khi project đang bị khoá "exceed_egress_quota". Nếu port
 * 5432 vẫn bắt tay được (nhận challenge auth) thì có khả năng pg_dump vẫn
 * chạy được để migrate, dù REST API đang trả 402.
 * Chạy: npx tsx etl/debug/test-pg-direct.ts
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import net from "net";

const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
const projectRef = url.hostname.split(".")[0];
// Session pooler (IPv4) — direct host db.<ref>.supabase.co chỉ có IPv6, máy
// test không phân giải được. Host/port lấy từ Supabase Dashboard → Connect.
const host = "aws-1-ap-southeast-1.pooler.supabase.com";
const port = 5432;

console.log(`Thử kết nối TCP tới ${host}:${port} ...`);
const sock = net.createConnection({ host, port, timeout: 8000 });
sock.on("connect", () => {
  console.log("✅ TCP connect THÀNH CÔNG — port Postgres đang mở/reachable.");
  // Gửi Postgres StartupMessage tối giản để xem server có trả lời (auth challenge) không
  const user = `postgres.${projectRef}`;
  const params = Buffer.from(`user\0${user}\0database\0postgres\0\0`, "utf8");
  const len = Buffer.alloc(4); len.writeUInt32BE(4 + 4 + params.length, 0);
  const proto = Buffer.alloc(4); proto.writeUInt32BE(196608, 0); // protocol 3.0
  sock.write(Buffer.concat([len, proto, params]));
});
sock.on("data", (d) => {
  console.log(`📨 Server trả lời ${d.length} bytes (hex): ${d.subarray(0, 40).toString("hex")}`);
  console.log("→ Postgres wire protocol đang phản hồi (auth challenge hoặc lỗi có cấu trúc) — không phải bị chặn hoàn toàn ở tầng network.");
  sock.end();
});
sock.on("timeout", () => { console.log("⏱️ TIMEOUT — không kết nối được trong 8s (có thể bị chặn hoặc host sai)."); sock.destroy(); process.exit(1); });
sock.on("error", (e) => { console.log(`❌ LỖI kết nối: ${e.message}`); process.exit(1); });
sock.on("close", () => process.exit(0));
