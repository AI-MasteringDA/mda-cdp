/**
 * ĐỐI CHIẾU CỘT HOT CỦA DASHBOARD VỚI SALESFORCE — từng khoá một.
 *
 * Dùng mỗi khi nghi ngờ số Hot lệch, hoặc sau khi sửa /api/radar. Hot trên
 * dashboard phải bằng ĐÚNG ô "No. of Leads" bên Salesforce khi lọc cùng khoá
 * (user chốt 2026-09-11: "Hot lead luôn luôn lấy từ SF, SF chuẩn 100%").
 *
 *   npx tsx etl/debug/check-hot-vs-sf.ts                          # dashboard đang chạy trên máy
 *   npx tsx etl/debug/check-hot-vs-sf.ts https://mda-cdp.vercel.app
 *
 * Hai bên phải dùng CÙNG cửa sổ ngày, nếu không khoá cũ sẽ lệch một cách vô
 * hại — script đã tự đặt cả hai về 300 ngày.
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
const INST = process.env.SALESFORCE_INSTANCE_URL!, CID = process.env.SALESFORCE_CLIENT_ID!,
      CSEC = process.env.SALESFORCE_CLIENT_SECRET!, V = process.env.SALESFORCE_API_VERSION || "v59.0";
const BASE = process.argv[2] || "http://localhost:3111";

(async () => {
  const tr = await fetch(`${INST}/services/oauth2/token`, { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: CID, client_secret: CSEC }) }).then(r => r.json());
  const N = 300;
  const from = new Date(Date.now() - N * 86400_000).toISOString().slice(0, 19) + "Z";
  const soql = `SELECT Product__r.Name p, COUNT(Id) n FROM Lead
    WHERE CreatedDate >= ${from} GROUP BY Product__r.Name`;
  const q = await fetch(`${INST}/services/data/${V}/query?q=${encodeURIComponent(soql)}`,
    { headers: { Authorization: `Bearer ${tr.access_token}` } }).then(r => r.json());
  const sf = new Map<string, number>();
  const code = (s: string) => (String(s || "").trim().match(/^(KH?\d{2,3}|F\d(?:\.\d)?)\b/i)?.[1] || "(trống)").toUpperCase();
  for (const x of q.records as any[]) { const c = code(x.p); sf.set(c, (sf.get(c) || 0) + x.n) }

  const d = await fetch(`${BASE}/api/radar?days=300`).then(r => r.json());
  if (d.error) { console.log("API lỗi:", d.error); return }
  console.log(`sfHot = ${d.sfHot} dòng Salesforce nạp vào · sfErr = ${d.sfErr || "(không)"}\n`);
  const app = new Map<string, number>();
  for (const l of d.leads as any[]) if (l.sf) { const cs = (l.co||[]).length ? l.co : ["(TRỐNG)"]; for (const c of cs) app.set(c, (app.get(c) || 0) + 1) }
  const chuaCo = (d.leads as any[]).filter(l => l.sf && !(l.co || []).length).length;

  const ma = [...new Set([...sf.keys(), ...app.keys()])].sort();
  console.log("KHOÁ      SALESFORCE   DASHBOARD   ");
  let lech = 0;
  for (const c of ma) {
    const a = sf.get(c) ?? 0, b = app.get(c) ?? 0;
    const ok = a === b;
    if (!ok) lech++;
    console.log(`  ${c.padEnd(8)} ${String(a).padStart(8)} ${String(b).padStart(11)}   ${ok ? "khớp" : "LỆCH " + (b - a)}`);
  }
  console.log(`\nDòng SF không có mã khoá: ${chuaCo}`);
  console.log(lech ? `\n⚠ ${lech} khoá lệch` : "\n✅ mọi khoá khớp");
})();
