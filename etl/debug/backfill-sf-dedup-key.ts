import { admin } from "../lib/supabase-admin";

/**
 * Backfill dedup_key cho fact_touchpoint(source='salesforce') — cần chạy 1
 * LẦN DUY NHẤT trước khi salesforce-real.ts chuyển sang upsert(onConflict:
 * "source,dedup_key"). Không backfill trước thì lần chạy tới sẽ chèn trùng
 * toàn bộ touchpoint trong cửa sổ pull, vì Postgres coi NULL != NULL — dòng
 * cũ (dedup_key NULL) không "đụng" được với dòng mới (dedup_key có giá trị).
 *
 * Phân trang bằng offset TĂNG DẦN cố định (không lọc is(dedup_key, null) rồi
 * refetch-từ-đầu) — tránh vòng lặp vô hạn nếu gặp dòng thiếu ID tự nhiên
 * (payload không có task_id/opportunity_id/sf_contact_id/sf_lead_id).
 */
async function main() {
  let from = 0;
  let updated = 0;
  let skippedNoId = 0;
  let skippedAlready = 0;
  const BATCH = 1000;

  while (true) {
    const { data, error } = await admin
      .from("fact_touchpoint")
      .select("id, payload, dedup_key")
      .eq("source", "salesforce")
      .order("id", { ascending: true })
      .range(from, from + BATCH - 1);
    if (error) { console.error("ERROR:", error.message); process.exit(1); }
    if (!data || data.length === 0) break;

    for (const r of data) {
      if (r.dedup_key) { skippedAlready++; continue; }
      const p = (r.payload ?? {}) as Record<string, unknown>;
      const key = (p.task_id as string) || (p.opportunity_id as string) ||
                  (p.sf_contact_id as string) || (p.sf_lead_id as string) || null;
      if (!key) { skippedNoId++; continue; }
      const { error: uErr } = await admin
        .from("fact_touchpoint")
        .update({ dedup_key: key })
        .eq("id", r.id);
      if (!uErr) updated++;
      else console.warn(`   ⚠️ update ${r.id} failed: ${uErr.message}`);
    }

    from += data.length;
    console.log(`   ↳ Đã xử lý ${from} dòng (updated ${updated}, already-set ${skippedAlready}, no-id ${skippedNoId})`);
    if (data.length < BATCH) break;
  }

  const { count: remaining } = await admin
    .from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("source", "salesforce")
    .is("dedup_key", null);
  console.log(`\n✅ Backfill xong. Tổng xử lý ${from}. Updated ${updated}, no-id ${skippedNoId}, already-set ${skippedAlready}. Còn lại NULL: ${remaining}`);
  process.exit(0);
}
main();
