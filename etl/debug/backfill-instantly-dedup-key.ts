import { admin } from "../lib/supabase-admin";

/**
 * Backfill dedup_key cho fact_touchpoint(source='instantly') từ payload.raw_id
 * — bắt buộc chạy 1 LẦN trước khi instantly-real.ts / instantly-historical.ts
 * chuyển sang upsert(onConflict: "source,dedup_key"). Không backfill trước thì
 * lần chạy tới sẽ chèn trùng toàn bộ lịch sử (NULL != NULL trong Postgres).
 */
async function main() {
  let updated = 0;
  let duplicates = 0;
  let skippedNoId = 0;
  let totalSeen = 0;
  const BATCH = 500;

  // Chỉ lấy đúng dòng CÒN NULL mỗi lần. QUAN TRỌNG: dòng trùng raw_id thật sự
  // (bug lịch sử đã phát hiện) sẽ luôn update-fail vì vi phạm UNIQUE INDEX
  // ux_ft_source_dedup(source, dedup_key) — nếu cứ để NULL, nó bị fetch lại
  // MÃI MÃI (lặp vô hạn, không bao giờ data.length < BATCH). Xử lý: khi update
  // bằng raw_id thất bại do trùng, gán dedup_key = "dup-{id-của-chính-nó}" —
  // luôn duy nhất, để dòng rớt khỏi filter IS NULL nhưng vẫn tự nhận diện
  // được sau này là "dòng trùng lặp lịch sử, không có dedup_key tự nhiên".
  while (true) {
    const { data, error } = await admin
      .from("fact_touchpoint")
      .select("id, payload")
      .eq("source", "instantly")
      .is("dedup_key", null)
      .limit(BATCH);
    if (error) { console.error("ERROR:", error.message); process.exit(1); }
    if (!data || data.length === 0) break;

    for (const r of data) {
      totalSeen++;
      const key = (r.payload as Record<string, unknown> | null)?.raw_id as string | undefined;
      if (!key) { skippedNoId++; continue; }
      const { error: uErr } = await admin.from("fact_touchpoint").update({ dedup_key: key }).eq("id", r.id);
      if (!uErr) { updated++; continue; }
      // Update thất bại (gần như chắc chắn là vi phạm unique — trùng raw_id
      // với dòng khác). Gán sentinel duy nhất để không lặp vô hạn.
      const { error: e2 } = await admin.from("fact_touchpoint").update({ dedup_key: `dup-${r.id}` }).eq("id", r.id);
      if (e2) console.warn(`   ⚠️ ${r.id} vẫn lỗi sau sentinel: ${e2.message}`);
      else duplicates++;
    }
    console.log(`   ↳ Vòng này: ${data.length} dòng (tổng updated ${updated}, duplicate ${duplicates}, no-id ${skippedNoId})`);
    if (data.length < BATCH) break;
  }

  const { count: remaining } = await admin
    .from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("source", "instantly")
    .is("dedup_key", null);
  console.log(`\n✅ Backfill xong (lần chạy này xử lý ${totalSeen} dòng). Updated ${updated}, duplicate ${duplicates}, no-id ${skippedNoId}. Còn lại NULL: ${remaining}`);
  process.exit(0);
}
main();
