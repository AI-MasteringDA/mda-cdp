/**
 * CHẠY THỬ — KHÔNG GHI GÌ. Xem nếu để bridge tự tạo dòng mới trên Lark cho các
 * khách SMAX chưa có dòng thì nó sẽ tạo cái gì, và rủi ro trùng tới đâu.
 *
 * Phân loại theo mức rủi ro đẻ lead trùng:
 *   A. CÓ SĐT/email riêng, không đụng dòng nào  → an toàn, gần chắc là người mới
 *   B. KHÔNG có thông tin liên hệ nào           → mơ hồ: có thể là kênh thứ 2 của
 *      người đã có dòng (SMAX tách bản ghi theo nền tảng) → tạo là có thể trùng
 *   C. Chỉ-comment chưa inbox                   → theo luật sales KHÔNG tính lead
 *
 * Chạy: npx tsx etl/debug/dryrun-new-leads.ts
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const T = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const BASE = process.env.SMAX_BASE_URL || "https://api.smax.ai";
const BIZ = "mastering-data-analytics";
const ID = process.env.LARK_APP_ID!, SEC = process.env.LARK_APP_SECRET!, APP = process.env.LARK_BASE_APP_TOKEN!;
const U = "https://open.larksuite.com/open-apis";

const normPh = (p: unknown) => (p ? String(p).replace(/\D/g, "").replace(/^84/, "").replace(/^0/, "") : "");
const phoneFromName = (n: unknown) => { const m = String(n || "").match(/0\d{8,10}/); return m ? normPh(m[0]) : ""; };
const stripSmaxId = (p: unknown) => String(p ?? "").replace(/^(fb|zlw|zl|ig|ctm)/i, "");
const txt = (v: any) => Array.isArray(v) ? v.map((x: any) => x?.text ?? "").join("") : (v == null ? "" : String(v));
const vn = (ms: number) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 16).replace("T", " ");

(async () => {
  const a = await fetch(`${U}/auth/v3/tenant_access_token/internal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: ID, app_secret: SEC }) }).then(r => r.json());
  const tk = a.tenant_access_token;
  const tR = await fetch(`${U}/bitable/v1/apps/${APP}/tables?page_size=100`, { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
  const dbId = tR.data.items.find((t: any) => t.name === "SMAX_Database").table_id;

  const byPid = new Map<string, string>(), byPhone = new Map<string, string>(), byEmail = new Map<string, string>();
  let pt: string | undefined, nRows = 0;
  while (true) {
    const u = new URL(`${U}/bitable/v1/apps/${APP}/tables/${dbId}/records`);
    u.searchParams.set("page_size", "500"); u.searchParams.set("field_names", JSON.stringify(["ID", "Phone", "Email", "Lead Name"]));
    if (pt) u.searchParams.set("page_token", pt);
    const d = await fetch(u.toString(), { headers: { Authorization: `Bearer ${tk}` } }).then(r => r.json());
    if (d.code !== 0) { console.log("LỖI đọc Lark:", d.code, d.msg); return; }
    for (const r of d.data?.items || []) {
      nRows++;
      const f = r.fields || {};
      const pid = txt(f["ID"]).trim(); if (pid && !byPid.has(pid)) byPid.set(pid, r.record_id);
      const ph = normPh(txt(f["Phone"])); if (ph && !byPhone.has(ph)) byPhone.set(ph, r.record_id);
      const nph = phoneFromName(txt(f["Lead Name"])); if (nph && !byPhone.has(nph)) byPhone.set(nph, r.record_id);
      const em = txt(f["Email"]).toLowerCase().trim(); if (em && !byEmail.has(em)) byEmail.set(em, r.record_id);
    }
    if (!d.data?.has_more) break; pt = d.data.page_token;
  }
  console.log(`Lark: ${nRows} dòng | pid=${byPid.size} sđt=${byPhone.size} email=${byEmail.size}\n`);

  const custPost = (b: unknown) => fetch(`${BASE}/bizs/${BIZ}/customers`, { method: "POST", headers: { Authorization: `Bearer ${T}`, "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json());
  const pageIds: string[] = [];
  try { const pg = await fetch(`${BASE}/bizs/${BIZ}/pages`, { headers: { Authorization: `Bearer ${T}` } }).then(r => r.json()); for (const p of (pg.data ?? pg.pages ?? [])) { const x = p.pid || p.page_pid || p.id; if (x) pageIds.push(x); } } catch { }
  const cust = new Map<string, any>();
  if (pageIds.length) { for (const p of pageIds) { const r = await custPost({ size: 10000, page_pids: [p] }); for (const c of (r.data || [])) if (c.id) cust.set(c.id, c); } }
  else { const r = await custPost({ size: 10000 }); for (const c of (r.data || [])) if (c.id) cust.set(c.id, c); }
  const customers = [...cust.values()];
  console.log(`SMAX: ${customers.length} khách\n`);

  const A: any[] = [], B: any[] = [], C: any[] = [];
  // SĐT/email của các khách CHƯA khớp — dùng để phát hiện 2 khách chưa khớp
  // nhưng cùng liên hệ (⇒ cùng người, chỉ nên tạo 1 dòng).
  const unmatchedPhone = new Map<string, number>(), unmatchedEmail = new Map<string, number>();
  for (const c of customers) {
    const namePh = phoneFromName(c.name);
    const hit = byPid.get(stripSmaxId(c.pid)) || byPid.get(String(c.id ?? ""))
      || (c.phone && byPhone.get(normPh(c.phone))) || (namePh && byPhone.get(namePh))
      || (c.email && byEmail.get(String(c.email).toLowerCase().trim()));
    if (hit) continue;
    const isFb = String(c.platform || "") === "facebook";
    const commentOnly = isFb && !c.facebook?.conversation_id;
    const ph = normPh(c.phone) || namePh;
    const em = String(c.email ?? "").toLowerCase().trim();
    const rec = { name: c.name, pid: c.pid, platform: c.platform, phone: ph, email: em, tags: (c.tags || []).map((t: any) => t.name).filter(Boolean), first: c.interaction?.first ?? c.created_at, last: c.last_message_at };
    if (commentOnly) { C.push(rec); continue; }
    if (ph || em) {
      A.push(rec);
      if (ph) unmatchedPhone.set(ph, (unmatchedPhone.get(ph) || 0) + 1);
      if (em) unmatchedEmail.set(em, (unmatchedEmail.get(em) || 0) + 1);
    } else B.push(rec);
  }

  const dupPh = [...unmatchedPhone.entries()].filter(([, n]) => n > 1);
  const dupEm = [...unmatchedEmail.entries()].filter(([, n]) => n > 1);

  console.log("══════════ NẾU CHO TẠO DÒNG MỚI ══════════");
  console.log(`A. CÓ SĐT/email riêng (an toàn)          : ${A.length}`);
  console.log(`B. KHÔNG có liên hệ nào (rủi ro trùng)   : ${B.length}`);
  console.log(`C. Comment chưa inbox (luật sales: bỏ)   : ${C.length}`);
  console.log(`   → tổng chưa khớp: ${A.length + B.length + C.length}`);
  console.log(`\nTrong nhóm A, số nhóm khách khác nhau nhưng TRÙNG liên hệ nhau:`);
  console.log(`   trùng SĐT  : ${dupPh.length} nhóm (${dupPh.reduce((s, [, n]) => s + n, 0)} khách) → phải gộp, không tạo rời`);
  console.log(`   trùng email: ${dupEm.length} nhóm (${dupEm.reduce((s, [, n]) => s + n, 0)} khách)`);

  const withTag = (arr: any[]) => arr.filter(r => r.tags.length).length;
  console.log(`\nCó gắn tag (⇒ sales đã xác nhận là lead thật):`);
  console.log(`   A: ${withTag(A)}/${A.length} · B: ${withTag(B)}/${B.length} · C: ${withTag(C)}/${C.length}`);

  console.log(`\n── Mẫu nhóm A (10 đầu) ──`);
  for (const r of A.slice(0, 10)) console.log(`   "${r.name}" [${r.platform}] sđt=${r.phone || "-"} mail=${r.email || "-"} tag=[${r.tags.join(",")}] chat cuối=${r.last ? vn(new Date(r.last).getTime()) : "-"}`);
  console.log(`\n── Mẫu nhóm B (10 đầu) ──`);
  for (const r of B.slice(0, 10)) console.log(`   "${r.name}" [${r.platform}] tag=[${r.tags.join(",")}] chat cuối=${r.last ? vn(new Date(r.last).getTime()) : "-"}`);
})();

