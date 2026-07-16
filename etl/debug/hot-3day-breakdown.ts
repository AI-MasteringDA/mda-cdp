import { admin } from "../lib/supabase-admin";

/**
 * Tách nhóm "lead NÓNG trong 3 ngày qua" để trả lời: 1503 có đúng không?
 * hotAsOf = MAX(last_engagement_at, hot_tag_at). Ta xem cái gì kéo nó vào cửa sổ 3 ngày.
 */
async function main() {
  const now = Date.now();
  const cutoff = now - 3 * 86_400_000; // 3 ngày qua
  const within = (t?: string | null) => (t ? new Date(t).getTime() >= cutoff : false);

  // 1. scored_at mới nhất
  const { data: latest } = await admin
    .from("fact_lead_score")
    .select("scored_at")
    .order("scored_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const scoredAt = latest?.scored_at;
  console.log(`\nscored_at mới nhất: ${scoredAt}`);

  // 2. Tất cả lead hot theo điểm (>=70) ngày mới nhất — paginate
  const hotIds = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("fact_lead_score")
      .select("lead_id, hot_score")
      .eq("scored_at", scoredAt)
      .gte("hot_score", 70)
      .range(from, from + 999);
    if (error) { console.error(error.message); break; }
    if (!data || data.length === 0) break;
    for (const r of data) hotIds.set(r.lead_id, r.hot_score);
    if (data.length < 1000) break;
  }
  console.log(`Lead có điểm >=70 (bất kể thời gian): ${hotIds.size}`);

  // 3. Lấy cột recency của các lead đó (batch .in 100)
  type Row = {
    lead_id: string;
    last_engagement_at: string | null;
    last_chat_at: string | null;
    last_chat_staff_at: string | null;
    last_email_at: string | null;
    hot_tag_at: string | null;
    smax_tags: string[] | null;
    chat_count: number | null;
    chat_staff_count: number | null;
    email_click_count: number | null;
    email_reply_count: number | null;
    form_submit_count: number | null;
    conversion_count: number | null;
    source: string;
    first_seen_at: string;
    last_touch_at: string | null;
  };
  const rows: Row[] = [];
  const ids = [...hotIds.keys()];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const { data } = await admin
      .from("dim_lead")
      .select("lead_id,last_engagement_at,last_chat_at,last_chat_staff_at,last_email_at,last_touch_at,first_seen_at,hot_tag_at,smax_tags,chat_count,chat_staff_count,email_click_count,email_reply_count,form_submit_count,conversion_count,source")
      .in("lead_id", batch);
    for (const r of data ?? []) rows.push(r as Row);
  }

  // 4. Áp bộ lọc hotAsOf trong 3 ngày → reproduce danh sách (KHỚP app: có
  //    fallback về first_seen_at khi mọi cột engagement null)
  const ts = (t?: string | null) => (t ? new Date(t).getTime() : 0);
  const engageOf = (r: Row) =>
    ts(r.last_engagement_at) || ts(r.last_chat_at) || ts(r.last_chat_staff_at) ||
    ts(r.last_email_at) || ts(r.last_touch_at) || ts(r.first_seen_at);
  const inWindow = rows.filter((r) => {
    const hotAsOf = Math.max(engageOf(r), ts(r.hot_tag_at));
    return hotAsOf >= cutoff;
  });
  console.log(`\n➡️  Lead NÓNG trong 3 ngày (reproduce): ${inWindow.length}`);

  // 5. Phân rã lý do vào cửa sổ
  let byTagOnly = 0;       // chỉ vì Sales gắn tag Hot trong 3 ngày
  let byStaffOutbound = 0; // recency do TVV nhắn đi (chat_staff) — KHÔNG phải lead chủ động
  let byCustomerAction = 0;// lead chủ động: chat khách / click / reply / form / conversion trong 3 ngày
  let byFirstSeen = 0;     // KHÔNG có engagement thật — nóng chỉ vì first_seen_at (ETL vừa tạo)
  let byEmailOpenOnly = 0; // chỉ mở email (bị động nhẹ)

  for (const r of inWindow) {
    const tagFresh = within(r.hot_tag_at);
    const custChat = within(r.last_chat_at);
    const click = (r.email_click_count ?? 0) > 0;
    const reply = (r.email_reply_count ?? 0) > 0;
    const form = (r.form_submit_count ?? 0) > 0;
    const conv = (r.conversion_count ?? 0) > 0;
    const staffDriven =
      within(r.last_chat_staff_at) &&
      ts(r.last_chat_staff_at) >= ts(r.last_chat_at) &&
      ts(r.last_chat_staff_at) >= ts(r.last_email_at);
    // Không có BẤT KỲ mốc engagement nào → recency chỉ đến từ first_seen_at
    const noEngageAt =
      !r.last_engagement_at && !r.last_chat_at && !r.last_chat_staff_at &&
      !r.last_email_at && !r.last_touch_at;

    const customerActive = custChat || reply || form || conv || (click && within(r.last_email_at));

    if (customerActive) byCustomerAction++;
    else if (noEngageAt && within(r.first_seen_at) && !tagFresh) byFirstSeen++;
    else if (tagFresh) byTagOnly++;
    else if (staffDriven) byStaffOutbound++;
    else byEmailOpenOnly++;
  }

  const pct = (n: number) => `${n} (${Math.round((n / inWindow.length) * 100)}%)`;
  console.log(`\n── Vì sao "nóng trong 3 ngày"? ──`);
  console.log(`  ✅ Lead CHỦ ĐỘNG (khách chat/reply/click/form/chốt): ${pct(byCustomerAction)}`);
  console.log(`  🏷️  CHỈ do Sales mới gắn tag Hot trong 3 ngày:        ${pct(byTagOnly)}`);
  console.log(`  ⚠️  Do TVV nhắn ĐI (chat_staff) — lead im lặng:       ${pct(byStaffOutbound)}`);
  console.log(`  🆕 KHÔNG engagement — nóng vì first_seen_at (ETL tạo): ${pct(byFirstSeen)}`);
  console.log(`  📧 Chỉ mở email / khác:                              ${pct(byEmailOpenOnly)}`);

  // 6. Bao nhiêu có tag Hot tổng thể
  const withTag = inWindow.filter((r) => (r.smax_tags ?? []).some((t) => /hot|nóng/i.test(t))).length;
  console.log(`\n  Trong 3-ngày-nóng: ${pct(withTag)} có tag Hot (SMAX)`);

  // 6b. Nhóm first_seen: có tương tác nhưng aggregate cũ, hay thật sự trống?
  const firstSeenLeads = inWindow.filter((r) => {
    const noEngageAt = !r.last_engagement_at && !r.last_chat_at && !r.last_chat_staff_at && !r.last_email_at && !r.last_touch_at;
    return noEngageAt && within(r.first_seen_at) && !within(r.hot_tag_at) &&
      !(within(r.last_chat_at) || (r.email_reply_count ?? 0) > 0);
  });
  const hasCountButNoTs = firstSeenLeads.filter((r) => (r.chat_count ?? 0) + (r.chat_staff_count ?? 0) > 0).length;
  console.log(`\n  Trong nhóm first_seen (${firstSeenLeads.length}): ${hasCountButNoTs} CÓ chat_count>0 (aggregate cũ chưa cập nhật), ${firstSeenLeads.length - hasCountButNoTs} thật sự KHÔNG có touchpoint nào`);

  // 6c. ✅ LOGIC MỚI: hotAsOf = MAX(tương tác KHÁCH cuối, tag) — bỏ first_seen + chat_staff
  const newHotAsOf = (r: Row): number => {
    const engTs = ts(r.last_engagement_at);
    const staffTs = ts(r.last_chat_staff_at);
    const chatTs = ts(r.last_chat_at);
    const emailTs = ts(r.last_email_at);
    const staffIsLatest = staffTs > 0 && engTs > 0 && staffTs >= engTs;
    const customerRecency = staffIsLatest ? Math.max(chatTs, emailTs) : engTs;
    return Math.max(customerRecency, ts(r.hot_tag_at));
  };
  const newInWindow = rows.filter((r) => { const h = newHotAsOf(r); return h > 0 && h >= cutoff; });
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`🔧 SAU KHI SỬA — lead NÓNG thật trong 3 ngày: ${newInWindow.length}  (trước: ${inWindow.length})`);
  console.log(`   Tổng lead Hot (điểm >=70, mọi thời gian) KHÔNG đổi: ${hotIds.size}`);
  console.log(`══════════════════════════════════════════════`);

  // 7. Nguồn
  const bySource = new Map<string, number>();
  for (const r of inWindow) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  console.log(`\n  Theo nguồn:`, Object.fromEntries([...bySource].sort((a, b) => b[1] - a[1])));

  process.exit(0);
}
main();
