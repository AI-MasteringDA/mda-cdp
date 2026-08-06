/**
 * Tự gộp "shadow-dup": lead KHÔNG có external_profile_id nhưng touchpoint SMAX của
 * nó mang tid ĐÃ THUỘC 1 lead khác (= cùng 1 hội thoại/1 người). Đây là bản trùng
 * (thường lead Instantly/email dính vào cuộc chat SMAX của lead-kênh).
 *
 * An toàn theo policy [[feedback-no-auto-merge-leads]]: chỉ xóa khi là bản trùng
 * RỖNG (đã dời hết touchpoint sang lead-owner cùng tid = cùng người), giữ lead-owner.
 * Chạy mỗi giờ để dọn các ca bị sót do timing (owner chưa có pid lúc lần trước).
 *
 * Chạy: npm run etl:dedup:shadow
 */
import { admin } from "../lib/supabase-admin";

const ID = process.env.LARK_APP_ID || "", SEC = process.env.LARK_APP_SECRET || "", APP = process.env.LARK_BASE_APP_TOKEN || "";
const U = "https://open.larksuite.com/open-apis";
const g = (v: unknown) => Array.isArray(v) ? (v as { text?: string }[]).map(x => x?.text ?? "").join("") : (v == null ? "" : String(v));

export async function runDedupShadow() {
  if (!APP) { console.log("[dedup-shadow] thiếu creds, bỏ qua"); return; }
  // pid → owner lead + contact info
  const owner = new Map<string, string>(); const info = new Map<string, { email: string | null; phone: string | null }>();
  let f = 0;
  while (f < 90000) { const { data } = await admin.from("dim_lead").select("lead_id, external_profile_id, email, phone").range(f, f + 999); if (!data?.length) break; for (const l of data) { if (l.external_profile_id) owner.set(l.external_profile_id, l.lead_id); info.set(l.lead_id, { email: l.email, phone: l.phone }); } if (data.length < 1000) break; f += 1000; }
  // leads thiếu pid
  const nullLeads: { lid: string; email: string | null; phone: string | null }[] = []; f = 0;
  while (f < 90000) { const { data } = await admin.from("dim_lead").select("lead_id, email, phone").is("external_profile_id", null).range(f, f + 999); if (!data?.length) break; for (const l of data) nullLeads.push({ lid: l.lead_id, email: l.email, phone: l.phone }); if (data.length < 1000) break; f += 1000; }

  let merged = 0, claimed = 0; const dropIds: string[] = [];
  for (let i = 0; i < nullLeads.length; i += 200) {
    const b = nullLeads.slice(i, i + 200);
    const { data } = await admin.from("fact_touchpoint").select("lead_id, payload, dedup_key, occurred_at").in("lead_id", b.map(x => x.lid)).eq("source", "smax").order("occurred_at", { ascending: true });
    const tidByLead = new Map<string, string>(); const cidByLead = new Map<string, string>();
    for (const r of (data ?? [])) {
      const p = (r.payload ?? {}) as { tid?: string; thread_id?: string; smax_customer_id?: string };
      if (p.tid && !tidByLead.has(r.lead_id)) tidByLead.set(r.lead_id, p.tid);
      // cid (mongo id SMAX) từ payload — dùng khi lead không có tid riêng
      const cid = p.smax_customer_id || (String(r.dedup_key || "").startsWith("cust-") ? String(r.dedup_key).slice(5) : (p.thread_id && /^[0-9a-f]{24}$/.test(String(p.thread_id)) ? String(p.thread_id) : null));
      if (cid && !cidByLead.has(r.lead_id)) cidByLead.set(r.lead_id, cid);
    }
    for (const { lid, email, phone } of b) {
      const tid = tidByLead.get(lid);
      if (!tid) {
        // không có tid nhưng có cid → điền cid để cột "ID" không trống
        const cid = cidByLead.get(lid);
        if (cid) { const { error } = await admin.from("dim_lead").update({ smax_customer_id: cid }).eq("lead_id", lid); if (!error) claimed++; }
        continue;
      }
      const keep = owner.get(tid);
      if (!keep || keep === lid) {
        // tid CHƯA ai giữ → lead này nhận luôn (self-claim) → cột "ID" tự đầy
        if (!keep) { const cid = cidByLead.get(lid); const { error } = await admin.from("dim_lead").update({ external_profile_id: tid, ...(cid ? { smax_customer_id: cid } : {}) }).eq("lead_id", lid); if (!error) { owner.set(tid, lid); claimed++; } }
        continue;
      }
      // tid thuộc lead khác = shadow
      await admin.from("fact_touchpoint").update({ lead_id: keep }).eq("lead_id", lid); // dời chat sang owner
      const k = info.get(keep) || { email: null, phone: null }; const upd: Record<string, string> = {};
      if (!k.email && email) upd.email = email; if (!k.phone && phone) upd.phone = phone;
      if (Object.keys(upd).length) await admin.from("dim_lead").update(upd).eq("lead_id", keep);
      await admin.from("fact_lead_score").delete().eq("lead_id", lid);
      const { error } = await admin.from("dim_lead").delete().eq("lead_id", lid); if (!error) { dropIds.push(lid); merged++; }
    }
  }
  console.log(`[dedup-shadow] gộp shadow-dup: ${merged} | self-claim pid/cid: ${claimed}`);
  if (!dropIds.length || !ID) return;
  // xóa dòng trùng trên Lark
  const tk = await fetch(`${U}/auth/v3/tenant_access_token/internal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: ID, app_secret: SEC }) }).then(r => r.json()).then(j => j.tenant_access_token);
  const H = { Authorization: `Bearer ${tk}` };
  const tR = await fetch(`${U}/bitable/v1/apps/${APP}/tables?page_size=100`, { headers: H }).then(r => r.json());
  const db = tR.data.items.find((t: { name: string; table_id: string }) => t.name === "SMAX_Database")?.table_id; if (!db) return;
  const dropSet = new Set(dropIds); const recs: string[] = []; let pt: string | undefined;
  while (true) { const url = new URL(`${U}/bitable/v1/apps/${APP}/tables/${db}/records`); url.searchParams.set("page_size", "500"); url.searchParams.set("field_names", JSON.stringify(["Lead ID"])); if (pt) url.searchParams.set("page_token", pt); const d = await fetch(url.toString(), { headers: H }).then(r => r.json()); for (const r of (d.data?.items ?? [])) if (dropSet.has(g(r.fields?.["Lead ID"]).trim())) recs.push(r.record_id); if (!d.data?.has_more) break; pt = d.data.page_token; }
  let del = 0; for (let i = 0; i < recs.length; i += 400) { const rr = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${db}/records/batch_delete`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ records: recs.slice(i, i + 400) }) }).then(r => r.json()); if (rr.code === 0) del += recs.slice(i, i + 400).length; }
  console.log(`[dedup-shadow] Lark xóa dòng trùng: ${del}`);
}

runDedupShadow().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
