/**
 * CHỈ XEM TRƯỚC — dựng nội dung thẻ text của báo cáo, KHÔNG gửi đi đâu.
 * Số lấy y hệt cách bot chụp ảnh làm: mở trang, bấm đúng bộ lọc, đọc KPI ngay
 * trên DOM ⇒ chữ và ảnh chắc chắn khớp nhau.
 * Chạy: npx tsx etl/debug/preview-text-card.ts [am|pm]
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { chromium } from "playwright";
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
    const rows = await p.$$eval("#kpis .kpi", els => els.map(e => ({
      // textContent chứ KHÔNG innerText: CSS có text-transform:uppercase nên
      // innerText trả "LEAD MỚI", không khớp chuỗi so sánh.
      k: (e.querySelector(".lbl") as HTMLElement)?.textContent?.trim() || "",
      v: (e.querySelector(".v") as HTMLElement)?.textContent?.trim() || "",
      d: [...e.querySelectorAll(".delta")].map(x => (x as HTMLElement).textContent?.trim() || ""),
    })));
    const range = await p.locator("#rangeLbl").innerText().catch(() => "");
    return { rows, range };
  };
  // Đọc TỪ DOM trang Theo khoá — giống hệt bot thật, nên preview không thể lệch
  // với cái sẽ bắn (và không lệch với dashboard).
  const cohort = async (grp: string) => {
    await p.evaluate(() => { delete document.body.dataset.coGrp });
    await p.click('#navPg button[data-p="co"]');
    await p.click(`#segGrp button[data-v="${grp}"]`);
    await p.waitForFunction(g => document.body.dataset.coGrp === g, grp, { timeout: 25000 });
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

  const get = (k: any, name: string) => k.rows.find((x: any) => x.k === name);
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10).split("-").reverse().join("/");
  const block = (nm: string, k: any, c: any) => {
    const g = (n: string) => get(k, n)?.v ?? "0";
    const hot = get(k, "Hot mới");
    const src = (hot?.d || []).find((x: string) => x.startsWith("SMAX")) || "";
    let s = `\n━━ ${nm} ━━`;
    if (c) s += `  (đang tuyển sinh: ${c.code} · ngày thứ ${c.days})`;
    s += `\n• Lead mới: ${g("Lead mới")}`;
    s += `\n• Hot mới: ${g("Hot mới")}${src ? `   (${src})` : ""}`;
    s += `\n• Cold: ${g("Cold")}  ·  Warm: ${g("Warm")}  ·  Prospect: ${g("Prospect")}`;
    s += `\n• Chưa phản hồi: ${g("Chưa phản hồi")}`;
    if (c) {
      const pc = (v: number) => c.leads ? Math.round(v / c.leads * 100) + "%" : "0%";
      s += `\n• Luỹ kế cả khoá ${c.code}: ${c.leads} lead`;
      s += `\n   ↳ Hot ${c.H} (${pc(c.H)}) · Warm ${c.W} (${pc(c.W)}) · Cold ${c.C} (${pc(c.C)}) · Prospect ${c.P} (${pc(c.P)}) · Khác ${c.Un} (${pc(c.Un)})`;
    }
    return s;
  };

  console.log("════════ NỘI DUNG THẺ TEXT SẼ BẮN ════════\n");
  console.log("📋 CHECK LEADS / TAG / PROCESS");
  console.log(`Báo cáo ngày: ${today}`);
  console.log(`Kỳ báo cáo: ${bi.range.replace(/^🗓\s*/, "")}`);
  console.log(block("BI", bi, cBI));
  console.log(block("FA", fa, cFA));
  console.log("\n———");
  console.log("Nguồn: SMAX + Salesforce · Automation Bot — Mastering Data Analytics");
  console.log("\n══════════════════════════════════════════");
})();
