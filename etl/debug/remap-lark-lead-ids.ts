/**
 * Sau khi backfill khôi phục SMAX, các lead bị xoá được TẠO LẠI với lead_id
 * (UUID) MỚI. Lark vẫn đang giữ lead_id CŨ trong cột "Lead ID" → lần push tới
 * sẽ không khớp và INSERT dòng trùng cho cùng một người.
 *
 * Script này remap: khớp dòng Lark ↔ lead mới qua cột "ID" (external_profile_id
 * — pid nền tảng của SMAX, KHÔNG đổi khi lead được tạo lại), rồi ghi lead_id
 * mới vào "Lead ID".
 *
 *   DRY_RUN=1 (mặc định) chỉ in kế hoạch. DRY_RUN=0 để ghi thật.
 */
import { admin } from "../lib/supabase-admin";

const LARK_APP_ID = process.env.LARK_APP_ID || "";
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || "";
const APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || "";
const BASE_URL = "https://open.larksuite.com/open-apis";
const DRY_RUN = process.env.DRY_RUN !== "0";

const PREFIXES = ["zlw", "fb", "ig", "zl", "ctm"];
function stripPrefix(pid: string): string {
  for (const p of PREFIXES) if (pid.startsWith(p)) return pid.slice(p.length);
  return pid;
}

async function main() {
  console.log(DRY_RUN ? "🟡 DRY_RUN\n" : "🔴 LIVE\n");

  // 1. DB: pid (đã strip) → lead_id hiện tại
  const pidToLead = new Map<string, string>();
  const liveLeadIds = new Set<string>();
  let from = 0;
  while (from < 30000) {
    const { data } = await admin
      .from("dim_lead")
      .select("lead_id, external_profile_id")
      .eq("source", "smax")
      .range(from, from + 999);
    if (!data?.length) break;
    for (const l of data) {
      liveLeadIds.add(l.lead_id);
      if (l.external_profile_id) pidToLead.set(stripPrefix(l.external_profile_id), l.lead_id);
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`DB: ${liveLeadIds.size} lead smax · ${pidToLead.size} có pid`);

  // 2. Lark rows
  const auth = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET }),
  }).then(r => r.json());
  const token = auth.tenant_access_token;
  const tRes = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables?page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  const tableId = tRes.data.items.find((t: { name: string }) => t.name === "SMAX_Database").table_id;

  const txt = (v: unknown): string =>
    typeof v === "string" ? v : Array.isArray(v) ? String((v[0] as { text?: string })?.text ?? "") : "";

  const updates: Array<{ record_id: string; fields: Record<string, unknown> }> = [];
  let stillValid = 0, noPid = 0, pidNotInDb = 0, total = 0;
  let pageToken: string | undefined;
  while (true) {
    const url = new URL(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`);
    url.searchParams.set("page_size", "500");
    url.searchParams.set("field_names", JSON.stringify(["Lead ID", "ID", "Lead Name"]));
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
    for (const rec of res.data?.items ?? []) {
      total++;
      const oldLead = txt(rec.fields?.["Lead ID"]);
      const pid = txt(rec.fields?.["ID"]);
      if (oldLead && liveLeadIds.has(oldLead)) { stillValid++; continue; }  // lead còn sống, giữ nguyên
      if (!pid) { noPid++; continue; }
      const newLead = pidToLead.get(pid);
      if (!newLead) { pidNotInDb++; continue; }
      updates.push({ record_id: rec.record_id, fields: { "Lead ID": newLead } });
    }
    if (!res.data?.has_more) break;
    pageToken = res.data.page_token;
  }

  console.log(`\nLark: ${total} dòng`);
  console.log(`  ✓ Lead ID còn hợp lệ:        ${stillValid}`);
  console.log(`  ↻ Cần remap (khớp qua pid):  ${updates.length}`);
  console.log(`  ⚠ Không có pid:              ${noPid}`);
  console.log(`  ⚠ pid không có trong DB:     ${pidNotInDb}  (lead cũ SMAX API không còn trả về)`);

  if (DRY_RUN) { console.log("\n🟡 DRY_RUN — chưa ghi gì. DRY_RUN=0 để chạy thật."); return; }

  let written = 0;
  for (let i = 0; i < updates.length; i += 400) {
    const chunk = updates.slice(i, i + 400);
    const res = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_update`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: chunk }),
    }).then(r => r.json());
    if (res.code === 0) written += chunk.length;
    else console.warn(`⚠️ ${JSON.stringify(res).slice(0, 140)}`);
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`\n✅ Remap ${written} dòng Lark sang lead_id mới`);
}
main().catch(e => { console.error(e); process.exit(1); });
