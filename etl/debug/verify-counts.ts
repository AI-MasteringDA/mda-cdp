/**
 * ĐỐI CHIẾU ĐỘC LẬP: đếm thẳng từ SMAX API rồi so với số /api/radar trả ra.
 * Dùng để tự kiểm "số có đúng không" mà không phải tin vào pipeline.
 *
 * LƯU Ý QUAN TRỌNG khi gộp người (học được 2026-08-17): SMAX tách bản ghi theo
 * NỀN TẢNG, một người nhắn Facebook rồi nhắn thêm Zalo = 2 bản ghi với 2
 * interaction.first khác nhau. Phải lấy mốc SỚM NHẤT trong cả nhóm — bản đầu
 * của script này giữ bản ghi gặp trước nên báo lệch oan 1-4 lead/ngày (ca "Vũ
 * Hạnh": Zalo 13/08 nhưng Facebook đã 23/07, dashboard quy 23/07 mới đúng).
 *
 * Chạy: npx tsx etl/debug/verify-counts.ts
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
const T = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const B = process.env.SMAX_BASE_URL || "https://api.smax.ai";
const KEY = process.env.RADAR_SNAPSHOT_KEY!;
const day = (ms: number) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10);
const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
const post = (b: any) => fetch(`${B}/bizs/mastering-data-analytics/customers`, { method: "POST", headers: { Authorization: `Bearer ${T}`, "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json());
const normPh = (p: any) => { const d = String(p ?? "").replace(/\D/g, ""); return d.length >= 9 ? d.slice(-9) : ""; };

(async () => {
  const pageIds: string[] = [];
  const pg = await fetch(`${B}/bizs/mastering-data-analytics/pages`, { headers: { Authorization: `Bearer ${T}` } }).then(r => r.json());
  for (const p of (pg.data ?? pg.pages ?? [])) { const x = p.pid || p.page_pid || p.id; if (x) pageIds.push(x); }
  const cust = new Map<string, any>();
  for (const p of pageIds) { const r = await post({ size: 10000, page_pids: [p] }); for (const c of (r.data || [])) if (c.id) cust.set(c.id, c); }

  // gom theo NGƯỜI (khoá = SĐT, hoặc gmail, hoặc chính pid khi không có gì) và
  // giữ mốc chat SỚM NHẤT của cả nhóm — đúng cách pipeline quy ngày.
  const person = new Map<string, { first: number; hot: number[] }>();
  for (const c of cust.values()) {
    const tags = (c.tags || []).map((t: any) => String(t.name || t.alias || ""));
    if (tags.some((t: string) => norm(t) === "spam" || norm(t).includes("block"))) continue;
    if (String(c.platform || "") === "facebook" && !c.facebook?.conversation_id) continue;
    const ph = normPh(c.phone), em = String(c.email ?? "").toLowerCase().trim();
    const key = ph || (em.endsWith("@gmail.com") ? em : "") || String(c.pid ?? c.id);
    const f = c.interaction?.first ?? c.created_at;
    const fm = f ? new Date(f).getTime() : 0; if (!fm) continue;
    const cur = person.get(key) ?? { first: Infinity, hot: [] };
    if (fm < cur.first) cur.first = fm;
    for (const tg of (c.tags || [])) {
      if (norm(String(tg.name || tg.alias || "")) !== "hotlead") continue;
      const t = tg.time ? new Date(tg.time).getTime() : 0; if (t) cur.hot.push(t);
    }
    person.set(key, cur);
  }
  const smaxDay: Record<string, number> = {}, smaxHot: Record<string, number> = {};
  for (const p of person.values()) {
    if (Number.isFinite(p.first)) { const d = day(p.first); smaxDay[d] = (smaxDay[d] || 0) + 1; }
    if (p.hot.length) { const d = day(Math.max(...p.hot)); smaxHot[d] = (smaxHot[d] || 0) + 1; }
  }

  const r = await fetch(`https://mda-cdp.vercel.app/api/radar?key=${encodeURIComponent(KEY)}`).then(r => r.json());
  const dashDay: Record<string, number> = {}, dashHot: Record<string, number> = {}, sfHot: Record<string, number> = {};
  for (const l of (r.leads || [])) {
    if (l.re) continue;
    if (l.sf) { if (l.ha) sfHot[l.ha] = (sfHot[l.ha] || 0) + 1; continue; }
    if (l.d) dashDay[l.d] = (dashDay[l.d] || 0) + 1;
    if (l.ha && !l.up) dashHot[l.ha] = (dashHot[l.ha] || 0) + 1;
  }

  const days = [...new Set([...Object.keys(smaxDay), ...Object.keys(dashDay)])].filter(d => d >= "2026-08-10").sort();
  console.log("NGÀY          LEAD MỚI              HOT (SMAX)          + SF");
  for (const d of days) {
    const a = smaxDay[d] || 0, b = dashDay[d] || 0, c2 = smaxHot[d] || 0, e = dashHot[d] || 0;
    console.log(`${d}   ${String(a).padStart(4)} → ${String(b).padStart(4)} ${a === b ? "✓" : `⚠ ${b - a}`}      ${String(c2).padStart(3)} → ${String(e).padStart(3)} ${c2 === e ? "✓" : `⚠ ${e - c2}`}     +${sfHot[d] || 0}`);
  }
})();
