import { admin } from "../lib/supabase-admin";

async function main() {
  for (const days of [14, 30, 90, 180, 365]) {
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    const t0 = Date.now();
    const { count, error } = await admin
      .from("v_smax_lead_snapshot")
      .select("*", { count: "exact", head: true })
      .gte("occurred_at", cutoff);
    console.log(`${String(days).padStart(3)}d: ${String(count ?? "?").padStart(5)} leads  (${Date.now() - t0}ms)${error ? "  err=" + error.message : ""}`);
  }

  // Trong 180d, bao nhiêu lead KHÔNG có contact → cần AI đọc chat
  const cutoff180 = new Date(Date.now() - 180 * 86400_000).toISOString();
  let noContact = 0, total = 0, from = 0;
  while (from < 20000) {
    const { data } = await admin
      .from("v_smax_lead_snapshot")
      .select("email, phone")
      .gte("occurred_at", cutoff180)
      .range(from, from + 999);
    if (!data?.length) break;
    total += data.length;
    noContact += data.filter(r => !r.email && !r.phone).length;
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`\n180d: ${total} leads · ${noContact} không có contact → cần AI đọc chat`);
  const est = noContact * 0.0023;
  console.log(`Ước tính chi phí AI audit toàn bộ 180d: ~$${est.toFixed(2)}`);
}
main().catch(e => { console.error(e); process.exit(1); });
