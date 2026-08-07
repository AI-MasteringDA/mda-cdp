/**
 * Daily_Report — bảng tổng hợp NGÀY trên Lark (nguồn cho Dashboard "Hôm qua").
 *
 * Đọc SMAX_Database (đã sạch: 1 người = 1 dòng, Báo cáo ngày = ngày chat đầu,
 * Tag SMAX đồng bộ mỗi giờ) → đếm mỗi ngày, theo QUY TẮC SALES (confirm 2026-08-06):
 *   - Lead mới / Prospect / Cold / Warm ("New in day"): theo NGÀY CHAT ĐẦU
 *     (Báo cáo ngày) + đang có tag đó.
 *   - HOT: theo THỜI ĐIỂM GẮN TAG ("Hot Lead lúc") — hot có thể là lead cũ,
 *     hôm qua mới LÊN hot thì tính cho hôm qua, không theo ngày chat đầu.
 * Tách BI (tag K##/KH##) vs FA (tag F#), và theo Communication Channels.
 * Upsert 40 ngày gần nhất mỗi lần chạy (idempotent, key = Báo cáo ngày).
 *
 * Đây chính là bản TỰ ĐỘNG của bảng "4.1/4.2 Check Lead" sales đếm tay.
 * Chạy: npm run etl:daily:report (cùng cron với lead-first-chat, sau bước sync).
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const ID = process.env.LARK_APP_ID || "", SEC = process.env.LARK_APP_SECRET || "", APP = process.env.LARK_BASE_APP_TOKEN || "";
const U = "https://open.larksuite.com/open-apis";
const TABLE = "Daily_Report";
const DAYS = 40;

const norm = (s: unknown) => String(s).toLowerCase().replace(/[\s_-]+/g, "");
const CLASSES: Record<string, string> = { hotlead: "Hot", coldlead: "Cold", warmlead: "Warm", prospect: "Prospect" };
const isBI = (t: string) => /^kh?\d{2,3}$/i.test(t.trim());
const isFA = (t: string) => /^f\d(\.\d)?$/i.test(t.trim());
const CHANNELS = ["Facebook MDA", "Facebook PTA", "Zalo 48", "Zalo OA MDA", "Website MDA", "Instagram MDA", "Instagram PTA"];

// cột số của bảng (thứ tự hiển thị)
const NUM_COLS = [
  "Lead mới", "Prospect", "Cold", "Warm", "Hot",
  "Prospect (BI)", "Cold (BI)", "Warm (BI)", "Hot (BI)",
  "Prospect (FA)", "Cold (FA)", "Warm (FA)", "Hot (FA)",
  ...CHANNELS,
];

const arr = (v: unknown): string[] => Array.isArray(v) ? v.map((x) => (typeof x === "object" && x !== null ? ((x as { text?: string; name?: string }).text ?? (x as { name?: string }).name ?? "") : String(x))).filter(Boolean) : [];
const vnDate = (ms: number) => new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10);

export async function runDailyReport() {
  if (!ID || !APP) { console.log("[daily-report] thiếu creds, bỏ qua"); return; }
  const tk = await fetch(`${U}/auth/v3/tenant_access_token/internal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: ID, app_secret: SEC }) }).then(r => r.json()).then(j => j.tenant_access_token);
  const H = { Authorization: `Bearer ${tk}` };
  const tR = await fetch(`${U}/bitable/v1/apps/${APP}/tables?page_size=100`, { headers: H }).then(r => r.json());
  const src = tR.data.items.find((t: { name: string; table_id: string }) => t.name === "SMAX_Database")?.table_id;
  if (!src) { console.log("[daily-report] không thấy SMAX_Database"); return; }

  // 1) đọc SMAX_Database → đếm theo ngày
  const cutoffMs = Date.now() - DAYS * 86400_000;
  type Row = Record<string, number>;
  const byDay = new Map<string, Row>(); // "2026-08-05" → counts
  let pt: string | undefined;
  while (true) {
    const url = new URL(`${U}/bitable/v1/apps/${APP}/tables/${src}/records`); url.searchParams.set("page_size", "500");
    url.searchParams.set("field_names", JSON.stringify(["Báo cáo ngày", "Tag SMAX", "Communication Channels", "Hot Lead lúc"]));
    if (pt) url.searchParams.set("page_token", pt);
    const d = await fetch(url.toString(), { headers: H }).then(r => r.json());
    if (d.code !== 0) { console.log(`[daily-report] đọc lỗi ${d.code}`); return; }
    for (const r of (d.data?.items ?? [])) {
      const tags = arr(r.fields?.["Tag SMAX"]);
      // RULE SALES: Spam / Đã Block là rác — không phải lead.
      if (tags.some(t => norm(t) === "spam" || norm(t).includes("block"))) continue;
      // RULE SALES: comment CHƯA gắn tag → không đếm. Comment ĐÃ gắn tag → vẫn đếm.
      if (!tags.length && arr(r.fields?.["Communication Channels"]).includes("Comment (chưa inbox)")) continue;
      const bi = tags.some(isBI), fa = tags.some(isFA);
      const getRow = (day: string) => { const row = byDay.get(day) ?? Object.fromEntries(NUM_COLS.map(c => [c, 0])); byDay.set(day, row); return row; };
      // Lead mới + Prospect/Cold/Warm + channel: theo NGÀY CHAT ĐẦU
      const bc = r.fields?.["Báo cáo ngày"];
      if (typeof bc === "number" && bc >= cutoffMs) {
        const row = getRow(vnDate(bc));
        row["Lead mới"]++;
        const cls = new Set(tags.map(t => CLASSES[norm(t)]).filter(Boolean));
        cls.delete("Hot"); // Hot đếm riêng theo tag-time bên dưới
        for (const c of cls) { row[c as string]++; if (bi) row[`${c} (BI)`]++; if (fa) row[`${c} (FA)`]++; }
        for (const ch of arr(r.fields?.["Communication Channels"])) if (ch in row) row[ch]++;
      }
      // HOT: theo THỜI ĐIỂM GẮN TAG (Hot Lead lúc) — quy tắc sales
      const hl = r.fields?.["Hot Lead lúc"];
      if (typeof hl === "number" && hl >= cutoffMs && tags.some(t => norm(t) === "hotlead")) {
        const row = getRow(vnDate(hl));
        row["Hot"]++; if (bi) row["Hot (BI)"]++; if (fa) row["Hot (FA)"]++;
      }
    }
    if (!d.data?.has_more) break; pt = d.data.page_token;
  }
  console.log(`[daily-report] đếm ${byDay.size} ngày (cửa sổ ${DAYS} ngày)`);

  // 2) bảng Daily_Report — tạo nếu chưa có
  let dst = tR.data.items.find((t: { name: string; table_id: string }) => t.name === TABLE)?.table_id;
  if (!dst) {
    const cr = await fetch(`${U}/bitable/v1/apps/${APP}/tables`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ table: { name: TABLE, default_view_name: "Theo ngày", fields: [{ field_name: "Báo cáo ngày", type: 5, property: { date_formatter: "yyyy-MM-dd", auto_fill: false } }, ...NUM_COLS.map(c => ({ field_name: c, type: 2, property: { formatter: "0" } }))] } }) }).then(r => r.json());
    if (cr.code !== 0) { console.log(`[daily-report] tạo bảng lỗi: ${cr.code} ${cr.msg}`); return; }
    dst = cr.data.table_id;
    console.log(`[daily-report] đã tạo bảng "${TABLE}"`);
  }

  // 3) upsert theo Báo cáo ngày
  const existing = new Map<string, { rec: string; fields: Record<string, unknown> }>();
  pt = undefined;
  while (true) {
    const url = new URL(`${U}/bitable/v1/apps/${APP}/tables/${dst}/records`); url.searchParams.set("page_size", "500");
    if (pt) url.searchParams.set("page_token", pt);
    const d = await fetch(url.toString(), { headers: H }).then(r => r.json());
    for (const r of (d.data?.items ?? [])) { const bc = r.fields?.["Báo cáo ngày"]; if (typeof bc === "number") existing.set(vnDate(bc), { rec: r.record_id, fields: r.fields }); }
    if (!d.data?.has_more) break; pt = d.data.page_token;
  }
  const creates: unknown[] = []; const updates: { record_id: string; fields: Record<string, unknown> }[] = [];
  for (const [day, row] of byDay) {
    const ms = new Date(day + "T00:00:00Z").getTime() - 7 * 3600 * 1000;
    const ex = existing.get(day);
    if (!ex) { creates.push({ fields: { "Báo cáo ngày": ms, ...row } }); continue; }
    const patch: Record<string, unknown> = {};
    for (const c of NUM_COLS) { const cur = typeof ex.fields[c] === "number" ? ex.fields[c] : Number(ex.fields[c] ?? NaN); if (cur !== row[c]) patch[c] = row[c]; }
    if (Object.keys(patch).length) updates.push({ record_id: ex.rec, fields: patch });
  }
  let created = 0, updated = 0;
  for (let i = 0; i < creates.length; i += 400) { const rr = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dst}/records/batch_create`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ records: creates.slice(i, i + 400) }) }).then(r => r.json()); if (rr.code === 0) created += creates.slice(i, i + 400).length; else console.log(`[daily-report] create lỗi ${rr.code} ${rr.msg}`); }
  for (let i = 0; i < updates.length; i += 400) { const rr = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${dst}/records/batch_update`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ records: updates.slice(i, i + 400) }) }).then(r => r.json()); if (rr.code === 0) updated += updates.slice(i, i + 400).length; else console.log(`[daily-report] update lỗi ${rr.code} ${rr.msg}`); }
  console.log(`[daily-report] ${TABLE}: tạo ${created} dòng, cập nhật ${updated} dòng`);
}

runDailyReport().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
