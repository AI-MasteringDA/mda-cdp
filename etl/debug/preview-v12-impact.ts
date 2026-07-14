/** Ước lượng tác động của scoring V12 (tag SMAX → NÓNG) trước khi chạy SQL. */
import { admin } from "../lib/supabase-admin";

const norm = (t: string) => t.toLowerCase().replace(/[\s_-]/g, "");

async function main() {
  // Lead có tag SMAX Hot Lead (kể cả alias)
  const smaxHot = new Map<string, { name: string; email: string | null; phone: string | null; stage: string;
    opens: number; clicks: number; replies: number; web: number; forms: number; chats: number; conv: number }>();
  let from = 0;
  while (from < 30000) {
    const { data } = await admin.from("dim_lead")
      .select("lead_id, full_name, email, phone, stage, smax_tags, email_open_count, email_click_count, email_reply_count, web_page_view_count, form_submit_count, chat_count, conversion_count")
      .not("smax_tags", "is", null).range(from, from + 999);
    if (!data?.length) break;
    for (const l of data) {
      const tags = (l.smax_tags as string[]) ?? [];
      if (!tags.some(t => norm(t) === "hotlead")) continue;
      if (l.stage === "Đã chốt") continue;
      smaxHot.set(l.lead_id, {
        name: l.full_name ?? "?", email: l.email, phone: l.phone, stage: l.stage ?? "",
        opens: l.email_open_count ?? 0, clicks: l.email_click_count ?? 0, replies: l.email_reply_count ?? 0,
        web: l.web_page_view_count ?? 0, forms: l.form_submit_count ?? 0, chats: l.chat_count ?? 0,
        conv: l.conversion_count ?? 0,
      });
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Lead có tag SMAX "Hot Lead" (chưa chốt): ${smaxHot.size}`);

  // Trong đó, bao nhiêu HIỆN đang NÓNG (score >= 70)?
  const { data: latest } = await admin.from("fact_lead_score")
    .select("scored_at").order("scored_at", { ascending: false }).limit(1);
  const scoredAt = latest?.[0]?.scored_at;
  const ids = [...smaxHot.keys()];
  const scoreById = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const { data } = await admin.from("fact_lead_score")
      .select("lead_id, hot_score").eq("scored_at", scoredAt).in("lead_id", batch);
    for (const s of data ?? []) scoreById.set(s.lead_id, s.hot_score ?? 0);
  }
  let alreadyHot = 0, willBecomeHot = 0;
  const newHot: string[] = [];
  for (const id of ids) {
    const sc = scoreById.get(id) ?? 0;
    if (sc >= 70) alreadyHot++;
    else { willBecomeHot++; if (newHot.length < 12) newHot.push(id); }
  }
  console.log(`   đã NÓNG sẵn:        ${alreadyHot}`);
  console.log(`   sẽ THÀNH NÓNG (V12): ${willBecomeHot}  ← đang bị bỏ sót!\n`);

  // Trong nhóm sắp thành NÓNG: hành vi cross-channel ra sao?
  let withBehavior = 0, silent = 0;
  for (const id of ids) {
    const s = smaxHot.get(id)!;
    const real = s.clicks + s.replies + s.forms + s.chats + s.conv > 0;
    if (real) withBehavior++; else silent++;
  }
  console.log(`Trong ${smaxHot.size} lead tag NÓNG:`);
  console.log(`   ✅ có hành vi thật (click/reply/form/chat/mua): ${withBehavior}`);
  console.log(`   ⚠️  chưa có hành vi nào CDP ghi nhận:           ${silent}`);

  console.log(`\n12 lead sẽ được đẩy lên NÓNG:`);
  for (const id of newHot) {
    const s = smaxHot.get(id)!;
    const sig = [
      s.forms && `form×${s.forms}`, s.replies && `reply×${s.replies}`, s.clicks && `click×${s.clicks}`,
      s.chats && `chat×${s.chats}`, s.opens && `mở mail×${s.opens}`, s.web && `web×${s.web}`,
    ].filter(Boolean).join("  ") || "— chưa có hành vi";
    console.log(`   ${(scoreById.get(id) ?? 0).toString().padStart(3)}đ  ${s.name.slice(0, 22).padEnd(22)} ${(s.phone ?? s.email ?? "-").padEnd(24)} ${sig}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
