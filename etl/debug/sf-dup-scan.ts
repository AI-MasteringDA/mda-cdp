/**
 * Quét lead TRÙNG bên Salesforce (chỉ đọc, không sửa gì).
 * Trả lời: có bao nhiêu người bị tách thành nhiều Lead, khớp được bằng khoá nào.
 * Chạy: npx tsx etl/debug/sf-dup-scan.ts
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
const INST = process.env.SALESFORCE_INSTANCE_URL!, CID = process.env.SALESFORCE_CLIENT_ID!, CSEC = process.env.SALESFORCE_CLIENT_SECRET!;
const V = process.env.SALESFORCE_API_VERSION || "v59.0";
const nph = (p: any) => { const d = String(p ?? "").replace(/\D/g, ""); return d.length >= 9 ? d.slice(-9) : ""; };
const nem = (e: any) => String(e ?? "").toLowerCase().trim();
const nnm = (s: any) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();
(async () => {
  const tr = await fetch(`${INST}/services/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: CID, client_secret: CSEC }) }).then(r => r.json());
  const H = { Authorization: `Bearer ${tr.access_token}` };
  const out: any[] = [];
  let url: string | null = `${INST}/services/data/${V}/query?q=${encodeURIComponent(`SELECT Id, Name, Email, Phone, MobilePhone, Rating, IsConverted, ConvertedContactId, CreatedDate FROM Lead WHERE CreatedDate >= LAST_N_DAYS:90 ORDER BY CreatedDate DESC`)}`;
  while (url) { const j: any = await fetch(url, { headers: H }).then(r => r.json()); out.push(...(j.records || [])); url = j.nextRecordsUrl ? `${INST}${j.nextRecordsUrl}` : null; }
  console.log(`Salesforce: ${out.length} lead trong 90 ngày\n`);

  const group = (keyFn: (r: any) => string, label: string) => {
    const m = new Map<string, any[]>();
    for (const r of out) { const k = keyFn(r); if (!k) continue; const a = m.get(k) || []; a.push(r); m.set(k, a); }
    const dups = [...m.entries()].filter(([, a]) => a.length > 1);
    const n = dups.reduce((s, [, a]) => s + a.length, 0);
    console.log(`${label}: ${dups.length} nhóm · ${n} lead (thừa ${n - dups.length})`);
    return dups;
  };
  const byEmail = group(r => nem(r.Email), "Trùng EMAIL     ");
  const byPhone = group(r => nph(r.Phone) || nph(r.MobilePhone), "Trùng SĐT       ");
  const byName  = group(r => nnm(r.Name), "Trùng TÊN (thô) ");
  const byConv  = group(r => r.ConvertedContactId || "", "Cùng Contact SF ");

  const noKey = out.filter(r => !nem(r.Email) && !nph(r.Phone) && !nph(r.MobilePhone));
  console.log(`\nLead KHÔNG có email lẫn SĐT (không thể gộp tự động): ${noKey.length}`);
  for (const r of noKey.slice(0, 8)) console.log(`   "${r.Name}" tạo=${r.CreatedDate?.slice(0,10)} rating=${r.Rating ?? "-"}`);

  console.log(`\n── Mẫu nhóm trùng EMAIL (5 nhóm) ──`);
  for (const [k, a] of byEmail.slice(0, 5)) {
    console.log(`  ${k}`);
    for (const r of a) console.log(`     "${r.Name}" ${r.CreatedDate?.slice(0,10)} rating=${r.Rating ?? "-"} convert=${r.IsConverted}`);
  }
  console.log(`\n── Mẫu nhóm trùng SĐT (5 nhóm) ──`);
  for (const [k, a] of byPhone.slice(0, 5)) {
    console.log(`  ${k}`);
    for (const r of a) console.log(`     "${r.Name}" ${r.CreatedDate?.slice(0,10)} rating=${r.Rating ?? "-"} convert=${r.IsConverted}`);
  }
  void byName; void byConv;
})();
