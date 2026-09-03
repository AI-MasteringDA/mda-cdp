/**
 * Chụp ảnh dashboard /radar.html, 2 đợt/ngày, gửi vào group chat Lark.
 *
 * Trang /radar yêu cầu đăng nhập Google nên bot KHÔNG vào được bằng session
 * thường. Thay vào đó dùng "cửa riêng": mở thẳng /radar.html?key=<SECRET>
 * (public/radar.html là file tĩnh, được middleware cho qua khi key khớp — xem
 * lib/supabase/middleware.ts). Loader trong radar.html tự chuyển tiếp key đó
 * sang /api/radar để lấy dữ liệu.
 *
 * CẦN 4 biến môi trường:
 *   RADAR_SNAPSHOT_KEY  — khoá bí mật, PHẢI khớp với giá trị đã đặt trên Vercel
 *   RADAR_DASHBOARD_URL — mặc định https://mda-cdp.vercel.app
 *   LARK_DAILY_WEBHOOK  — URL Custom Bot Webhook của group muốn nhận ảnh
 *   RADAR_RUN           — "am" (đợt Sáng) hoặc "pm" (đợt Chiều). Bỏ trống thì
 *                         tự đoán theo giờ VN thực tế lúc chạy (< 14h ⇒ am).
 *
 * Gửi ảnh cần app Lark (LARK_APP_ID/SECRET) có scope `im:resource:upload` —
 * kiểm bằng: npx tsx etl/debug/test-lark-image.ts
 *
 * Chạy: npm run etl:radar:snapshot
 *   ép đợt Sáng : RADAR_RUN=am npm run etl:radar:snapshot
 *   ép đợt Chiều: RADAR_RUN=pm npm run etl:radar:snapshot
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

// data-v của nút kỳ trong #segDays: am=17:00 hôm qua→10:30 hôm nay (Sáng),
// pm=10:30→17:00 hôm nay (Chiều), 30=30 ngày. data-v của #segGrp: all/bi/fa.
//
// LỊCH 2 ĐỢT/NGÀY (user chốt 2026-08-13):
//   Đợt Sáng (chạy 10:30) — chốt sổ ca đêm: 17:00 hôm qua → 10:30 hôm nay.
//   Đợt Chiều (chạy 17:00) — chốt sổ ca ngày: 10:30 → 17:00 hôm nay, kèm thêm
//   1 báo cáo Tổng quan 30 ngày (không lọc khoá, đủ dài thấy xu hướng).
// 2 đợt gộp lại đúng 1 vòng 24h liên tục (17:00 hôm qua → 17:00 hôm nay),
// không trùng không hở.
const AM_REPORTS = [
  { win: "am", grp: "bi", label: "BI — Sáng", color: "blue" },
  { win: "am", grp: "fa", label: "FA — Sáng", color: "turquoise" },
];
const PM_REPORTS = [
  { win: "pm", grp: "bi", label: "BI — Chiều", color: "blue" },
  { win: "pm", grp: "fa", label: "FA — Chiều", color: "turquoise" },
  // Thẻ "Tổng quan — 30 ngày qua" đã BỎ (user chốt 2026-09-03): 2 thẻ so sánh
  // khoá bên dưới đã cho thấy xu hướng dài hạn rõ hơn, để thêm 30 ngày là loãng.
  // SO SÁNH KHOÁ (sếp yêu cầu 2026-09-03): khoá đang chạy so với các khoá trước
  // ở CÙNG số ngày kể từ lúc mở tuyển sinh. Chỉ bắn đợt Chiều — số này nhích
  // chậm theo ngày, không cần nhắc 2 lần/ngày.
  { win: "cohort:BI", grp: "all", label: "Khoá BI — so với các khoá trước", color: "carmine" },
  { win: "cohort:FA", grp: "all", label: "Khoá FA — so với các khoá trước", color: "orange" },
];
// RADAR_RUN=am|pm ép chạy đúng đợt (cron truyền vào theo giờ trigger). Không
// truyền thì tự đoán theo giờ VN thực tế lúc chạy — tiện chạy tay giữa chừng.
function pickRun(): "am" | "pm" {
  const env = (process.env.RADAR_RUN || "").toLowerCase();
  if (env === "am" || env === "pm") return env;
  const vnHour = new Date(Date.now() + 7 * 3600_000).getUTCHours();
  return vnHour < 14 ? "am" : "pm";
}

async function shoot(page: import("playwright").Page, win: string, grp: string): Promise<Buffer> {
  // "cohort:<hệ>" — trang So sánh khoá. Trang này có nguồn dữ liệu RIÊNG
  // (/api/cohort) nên không đụng tới bộ lọc kỳ/kênh; chỉ cần vào trang, chọn hệ
  // khoá rồi chờ tải xong.
  if (win.startsWith("cohort")) {
    const ck = (win.split(":")[1] || "BI").toLowerCase();
    // Xoá cờ trước khi bấm, rồi chờ trang tự đặt lại — như vậy mới biết chắc
    // ĐÚNG hệ khoá này đã render xong. Chờ kiểu "bảng có dòng chưa" là SAI:
    // dòng của hệ trước vẫn còn nên chờ xong ngay, chụp nhầm dữ liệu cũ
    // (gặp 2026-09-03: thẻ "Khoá BI" hiện số của FA).
    await page.evaluate(() => { delete document.body.dataset.coGrp });
    await page.click('#navPg button[data-p="co"]');
    await page.click(`#segGrp button[data-v="${ck}"]`);
    await page.waitForFunction(g => document.body.dataset.coGrp === g, ck, { timeout: 25_000 })
      .catch(() => console.log(`[snapshot] ⚠ chờ render hệ ${ck} quá hạn — ảnh có thể chưa đúng`));
    // Chuột đang nằm trên thanh bên sau cú click ⇒ thanh bên bung ra che mất
    // cột đầu của bảng. Dời chuột ra giữa trang trước khi chụp.
    await page.mouse.move(760, 700);
    await page.waitForTimeout(1200);
    return await page.screenshot({ fullPage: false });
  }
  // Áp kỳ + bộ lọc bằng cách BẤM ĐÚNG NÚT trên trang (không tự lặp lại state
  // logic) — dashboard tự lo phần ensureWindow/render, xem "DEEP LINK" trong
  // public/radar.html. Kỳ dài (30 ngày) cần chờ ensureWindow tải thêm dữ liệu
  // + biểu đồ gom lại theo tuần, nên đợi lâu hơn kỳ ngắn.
  await page.click('#navPg button[data-p="ov"]');
  await page.click(`#segDays button[data-v="${win}"]`);
  await page.waitForTimeout(win === "30" ? 1800 : 700);
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

/**
 * THẺ TÓM TẮT DẠNG CHỮ — bắn TRƯỚC các thẻ ảnh (user yêu cầu 2026-09-03).
 * Số đọc THẲNG TỪ DOM của trang sau khi bấm đúng bộ lọc, không tự tính lại ⇒
 * chữ và ảnh chắc chắn khớp nhau.
 *
 * Mẫu user đưa có thêm mục B2B, "Training inhouse", checklist vận hành và tên
 * người phụ trách — KHÔNG đưa vào vì: 2 mục đầu không có dữ liệu (đo 2026-09-03:
 * 0/734 lead mang dấu hiệu B2B), 2 mục sau là xác nhận/thông tin của người chứ
 * máy không tự sinh được. User đã chốt "dữ liệu nào có thì bắn".
 */
async function readKpis(page: import("playwright").Page, win: string, grp: string) {
  await page.click('#navPg button[data-p="ov"]');
  await page.click(`#segDays button[data-v="${win}"]`); await page.waitForTimeout(700);
  await page.click(`#segGrp button[data-v="${grp}"]`); await page.waitForTimeout(1200);
  // textContent chứ KHÔNG innerText: CSS có text-transform:uppercase nên
  // innerText trả "LEAD MỚI", không khớp tên mục khi tra cứu.
  const rows = await page.$$eval("#kpis .kpi", els => els.map(e => ({
    k: (e.querySelector(".lbl") as HTMLElement)?.textContent?.trim() || "",
    v: (e.querySelector(".v") as HTMLElement)?.textContent?.trim() || "",
    d: [...e.querySelectorAll(".delta")].map(x => (x as HTMLElement).textContent?.trim() || ""),
  })));
  const range = await page.locator("#rangeLbl").innerText().catch(() => "");
  return { rows, range };
}
type Kpi = Awaited<ReturnType<typeof readKpis>>;
async function runningCourse(grp: string) {
  try {
    const r = await fetch(`${BASE}/api/cohort?grp=${grp.toUpperCase()}&key=${encodeURIComponent(KEY)}`).then(r => r.json());
    return (r.courses || []).find((c: { running?: boolean }) => c.running) ?? null;
  } catch { return null }   // thiếu phần khoá thì vẫn bắn được phần còn lại
}
function buildText(bi: Kpi, fa: Kpi, cBI: any, cFA: any): string {
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10).split("-").reverse().join("/");
  const block = (nm: string, k: Kpi, c: any) => {
    const g = (n: string) => k.rows.find(x => x.k === n)?.v ?? "0";
    const src = (k.rows.find(x => x.k === "Hot mới")?.d || []).find(x => x.startsWith("SMAX")) || "";
    let s = `\n━━ ${nm} ━━`;
    if (c) s += `  (đang tuyển sinh: ${c.code} · ngày thứ ${c.days})`;
    s += `\n• Lead mới: ${g("Lead mới")}`;
    s += `\n• Hot mới: ${g("Hot mới")}${src ? `   (${src})` : ""}`;
    s += `\n• Cold: ${g("Cold")}  ·  Warm: ${g("Warm")}  ·  Prospect: ${g("Prospect")}`;
    s += `\n• Chưa phản hồi: ${g("Chưa phản hồi")}`;
    if (c) {
      const pc = (v: number) => c.leads ? Math.round(v / c.leads * 100) + "%" : "0%";
      s += `\n• Luỹ kế cả khoá ${c.code}: ${c.leads} lead`;
      s += `\n   ↳ Hot ${c.H} (${pc(c.H)}) · Warm ${c.W} (${pc(c.W)}) · Cold ${c.C} (${pc(c.C)}) · Prospect ${c.P} (${pc(c.P)}) · Chưa tag ${c.Un} (${pc(c.Un)})`;
    }
    return s;
  };
  return `**Báo cáo ngày: ${today}**\nKỳ báo cáo: ${bi.range.replace(/^🗓\s*/, "")}\n`
    + block("BI", bi, cBI) + "\n" + block("FA", fa, cFA)
    + `\n\nNguồn: SMAX + Salesforce · Automation Bot — Mastering Data Analytics`;
}
async function sendText(md: string) {
  const card = {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: { title: { tag: "plain_text", content: "📋 CHECK LEADS / TAG / PROCESS" }, template: "green" },
      elements: [{ tag: "div", text: { tag: "lark_md", content: md } }],
    },
  };
  const r = await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(card) }).then(r => r.json());
  if (r.code !== 0 && r.StatusCode !== 0) throw new Error(`gửi thẻ chữ lỗi: ${JSON.stringify(r)}`);
}

/** Thẻ = ảnh chụp + nút bấm dẫn thẳng tới /radar (đăng nhập Google, KHÔNG lộ
 * key bí mật của bot) đã set sẵn ?days=&grp= để vào đúng đúng kỳ + bộ lọc. */
async function sendCard(imageKey: string, label: string, color: string, win: string, grp: string) {
  // Nút bấm phải MỞ THẲNG dashboard, không được bắt đăng nhập Google (user chốt
  // 2026-09-03). Nên trỏ vào /radar.html kèm ?pw= — cổng mật khẩu chung sẽ đổi
  // lấy cookie 30 ngày rồi chuyển về URL sạch. KHÔNG dùng RADAR_SNAPSHOT_KEY:
  // đó là khoá riêng của bot, lộ vào group chat là mất kiểm soát.
  // Mật khẩu chung vốn đã chia cho cả team nên đưa vào link nội bộ là chấp nhận được.
  const pw = process.env.RADAR_TEAM_PASSWORD || "";
  const gate = pw ? `pw=${encodeURIComponent(pw)}&` : "";
  const deepLink = win.startsWith("cohort")
    ? `${BASE}/radar.html?${gate}pg=co&grp=${(win.split(":")[1] || "BI").toLowerCase()}`
    : `${BASE}/radar.html?${gate}days=${win}&grp=${grp}`;
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

  const run = pickRun();
  const REPORTS = run === "am" ? AM_REPORTS : PM_REPORTS;
  console.log(`[snapshot] đợt: ${run === "am" ? "SÁNG (10:30)" : "CHIỀU (17:00)"} · ${REPORTS.length} báo cáo`);

  const tk = await larkToken();

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1720, height: 1000 } });
    const url = `${BASE}/radar.html?key=${encodeURIComponent(KEY)}&v=snapshot`;
    console.log(`[snapshot] mở ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    await page.waitForTimeout(2000);
    const errBox = await page.locator("text=Không tải được dữ liệu").count();
    if (errBox > 0) throw new Error("trang báo lỗi tải dữ liệu — key sai hoặc API lỗi");

    // THẺ CHỮ đi TRƯỚC: đọc số trước, xem biểu đồ sau. Lỗi ở đây không được
    // chặn phần ảnh — thà thiếu thẻ chữ còn hơn mất cả loạt báo cáo.
    try {
      const kWin = run === "am" ? "am" : "pm";
      const bi = await readKpis(page, kWin, "bi");
      const fa = await readKpis(page, kWin, "fa");
      const [cBI, cFA] = await Promise.all([runningCourse("BI"), runningCourse("FA")]);
      await sendText(buildText(bi, fa, cBI, cFA));
      console.log("[snapshot] [thẻ chữ] đã gửi vào group ✅");
    } catch (e) {
      console.error(`[snapshot] ⚠ thẻ chữ lỗi (vẫn tiếp tục gửi ảnh): ${(e as Error).message}`);
    }

    for (const { win, grp, label, color } of REPORTS) {
      const png = await shoot(page, win, grp);
      // Lấy đúng khoảng ngày/giờ mà TRANG đang hiện (không tự tính lại) — luôn
      // khớp 100% với những gì thấy trong ảnh, kể cả khi đổi quy tắc sau này.
      // Nhãn lấy LIVE từ trang để luôn khớp thứ đang thấy trong ảnh.
      // Dùng ID chứ KHÔNG dùng class ".range": từ khi có trang khoá, class đó
      // khớp 2 phần tử ⇒ Playwright ném lỗi strict mode, hỏng cả lần bắn.
      const sub = win.startsWith("cohort")
        ? await page.locator("#coSub").innerText().catch(() => "")
        : await page.locator("#rangeLbl").innerText().catch(() => "");
      const fullLabel = sub ? `${label} (${sub.replace(/^🗓\s*/, "")})` : label;
      writeFileSync(`radar-snapshot-${grp}-${win}.png`, png); // giữ lại làm bằng chứng khi debug local
      console.log(`[snapshot] [${fullLabel}] chụp xong: ${(png.length / 1024).toFixed(0)} KB`);

      const imageKey = await uploadImage(tk, png);
      console.log(`[snapshot] [${fullLabel}] upload xong: image_key=${imageKey}`);

      await sendCard(imageKey, fullLabel, color, win, grp);
      console.log(`[snapshot] [${fullLabel}] đã gửi vào group ✅`);
    }
  } finally {
    await browser.close();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("[snapshot] LỖI:", e.message); process.exit(1); });
