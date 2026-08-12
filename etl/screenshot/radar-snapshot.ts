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

// data-v của nút kỳ trong #segDays: 0=Hôm nay, 1=Hôm qua, 7/14/30=N ngày, 9999=Tất cả.
// data-v của nút bộ lọc trong #segGrp: all/bi/fa.
// 3 báo cáo (user chốt 2026-08-12): BI + FA "Hôm qua" (đủ Sales rà nhanh trong
// ngày), cộng 1 báo cáo TỔNG QUAN 30 NGÀY (đủ dài để thấy xu hướng, không lọc
// khoá) — mỗi báo cáo tự nêu rõ kỳ trong tiêu đề nên không lo nhầm với nhau.
const REPORTS: { period: string; grp: string; label: string; color: string }[] = [
  { period: "1", grp: "bi", label: "BI — Hôm qua", color: "blue" },
  { period: "1", grp: "fa", label: "FA — Hôm qua", color: "turquoise" },
  { period: "30", grp: "all", label: "Tổng quan — 30 ngày qua", color: "purple" },
];

async function shoot(page: import("playwright").Page, period: string, grp: string): Promise<Buffer> {
  // Áp kỳ + bộ lọc bằng cách BẤM ĐÚNG NÚT trên trang (không tự lặp lại state
  // logic) — dashboard tự lo phần ensureWindow/render, xem "DEEP LINK" trong
  // dash-template.html. Kỳ dài (30 ngày) cần chờ ensureWindow tải thêm dữ liệu
  // + biểu đồ gom lại theo tuần, nên đợi lâu hơn kỳ ngắn.
  await page.click(`#segDays button[data-v="${period}"]`);
  await page.waitForTimeout(period === "1" ? 600 : 1800);
  await page.click(`#segGrp button[data-v="${grp}"]`);
  await page.waitForTimeout(1200);
  return await page.screenshot({ fullPage: false });
}

async function larkToken(): Promise<string> {
  const r = await fetch(`${U}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: ID, app_secret: SEC }),
  }).then(r => r.json());
  return r.tenant_access_token;
}

async function uploadImage(tk: string, png: Buffer): Promise<string> {
  const form = new FormData();
  form.append("image_type", "message");
  form.append("image", new Blob([png]), "radar.png");
  const r = await fetch(`${U}/im/v1/images`, { method: "POST", headers: { Authorization: `Bearer ${tk}` }, body: form }).then(r => r.json());
  if (r.code !== 0) throw new Error(`upload ảnh lỗi (thiếu scope im:resource:upload?): ${r.code} ${r.msg}`);
  return r.data.image_key;
}

const fmtVN = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/** Thẻ = ảnh chụp + nút bấm dẫn thẳng tới /radar (đăng nhập Google, KHÔNG lộ
 * key bí mật của bot) đã set sẵn ?days=&grp= để vào đúng đúng kỳ + bộ lọc. */
async function sendCard(imageKey: string, label: string, color: string, period: string, grp: string) {
  const deepLink = `${BASE}/radar?days=${period}&grp=${grp}`;
  const card = {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: { title: { tag: "plain_text", content: `📊 ${label}` }, template: color },
      elements: [
        { tag: "img", img_key: imageKey, alt: { tag: "plain_text", content: `Dashboard ${label}` } },
        { tag: "action", actions: [{ tag: "button", text: { tag: "plain_text", content: "Mở Dashboard chi tiết →" }, type: "primary", url: deepLink }] },
      ],
    },
  };
  const r = await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(card) }).then(r => r.json());
  if (r.code !== 0 && r.StatusCode !== 0) throw new Error(`gửi vào group lỗi (${label}): ${JSON.stringify(r)}`);
}

async function main() {
  if (!KEY) { console.log("[snapshot] thiếu RADAR_SNAPSHOT_KEY, bỏ qua"); return; }
  if (!WEBHOOK) { console.log("[snapshot] thiếu LARK_DAILY_WEBHOOK, bỏ qua"); return; }

  const tk = await larkToken();
  const yday = new Date(Date.now() + 7 * 3600_000 - 86_400_000);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1720, height: 1000 } });
    const url = `${BASE}/radar.html?key=${encodeURIComponent(KEY)}&v=snapshot`;
    console.log(`[snapshot] mở ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    await page.waitForTimeout(2000);
    const errBox = await page.locator("text=Không tải được dữ liệu").count();
    if (errBox > 0) throw new Error("trang báo lỗi tải dữ liệu — key sai hoặc API lỗi");

    for (const { period, grp, label, color } of REPORTS) {
      const fullLabel = period === "1" ? `${label} (${fmtVN(yday)})` : label;
      const png = await shoot(page, period, grp);
      writeFileSync(`radar-snapshot-${grp}-${period}.png`, png); // giữ lại làm bằng chứng khi debug local
      console.log(`[snapshot] [${fullLabel}] chụp xong: ${(png.length / 1024).toFixed(0)} KB`);

      const imageKey = await uploadImage(tk, png);
      console.log(`[snapshot] [${fullLabel}] upload xong: image_key=${imageKey}`);

      await sendCard(imageKey, fullLabel, color, period, grp);
      console.log(`[snapshot] [${fullLabel}] đã gửi vào group ✅`);
    }
  } finally {
    await browser.close();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("[snapshot] LỖI:", e.message); process.exit(1); });
