/**
 * Chụp ảnh dashboard /radar.html mỗi ngày rồi gửi vào group chat Lark.
 *
 * Trang /radar yêu cầu đăng nhập Google nên bot KHÔNG vào được bằng session
 * thường. Thay vào đó dùng "cửa riêng": mở thẳng /radar.html?key=<SECRET>
 * (public/radar.html là file tĩnh, được middleware cho qua khi key khớp — xem
 * lib/supabase/middleware.ts). Loader trong radar.html tự chuyển tiếp key đó
 * sang /api/radar để lấy dữ liệu.
 *
 * CẦN 3 biến môi trường:
 *   RADAR_SNAPSHOT_KEY  — khoá bí mật, PHẢI khớp với giá trị đã đặt trên Vercel
 *   RADAR_DASHBOARD_URL — mặc định https://mda-cdp.vercel.app
 *   LARK_DAILY_WEBHOOK  — URL Custom Bot Webhook của group muốn nhận ảnh
 *
 * Gửi ảnh cần app Lark (LARK_APP_ID/SECRET) có scope `im:resource:upload` —
 * kiểm bằng: npx tsx etl/debug/test-lark-image.ts
 *
 * Chạy: npm run etl:radar:snapshot
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { chromium } from "playwright";
import { writeFileSync } from "fs";

const KEY = process.env.RADAR_SNAPSHOT_KEY || "";
const BASE = process.env.RADAR_DASHBOARD_URL || "https://mda-cdp.vercel.app";
const WEBHOOK = process.env.LARK_DAILY_WEBHOOK || "";
const ID = process.env.LARK_APP_ID || "", SEC = process.env.LARK_APP_SECRET || "";
const U = "https://open.larksuite.com/open-apis";

async function shoot(): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1720, height: 1000 } });
    const url = `${BASE}/radar.html?key=${encodeURIComponent(KEY)}&v=snapshot`;
    console.log(`[snapshot] mở ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    // radar.html vẽ SVG bằng JS sau khi fetch xong — đợi thêm để chart kịp render.
    await page.waitForTimeout(2500);
    const errBox = await page.locator("text=Không tải được dữ liệu").count();
    if (errBox > 0) throw new Error("trang báo lỗi tải dữ liệu — key sai hoặc API lỗi");
    return await page.screenshot({ fullPage: false });
  } finally {
    await browser.close();
  }
}

async function larkToken(): Promise<string> {
  const r = await fetch(`${U}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: ID, app_secret: SEC }),
  }).then(r => r.json());
  return r.tenant_access_token;
}

async function uploadImage(png: Buffer): Promise<string> {
  const tk = await larkToken();
  const form = new FormData();
  form.append("image_type", "message");
  form.append("image", new Blob([png]), "radar.png");
  const r = await fetch(`${U}/im/v1/images`, { method: "POST", headers: { Authorization: `Bearer ${tk}` }, body: form }).then(r => r.json());
  if (r.code !== 0) throw new Error(`upload ảnh lỗi (thiếu scope im:resource:upload?): ${r.code} ${r.msg}`);
  return r.data.image_key;
}

async function sendImage(imageKey: string) {
  const r = await fetch(WEBHOOK, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msg_type: "image", content: { image_key: imageKey } }),
  }).then(r => r.json());
  if (r.code !== 0 && r.StatusCode !== 0) throw new Error(`gửi vào group lỗi: ${JSON.stringify(r)}`);
}

async function main() {
  if (!KEY) { console.log("[snapshot] thiếu RADAR_SNAPSHOT_KEY, bỏ qua"); return; }
  if (!WEBHOOK) { console.log("[snapshot] thiếu LARK_DAILY_WEBHOOK, bỏ qua"); return; }

  const png = await shoot();
  writeFileSync("radar-snapshot.png", png); // giữ lại làm bằng chứng khi debug local
  console.log(`[snapshot] chụp xong: ${(png.length / 1024).toFixed(0)} KB`);

  const key = await uploadImage(png);
  console.log(`[snapshot] upload xong: image_key=${key}`);

  await sendImage(key);
  console.log(`[snapshot] đã gửi vào group ✅`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("[snapshot] LỖI:", e.message); process.exit(1); });
