/**
 * Test đăng nhập THẬT + chạy query qua Session Pooler, xem có bị "exceed_egress_quota"
 * chặn luôn không, hay chỉ chặn PostgREST/API. Xoá file này sau khi test xong.
 * Chạy: npx tsx etl/debug/test-pg-real.ts
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import pg from "pg";

const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").hostname.split(".")[0];
const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) { console.log("Thiếu SUPABASE_DB_PASSWORD trong .env.local (đang comment?) — bỏ comment dòng đó rồi chạy lại."); process.exit(1); }

const client = new pg.Client({
  host: "aws-1-ap-southeast-1.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  user: `postgres.${projectRef}`,
  password,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

(async () => {
  try {
    await client.connect();
    console.log("✅ ĐĂNG NHẬP THÀNH CÔNG qua Session Pooler!");
    const r = await client.query("select count(*) from dim_lead");
    console.log(`✅ QUERY THÀNH CÔNG — dim_lead có ${r.rows[0].count} dòng.`);
    console.log("→ KẾT LUẬN: pg_dump/migrate được NGAY BÂY GIỜ, dù REST API (PostgREST) đang bị khoá 402.");
    await client.end();
  } catch (e) {
    console.log(`❌ LỖI: ${(e as Error).message}`);
    console.log("→ KẾT LUẬN: kết nối trực tiếp cũng bị chặn/lỗi, không migrate được lúc này.");
  }
  process.exit(0);
})();
