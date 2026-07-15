/**
 * Backfill dim_lead.hot_tag_at cho lead SMAX đang có tag "Hot Lead".
 * Đọc customer.tags[].time từ SMAX API — thời điểm Giàu bấm tag.
 */
import { admin } from "../lib/supabase-admin";

const TOKEN = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const BASE = process.env.SMAX_BASE_URL || "https://api.smax.ai";
const BIZ = "mastering-data-analytics";
const DRY = process.env.DRY_RUN !== "0";

const isHot = (s: string) => s.toLowerCase().replace(/[\s_-]/g, "") === "hotlead";

type Cust = { id: string; tags?: Array<{ name?: string; alias?: string; time?: string }> };

async function main() {
  console.log(DRY ? "🟡 DRY_RUN\n" : "🔴 LIVE\n");

  // 1. SMAX: customer_id → thời điểm tag Hot mới nhất
  const custRes = await fetch(`${BASE}/bizs/${BIZ}/customers`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ size: 10000 }),
  }).then(r => r.json()) as { data?: Cust[]; total?: number };
  const hotAtByCust = new Map<string, string>();
  for (const c of custRes.data ?? []) {
    let latest: string | undefined;
    for (const t of c.tags ?? []) {
      const name = t.name || t.alias || "";
      if (!isHot(name) || !t.time || isNaN(Date.parse(t.time))) continue;
      if (!latest || t.time > latest) latest = t.time;
    }
    if (latest) hotAtByCust.set(c.id, latest);
  }
  console.log(`SMAX: ${hotAtByCust.size} customer có tag Hot (kèm thời điểm)  (tổng ${custRes.total})`);

  // 2. dim_lead có smax_customer_id → map sang hot_tag_at
  const updates: { lead_id: string; hot_tag_at: string }[] = [];
  let from = 0, scanned = 0;
  while (from < 60000) {
    const { data } = await admin.from("dim_lead")
      .select("lead_id, smax_customer_id, hot_tag_at")
      .eq("source", "smax").not("smax_customer_id", "is", null)
      .range(from, from + 999);
    if (!data?.length) break;
    for (const l of data) {
      scanned++;
      const hotAt = hotAtByCust.get(l.smax_customer_id as string);
      if (!hotAt) continue;
      const cur = (l as { hot_tag_at?: string | null }).hot_tag_at ?? null;
      if (!cur || hotAt > cur) updates.push({ lead_id: l.lead_id, hot_tag_at: hotAt });
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Quét ${scanned} lead smax → ${updates.length} cần set hot_tag_at\n`);
  updates.slice(0, 6).forEach(u => console.log(`   ${u.lead_id}  ← ${u.hot_tag_at}`));

  if (DRY) { console.log("\n🟡 DRY_RUN — chưa ghi. DRY_RUN=0 để chạy thật."); return; }

  let done = 0;
  for (let i = 0; i < updates.length; i += 200) {
    const batch = updates.slice(i, i + 200);
    // update từng dòng (giá trị khác nhau) — gom 200 promise/lượt
    await Promise.all(batch.map(u =>
      admin.from("dim_lead").update({ hot_tag_at: u.hot_tag_at }).eq("lead_id", u.lead_id)
    ));
    done += batch.length;
    if (done % 1000 === 0 || done >= updates.length) console.log(`   ${done}/${updates.length}`);
  }
  console.log(`\n✅ Set hot_tag_at cho ${done} lead`);
}
main().catch(e => { console.error(e); process.exit(1); });
