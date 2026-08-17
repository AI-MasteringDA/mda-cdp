/**
 * Test GHI (không chỉ đọc) qua kết nối Postgres trực tiếp — đúng câu lệnh đang
 * fail của smax-real.ts ("Tạo sync_job"). Nếu ghi được, xác nhận giả thuyết:
 * REST API (PostgREST) bị khoá egress, nhưng kết nối Postgres trực tiếp thì
 * KHÔNG bị tính vào cùng loại quota đó.
 * Chạy: npx tsx etl/debug/test-pg-write.ts
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import pg from "pg";

const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").hostname.split(".")[0];
const password = process.env.SUPABASE_DB_PASSWORD;

const client = new pg.Client({
  host: "aws-1-ap-southeast-1.pooler.supabase.com", port: 5432, database: "postgres",
  user: `postgres.${projectRef}`, password, ssl: { rejectUnauthorized: false },
});

(async () => {
  try {
    await client.connect();
    console.log("✅ Kết nối OK");

    // 1) Test GHI y hệt câu đang fail: insert sync_job
    const ins = await client.query(
      `insert into sync_job (source, status, records_in, records_merged) values ($1,$2,$3,$4) returning id, started_at`,
      ["test-raw-pg", "running", 0, 0]
    );
    console.log(`✅ GHI THÀNH CÔNG — sync_job id=${ins.rows[0].id} started_at=${ins.rows[0].started_at}`);

    // dọn lại row test
    await client.query(`delete from sync_job where id = $1`, [ins.rows[0].id]);
    console.log("✅ Đã xoá row test — không để lại rác");

    // 2) Test đọc NẶNG (toàn bộ dim_lead, xem có bị chặn khi data lớn không)
    const t0 = Date.now();
    const r = await client.query("select lead_id, phone, email, external_profile_id, smax_customer_id, full_name, smax_tags from dim_lead");
    console.log(`✅ ĐỌC NẶNG THÀNH CÔNG — ${r.rows.length} dòng trong ${Date.now() - t0}ms`);

    console.log("\n=== KẾT LUẬN: cả ĐỌC và GHI qua kết nối trực tiếp đều hoạt động bình thường, kể cả đọc full-table. ===");
  } catch (e) {
    console.log(`❌ LỖI: ${(e as Error).message}`);
  } finally {
    await client.end();
  }
})();
