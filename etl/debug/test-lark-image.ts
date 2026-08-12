/**
 * Kiểm tra app Lark hiện tại (LARK_APP_ID/SECRET) có quyền upload ảnh qua
 * im/v1/images không — cần cho việc gửi screenshot dashboard vào group chat.
 * CHỈ ĐỌC/THỬ, không gửi vào group nào.
 * Chạy: npx tsx etl/debug/test-lark-image.ts
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
const ID = process.env.LARK_APP_ID || "", SEC = process.env.LARK_APP_SECRET || "";
const U = "https://open.larksuite.com/open-apis";

async function main() {
  const tk = await fetch(`${U}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: ID, app_secret: SEC }),
  }).then(r => r.json()).then(j => j.tenant_access_token);
  console.log(`token lấy được: ${tk ? "OK" : "LỖI"}`);

  // 1x1 PNG đỏ, để test upload
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );
  const form = new FormData();
  form.append("image_type", "message");
  form.append("image", new Blob([png]), "test.png");

  const r = await fetch(`${U}/im/v1/images`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tk}` },
    body: form,
  }).then(r => r.json());
  console.log("Kết quả upload ảnh:", JSON.stringify(r));
  if (r.code === 0) console.log(`✅ CÓ quyền upload ảnh — image_key=${r.data?.image_key}`);
  else console.log(`❌ KHÔNG upload được — code=${r.code} msg=${r.msg}`);
  process.exit(0);
}
main();
