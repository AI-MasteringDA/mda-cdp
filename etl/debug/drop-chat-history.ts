/**
 * XOÁ VĨNH VIỄN 5 cột "Chat History 1..5" khỏi Lark SMAX_Database.
 * User chốt 2026-08-17 sau khi được báo rõ: 14.601 dòng có nội dung (~54MB),
 * và SMAX chỉ trả ~20 tin gần nhất nên KHÔNG kéo lại đầy đủ được.
 *
 * Chạy: npx tsx etl/debug/drop-chat-history.ts --apply   (không có --apply = chỉ xem)
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
const U = "https://open.larksuite.com/open-apis";
const ID = process.env.LARK_APP_ID!, SEC = process.env.LARK_APP_SECRET!, APP = process.env.LARK_BASE_APP_TOKEN!;
const APPLY = process.argv.includes("--apply");
const CHAT = [1, 2, 3, 4, 5].map(i => `Chat History ${i}`);

(async () => {
  const a = await fetch(`${U}/auth/v3/tenant_access_token/internal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: ID, app_secret: SEC }) }).then(r => r.json());
  const tk = a.tenant_access_token; const H = { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" };
  const tR = await fetch(`${U}/bitable/v1/apps/${APP}/tables?page_size=100`, { headers: H }).then(r => r.json());
  const dbId = tR.data.items.find((t: any) => t.name === "SMAX_Database").table_id;

  const fR = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/fields?page_size=100`, { headers: H }).then(r => r.json());
  if (fR.code !== 0) { console.log("LỖI đọc fields:", fR.code, fR.msg); return; }
  const found = (fR.data?.items || []).filter((f: any) => CHAT.includes(f.field_name));
  console.log(`Tìm thấy ${found.length}/5 cột: ${found.map((f: any) => f.field_name).join(", ")}`);
  if (!APPLY) { console.log("\n(chỉ xem — thêm --apply để xoá thật)"); return; }

  for (const f of found) {
    const d = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/fields/${f.field_id}`, { method: "DELETE", headers: H }).then(r => r.json());
    console.log(d.code === 0 ? `  ✅ đã xoá "${f.field_name}"` : `  ❌ "${f.field_name}": ${d.code} ${d.msg}`);
  }
})();
