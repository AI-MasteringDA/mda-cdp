/**
 * CHỈ XEM TRƯỚC — dựng thẻ chữ của báo cáo, KHÔNG gửi đi đâu.
 * Số lấy y hệt cách bot chụp ảnh làm: mở trang, bấm đúng bộ lọc, đọc thẳng trên
 * DOM ⇒ chữ và ảnh chắc chắn khớp nhau, và cũng khớp dashboard.
 * Thẻ dựng bằng CHÍNH module bot dùng (etl/screenshot/report-card.ts) nên xem
 * trước thế nào thì bắn ra đúng thế.
 * Chạy: npx tsx etl/debug/preview-text-card.ts [am|pm]
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { chromium } from "playwright";
import { buildCard, renderPreview, type Course } from "../screenshot/report-card";
const KEY = process.env.RADAR_SNAPSHOT_KEY!, BASE = "https://mda-cdp.vercel.app";
const WIN = (process.argv[2] || "pm").toLowerCase();

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1720, height: 1000 } });
  await p.goto(`${BASE}/radar.html?key=${encodeURIComponent(KEY)}`, { waitUntil: "networkidle", timeout: 60000 });
  await p.waitForTimeout(1800);

  const readKpi = async (grp: string) => {
    await p.click('#navPg button[data-p="ov"]');
    await p.click(`#segDays button[data-v="${WIN}"]`); await p.waitForTimeout(700);
    await p.click(`#segGrp button[data-v="${grp}"]`); await p.waitForTimeout(1200);
    // textContent chứ KHÔNG innerText: CSS có text-transform:uppercase nên
    // innerText trả "LEAD MỚI", không khớp chuỗi so sánh.
    const rows = await p.$$eval("#kpis .kpi", els => els.map(e => ({
      k: (e.querySelector(".lbl") as HTMLElement)?.textContent?.trim() || "",
      v: (e.querySelector(".v") as HTMLElement)?.textContent?.trim() || "",
      d: [...e.querySelectorAll(".delta")].map(x => (x as HTMLElement).textContent?.trim() || ""),
    })));
    const range = await p.locator("#rangeLbl").innerText().catch(() => "");
    return { rows, range };
  };
  // Đọc TỪ DOM trang Theo khoá — giống hệt bot thật.
  const cohort = async (grp: string): Promise<Course> => {
    await p.evaluate(() => { delete document.body.dataset.coGrp });
    await p.click('#navPg button[data-p="co"]');
    await p.click(`#segGrp button[data-v="${grp}"]`);
    await p.waitForFunction(g => document.body.dataset.coGrp === g, grp, { timeout: 90000 });
    await p.waitForTimeout(600);
    const head = (await p.locator("#coHead").textContent()) || "";
    const rows = await p.$$eval("#coKpis .kpi", els => els.map(e => ({
      k: (e.querySelector(".k") as HTMLElement)?.textContent?.trim() || "",
      v: Number((e.querySelector(".v") as HTMLElement)?.textContent?.trim() || "0") || 0,
    })));
    if (!rows.length || head.trim() === "—") return null;
    const g = (n: string) => rows.find(x => x.k === n)?.v ?? 0;
    const m = head.match(/^(\S+)\s*·\s*ngày thứ\s*(\d+)/);
    return { code: m?.[1] || "?", days: Number(m?.[2] ?? 0), leads: g("Lead của khoá"),
             H: g("🔥 Hot"), W: g("Warm"), C: g("Cold"), P: g("Prospect"), Un: g("Khác / chưa tag") };
  };

  const bi = await readKpi("bi"), fa = await readKpi("fa");
  const cBI = await cohort("bi"), cFA = await cohort("fa");
  await b.close();

  console.log("\n" + renderPreview(buildCard(bi, fa, cBI, cFA)) + "\n");
})();
